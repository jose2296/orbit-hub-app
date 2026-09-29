import {
  confirmAttachmentRequestSchema,
  createAttachmentTicketRequestSchema,
  uuidSchema,
} from '@orbit-hub/contracts';
import express, { Router } from 'express';
import { z } from 'zod';

import { env } from '../config/env.js';
import { requireAuth } from '../middleware/require-auth.js';
import { attachmentService } from '../modules/notes/attachment-service.js';
import { localStorage, verifyLocalSignature } from '../modules/notes/storage.js';

import { sendData } from './respond.js';

export const attachmentsRouter = Router();

attachmentsRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new Error('requireAuth should have answered before this');
  return req.auth.userId;
}

const noteParams = z.object({ noteId: uuidSchema });
const attachmentParams = z.object({ attachmentId: uuidSchema });

/**
 * Step one: a place to put the bytes.
 *
 * No row is created here. A file somebody started uploading and never finished is
 * not an attachment, it is something a lifecycle rule has to clean up, and the
 * cheapest way not to have those is not to write a row for them.
 */
attachmentsRouter.post('/:noteId/attachments', async (req, res) => {
  const { noteId } = noteParams.parse(req.params);
  const body = createAttachmentTicketRequestSchema.parse(req.body ?? {});

  sendData(res, 201, await attachmentService.createTicket(caller(req), noteId, body));
});

/** Step two: the bytes are in storage, so the file joins the note. */
attachmentsRouter.post('/:noteId/attachments/confirm', async (req, res) => {
  const { noteId } = noteParams.parse(req.params);
  const body = confirmAttachmentRequestSchema.parse(req.body ?? {});

  sendData(res, 201, await attachmentService.confirm(caller(req), noteId, body));
});

attachmentsRouter.get('/:noteId/attachments', async (req, res) => {
  const { noteId } = noteParams.parse(req.params);
  sendData(res, 200, await attachmentService.list(caller(req), noteId));
});

/**
 * Scoped by attachment, not by note.
 *
 * The note is looked up from the attachment, so the caller does not have to know
 * it, and there is no way to pass a note that is not the one the file belongs to.
 */
attachmentsRouter.post('/attachments/:attachmentId/link', async (req, res) => {
  const { attachmentId } = attachmentParams.parse(req.params);
  const link = await attachmentService.linkFor(caller(req), attachmentId);
  sendData(res, 200, { url: link.url, fileName: link.fileName, mimeType: link.mimeType });
});

attachmentsRouter.delete('/attachments/:attachmentId', async (req, res) => {
  const { attachmentId } = attachmentParams.parse(req.params);
  await attachmentService.remove(caller(req), attachmentId);
  res.status(204).end();
});

/**
 * The bytes, for the local driver.
 *
 * No session and no note: the URL is signed and short lived, which is what the
 * client gets instead of a key, and a bucket serves the same contract without this
 * route existing. Registered on its own router so the absence of `requireAuth` is
 * obvious here rather than inferred from a missing line somewhere else.
 */
export const attachmentBytesRouter = Router();

/**
 * The bytes arrive raw.
 *
 * `express.json()` runs first for every route and leaves a binary body alone
 * because the type does not match, so the raw parser here is what actually reads
 * it. Without this the handler gets an empty body and writes an empty file, which
 * is a note with a broken image and a row insisting there is a picture.
 */
const rawUpload = express.raw({ type: '*/*', limit: env.ATTACHMENT_MAX_BYTES });

// Express 5 named the wildcard: a bare `*` is a syntax error now, and a storage key
// is a path with slashes in it, so it has to be the greedy form.
attachmentBytesRouter.put('/upload/{*key}', rawUpload, async (req, res) => {
  const local = localStorage();
  if (!local) {
    res.status(501).json({
      error: { code: 'not_implemented', message: 'This driver does not serve bytes' },
    });
    return;
  }
  // A greedy wildcard arrives as an array of segments, which have to be put back
  // together with the slashes the key is made of.
  const segments = (req.params as unknown as Record<string, string | string[]>)['key'];
  const key = decodeURIComponent(Array.isArray(segments) ? segments.join('/') : (segments ?? ''));
  await local.write(key, await readBody(req));
  res.status(200).json({ ok: true });
});

attachmentBytesRouter.get('/file/:key', async (req, res) => {
  const local = localStorage();
  if (!local) {
    res.status(501).json({ error: { code: 'not_implemented', message: 'This driver does not serve bytes' } });
    return;
  }
  const query = z
    .object({
      expires: z.coerce.number().int(),
      signature: z.string().min(1),
      name: z.string().min(1).max(255),
    })
    .parse(req.query);
  const key = decodeURIComponent(String(req.params['key'] ?? ''));

  if (!verifyLocalSignature(key, query.name, query.expires, query.signature)) {
    // 403 and not 404: the caller holds a link that is no longer good, and saying
    // so is what lets the app fetch a new one.
    res.status(403).json({ error: { code: 'forbidden', message: 'That link has expired' } });
    return;
  }

  res.setHeader('content-disposition', `inline; filename="${query.name.replace(/"/g, '')}"`);
  res.setHeader('cache-control', 'private, max-age=300');
  local.stream(key).pipe(res);
});

async function readBody(req: { body: unknown }): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  return Buffer.alloc(0);
}
