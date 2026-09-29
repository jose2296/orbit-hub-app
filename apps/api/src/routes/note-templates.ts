import {
  createNoteTemplateRequestSchema,
  listNoteTemplatesQuerySchema,
  uuidSchema,
} from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { noteTemplateService } from '../modules/notes/note-template-service.js';

import { sendData } from './respond.js';

export const noteTemplatesRouter = Router();

noteTemplatesRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new Error('requireAuth should have answered before this');
  return req.auth.userId;
}

noteTemplatesRouter.get('/', async (req, res) => {
  const filters = listNoteTemplatesQuerySchema.parse(req.query);
  sendData(res, 200, await noteTemplateService.list(caller(req), filters));
});

noteTemplatesRouter.post('/', async (req, res) => {
  const body = createNoteTemplateRequestSchema.parse(req.body ?? {});
  sendData(res, 201, await noteTemplateService.create(caller(req), body));
});

/**
 * A new note from a template.
 *
 * Under `/notes` and not under the templates, because what it returns is a note
 * and the caller will go straight to the editor. The template is the input; the
 * note is the result.
 */
export const applyTemplateRouter = Router();

applyTemplateRouter.use(requireAuth);

const applyBody = z.object({
  templateId: z.string().min(1),
  workspaceId: uuidSchema,
  folderId: uuidSchema.nullable().default(null),
  title: z.string().trim().max(200).optional(),
});

applyTemplateRouter.post('/apply', async (req, res) => {
  const body = applyBody.parse(req.body ?? {});
  const note = await noteTemplateService.applyToNote(caller(req), body.templateId, {
    workspaceId: body.workspaceId,
    folderId: body.folderId,
    title: body.title,
  });
  sendData(res, 201, note);
});
