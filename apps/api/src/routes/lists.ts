import { listItemsQuerySchema, listListsQuerySchema, searchQuerySchema, uuidSchema } from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { contentQueryService } from '../modules/lists/content-query-service.js';

import { sendData } from './respond.js';

export const listsRouter = Router();
export const searchRouter = Router();

listsRouter.use(requireAuth);
searchRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw HttpError.unauthorized();
  return req.auth.userId;
}

const listParams = z.object({ id: uuidSchema });

listsRouter.get('/', async (req, res) => {
  const filters = listListsQuerySchema.parse(req.query);
  sendData(
    res,
    200,
    await contentQueryService.listLists(caller(req), {
      ...filters,
      cursor: filters.cursor ?? null,
    }),
  );
});

listsRouter.get('/:id', async (req, res) => {
  const { id } = listParams.parse(req.params);
  sendData(res, 200, await contentQueryService.getList(caller(req), id));
});

listsRouter.get('/:id/items', async (req, res) => {
  const { id } = listParams.parse(req.params);
  const filters = listItemsQuerySchema.parse(req.query);

  sendData(
    res,
    200,
    await contentQueryService.listItems(caller(req), id, {
      ...filters,
      cursor: filters.cursor ?? null,
    }),
  );
});

/**
 * Global search. The app also searches its local cache when offline, so this is
 * the online half of the same behaviour, not a replacement for it.
 */
searchRouter.get('/', async (req, res) => {
  const query = searchQuerySchema.parse(req.query);
  sendData(res, 200, await contentQueryService.search(caller(req), query));
});
