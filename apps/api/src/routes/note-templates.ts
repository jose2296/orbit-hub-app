import {
  createNoteTemplateRequestSchema,
  listNoteTemplatesQuerySchema,
  shareNoteTemplateRequestSchema,
  updateNoteTemplateRequestSchema,
  uuidSchema,
} from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { noteTemplateService } from '../modules/notes/note-template-service.js';

import { sendData } from './respond.js';

export const noteTemplatesRouter = Router();

noteTemplatesRouter.use(requireAuth);

/**
 * The id in the path, and it is not simply a uuid.
 *
 * The built-in templates are read from the code and have no row, so their id is
 * `builtin:recipe` and not a uuid. Parsing it as one would answer a PATCH with
 * 422 "not a uuid", which is true and useless: the real answer is that this
 * template belongs to the app and cannot be changed, and the service is the only
 * place that knows which is which.
 */
const templateIdParam = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value.startsWith('builtin:') || uuidSchema.safeParse(value).success, {
    message: 'Not a template id',
  });

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new Error('requireAuth should have answered before this');
  return req.auth.userId;
}

noteTemplatesRouter.get('/', async (req, res) => {
  const filters = listNoteTemplatesQuerySchema.parse(req.query);
  sendData(res, 200, await noteTemplateService.list(caller(req), filters));
});

noteTemplatesRouter.get('/:templateId', async (req, res) => {
  const templateId = templateIdParam.parse(req.params.templateId);
  sendData(res, 200, await noteTemplateService.read(caller(req), templateId));
});

noteTemplatesRouter.post('/', async (req, res) => {
  const body = createNoteTemplateRequestSchema.parse(req.body ?? {});
  sendData(res, 201, await noteTemplateService.create(caller(req), body));
});

/**
 * One template, changed or gone.
 *
 * Two verbs on one path and not `/notes/templates/:id/edit`, because a template is
 * a thing that has a document rather than a document being edited: the same PATCH
 * carries a new name and a new body, and the two are separate requests because
 * they are separate intentions.
 */
noteTemplatesRouter.patch('/:templateId', async (req, res) => {
  const templateId = templateIdParam.parse(req.params.templateId);
  const body = updateNoteTemplateRequestSchema.parse(req.body ?? {});
  sendData(res, 200, await noteTemplateService.update(caller(req), templateId, body));
});

/**
 * Who can see it.
 *
 * Its own verb because it is its own question: the words of a template and the
 * list of people who may read them are separate intentions, and the second one
 * has rules the first one knows nothing about.
 */
noteTemplatesRouter.post('/:templateId/share', async (req, res) => {
  const templateId = templateIdParam.parse(req.params.templateId);
  const body = shareNoteTemplateRequestSchema.parse(req.body ?? {});
  sendData(res, 200, await noteTemplateService.share(caller(req), templateId, body));
});

/**
 * The catalogue.
 *
 * Two verbs on one path, and not on `share`, because publishing and sharing are
 * different decisions rather than the same one at two sizes. Sharing puts a
 * template in a space where the team can fix its words; publishing puts it in
 * front of strangers who can use it and nothing else.
 */
noteTemplatesRouter.post('/:templateId/publish', async (req, res) => {
  const templateId = templateIdParam.parse(req.params.templateId);
  sendData(res, 200, await noteTemplateService.publish(caller(req), templateId));
});

noteTemplatesRouter.delete('/:templateId/publish', async (req, res) => {
  const templateId = templateIdParam.parse(req.params.templateId);
  sendData(res, 200, await noteTemplateService.unpublish(caller(req), templateId));
});

noteTemplatesRouter.delete('/:templateId', async (req, res) => {
  const templateId = templateIdParam.parse(req.params.templateId);
  sendData(res, 200, await noteTemplateService.remove(caller(req), templateId));
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
