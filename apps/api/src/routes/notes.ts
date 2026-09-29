import {
  createNoteRequestSchema,
  listNotesQuerySchema,
  updateNoteRequestSchema,
  uuidSchema,
} from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { noteService } from '../modules/notes/note-service.js';

import { sendData } from './respond.js';

export const notesRouter = Router();

notesRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new Error('requireAuth should have answered before this');
  return req.auth.userId;
}

const noteParams = z.object({ id: uuidSchema });

notesRouter.get('/', async (req, res) => {
  const filters = listNotesQuerySchema.parse(req.query);
  sendData(res, 200, await noteService.list(caller(req), filters));
});

notesRouter.get('/:id', async (req, res) => {
  const { id } = noteParams.parse(req.params);
  sendData(res, 200, await noteService.get(caller(req), id));
});

/**
 * The direct route exists for the online case.
 *
 * The app writes locally and syncs, so this is not how a note is normally
 * created. It is here for the first note of a first run and for any client that
 * has nothing queued, and it behaves the same either way: the document is
 * validated, `plain_text` is derived on the server, and the version starts at 1.
 */
notesRouter.post('/', async (req, res) => {
  const body = createNoteRequestSchema.parse(req.body ?? {});
  sendData(res, 201, await noteService.create(caller(req), body));
});

notesRouter.patch('/:id', async (req, res) => {
  const { id } = noteParams.parse(req.params);
  const body = updateNoteRequestSchema.parse(req.body ?? {});
  sendData(res, 200, await noteService.update(caller(req), id, body));
});

notesRouter.delete('/:id', async (req, res) => {
  const { id } = noteParams.parse(req.params);
  await noteService.remove(caller(req), id);
  res.status(204).end();
});
