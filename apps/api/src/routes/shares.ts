import { Router } from 'express';
import { eq } from 'drizzle-orm';

import {
  createShareRequestSchema,
  placeShareRequestSchema,
} from '@orbit-hub/contracts';
import type { ShareNodeType } from '@orbit-hub/contracts';

import { users } from '../db/auth-schema.js';
import { getDatabase } from '../db/client.js';
import { sendData } from './respond.js';
import { emailSender, sharedWithYouEmail } from '../modules/email/email.js';
import { HttpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/require-auth.js';
import { shareService } from '../modules/shares/share-service.js';

/**
 * Sharing, over HTTP.
 *
 * Not under `/workspaces`, because what is shared is not a workspace and putting
 * it there would say it is. And not under `/sync`, because a grant is an act
 * between two people and not content somebody is editing offline: it cannot be
 * queued on a device that no longer belongs to anybody, and it cannot be applied
 * twice by a retry that means something different the second time. The same
 * reasoning that put invitations in their own table.
 */
export const sharesRouter = Router();

/**
 * Everything below needs to know who is asking.
 *
 * It was missing, and the effect was that every endpoint on this router answered
 * 401 to everybody: each handler reads `req.auth?.userId` and throws when it is
 * absent, and with no `requireAuth` on the router it is *always* absent. Not even
 * an empty inbox was reachable.
 *
 * The test suite did not catch it because it calls `shareService.inbox(userId)`
 * directly rather than going through the route — a test that exercises the
 * service proves the service, and says nothing about the door in front of it.
 * That is why this line has a test of its own now, over HTTP.
 */
sharesRouter.use(requireAuth);

/** "Shared with me": what has been given to this person and not filed yet. */
sharesRouter.get('/inbox', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const items = await shareService.inbox(userId);
  sendData(res, 200, {
    items: items.map((row: (typeof items)[number]) => ({
      id: row.shareId,
      nodeType: row.nodeType,
      nodeId: row.nodeId,
      role: row.role,
      title: row.title,
      workspaceId: '',
      ownerName: row.ownerName,
      placedAt: null,
      createdAt: new Date().toISOString(),
    })),
  });
});

/**
 * What has arrived, with dates, including whole spaces.
 *
 * Separate from `/inbox` on purpose, and the reason is written up in the service:
 * `inbox` is the list of things you have to **file**, and a shared space is not one of
 * them. If the badge counted the filing list, sharing a whole workspace would be the
 * one kind of sharing that never says anything.
 */
sharesRouter.get('/incoming', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const items = await shareService.incoming(userId);
  sendData(res, 200, {
    items: items.map((row) => ({
      id: row.shareId,
      nodeType: row.nodeType,
      title: row.title,
      ownerName: row.ownerName,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

/** Hands a node to somebody, by id or by mail. */
sharesRouter.post('/', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const body = createShareRequestSchema.parse(req.body ?? {});
  const target = await shareService.resolveTarget(body.nodeType, body.nodeId);

  // By mail too, because the most common case is somebody typing an address that
  // is not in the app yet, and a share that needs the other person to have
  // signed up first is a share that never happens.
  const grantee = await resolveGrantee(body.granteeUserId, body.granteeEmail);

  const creada = await shareService.createShare({
    ownerUserId: userId,
    target,
    grantee,
    role: body.role,
  });

  logger.info({ shareId: creada.shareId, nodeType: body.nodeType, userId }, 'share created');

  // The mail goes out and the share stays, whatever the mail does. A provider down is
  // not a reason to un-share something somebody already agreed to, and the notice
  // inside the app does not need the mail to have arrived: it is in the inbox either
  // way. So this is not awaited into the response, and a rejection is logged.
  void emailSender
    .send(
      sharedWithYouEmail({
        to: creada.address,
        locale: creada.locale,
        nodeTitle: creada.title,
        nodeType: body.nodeType,
        spaceName: creada.spaceName,
        ownerName: creada.ownerName,
        role: body.role,
      }),
    )
    .catch((error: unknown) => {
      logger.warn(
        { err: error, shareId: creada.shareId },
        'the share was created but the mail could not be sent',
      );
    });

  sendData(res, 201, { id: creada.shareId });
});

/** Files a received thing in your own tree, which is what takes it out of the inbox. */
sharesRouter.post('/:shareId/place', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const body = placeShareRequestSchema.parse({ ...(req.body ?? {}), shareId: req.params['shareId'] });

  await shareService.placeShare({
    userId,
    shareId: body.shareId,
    workspaceId: body.workspaceId,
    folderId: body.folderId,
    position: body.position,
  });
  sendData(res, 200, { placed: true });
});

/** Takes a share back. Only the person who granted it can. */
sharesRouter.delete('/:shareId', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  await shareService.revokeShare({ userId, shareId: req.params['shareId'] });
  sendData(res, 200, { revoked: true });
});

/**
 * Who a node reaches right now, and how many.
 *
 * This is what a delete asks before it does anything, and it is a read and not a
 * delete on purpose: "you are about to delete this from three places" has to be
 * shown *before* anybody taps confirm, and there is no way to ask that after.
 */
sharesRouter.get('/:nodeType/:nodeId/reach', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const nodeType = String(req.params['nodeType']) as ShareNodeType;
  const nodeId = String(req.params['nodeId']);
  const target = await shareService.resolveTarget(nodeType, nodeId);

  // A person who cannot reach the node does not get to learn who can.
  const acceso = await shareService.accessFor(target, userId);
  if (acceso === 'none') throw HttpError.notFound('That does not exist');

  const alcanzados = await shareService.whoHas(target);
  sendData(res, 200, alcanzados);
});

/**
 * Who to share with: an account by id, or the account with that address.
 *
 * An address that is nobody is a 404 and not a 400, because the same answer for
 * "no existe" and "existe pero no es tuyo" is the whole point of not being able to
 * probe who has an account.
 */
async function resolveGrantee(
  userId: string | undefined,
  email: string | undefined,
): Promise<{ userId: string; email: string; displayName: string | null }> {
  const { db } = await getDatabase();

  if (userId) {
    const row = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const found = row[0];
    if (!found) throw HttpError.notFound('There is nobody with that id');
    return { userId: found.id, email: found.email, displayName: found.displayName };
  }

  const normalizado = (email ?? '').trim().toLowerCase();
  if (!normalizado) throw HttpError.validation('Who is it for?');

  const row = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.email, normalizado))
    .limit(1);
  const found = row[0];
  if (!found) throw HttpError.notFound('There is nobody with that address');
  return { userId: found.id, email: found.email, displayName: found.displayName };
}
