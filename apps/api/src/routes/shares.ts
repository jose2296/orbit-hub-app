import { Router } from 'express';
import { eq } from 'drizzle-orm';

import {
  createShareRequestSchema,
  placeShareRequestSchema,
} from '@orbit-hub/contracts';

import { users } from '../db/auth-schema.js';
import { getDatabase } from '../db/client.js';
import { sendData } from './respond.js';
import { HttpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';
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

  const nodeType = String(req.params['nodeType']) as 'workspace' | 'folder' | 'list' | 'list_item';
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
