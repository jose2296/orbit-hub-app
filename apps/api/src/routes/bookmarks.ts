import { uuidSchema } from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { getBookmark, listBookmarks } from '../modules/bookmarks/bookmark-service.js';

import { sendData } from './respond.js';

export const bookmarksRouter = Router();

bookmarksRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new Error('requireAuth should have answered before this');
  return req.auth.userId;
}

const bookmarkParams = z.object({ id: uuidSchema });

/*
  El filtro "sin clasificar" va como el literal `'unclassified'` y no como
  `collectionId=null`: `z.object` no distingue un `?collectionId=` ausente de
  uno en null en el query string, y la vista "sin clasificar" es
  `collection_id IS NULL`. Un `?collectionId=` a secas significaria lo
  contrario de lo que parece, asi que el literal existe para que nadie tenga
  que adivinarlo.
*/
const listBookmarksQuery = z.object({
  workspaceId: uuidSchema,
  folderId: uuidSchema.optional(),
  collectionId: z.union([uuidSchema, z.literal('unclassified')]).optional(),
});

bookmarksRouter.get('/', async (req, res) => {
  const filters = listBookmarksQuery.parse(req.query);
  sendData(
    res,
    200,
    await listBookmarks(caller(req), {
      workspaceId: filters.workspaceId,
      folderId: filters.folderId,
      collectionId: filters.collectionId === 'unclassified' ? null : filters.collectionId,
    }),
  );
});

bookmarksRouter.get('/:id', async (req, res) => {
  const { id } = bookmarkParams.parse(req.params);
  sendData(res, 200, await getBookmark(caller(req), id));
});
