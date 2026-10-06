import { uuidSchema } from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import {
  deleteCollection,
  getCollection,
  listCollections,
} from '../modules/collections/collection-service.js';

import { sendData } from './respond.js';

export const collectionsRouter = Router();

collectionsRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new Error('requireAuth should have answered before this');
  return req.auth.userId;
}

const collectionParams = z.object({ id: uuidSchema });
const listCollectionsQuery = z.object({
  workspaceId: uuidSchema,
  folderId: uuidSchema.optional(),
  /*
    Booleano como enum y no como `z.coerce.boolean()`: el coerce usa
    `Boolean()` y un `?includeEmpty=false` llegaria como `true`, porque toda
    cadena no vacia es truthy. El flag existiria pero nadie podria apagarlo.
  */
  includeEmpty: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

collectionsRouter.get('/', async (req, res) => {
  sendData(res, 200, await listCollections(caller(req), listCollectionsQuery.parse(req.query)));
});

collectionsRouter.get('/:id', async (req, res) => {
  const { id } = collectionParams.parse(req.params);
  sendData(res, 200, await getCollection(caller(req), id));
});

collectionsRouter.delete('/:id', async (req, res) => {
  const { id } = collectionParams.parse(req.params);
  await deleteCollection(caller(req), id);
  sendData(res, 204, null);
});
