import {
  exportFilename,
  listExportQuerySchema,
  listItemsQuerySchema,
  listListsQuerySchema,
  searchQuerySchema,
  uuidSchema,
} from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { exportService } from '../modules/export/export-service.js';
import { contentQueryService } from '../modules/lists/content-query-service.js';

import { sendData, sendFile } from './respond.js';

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
 * La lista como fichero: JSON con su contexto o CSV de sus items.
 *
 * Responde bytes con `Content-Disposition` y no el sobre, igual que el export
 * de cuenta. El nombre lo hace `exportFilename`, el mismo del contrato que usa
 * el cliente para su destino local, y en el CSV el titulo no llega a la ruta
 * (el servicio devuelve solo el texto), asi que el slug cae al id — que es la
 * caida que el propio `exportFilename` tiene prevista.
 */
listsRouter.get('/:id/export', async (req, res) => {
  const { id } = listParams.parse(req.params);
  const { format } = listExportQuerySchema.parse(req.query);
  const userId = caller(req);

  if (format === 'csv') {
    const csv = await exportService.listCsv(userId, id);
    sendFile(res, 200, {
      body: csv,
      contentType: 'text/csv',
      filename: exportFilename({
        title: '',
        fallbackId: id,
        extension: 'csv',
        date: new Date().toISOString().slice(0, 10),
      }),
    });
    return;
  }

  const exportacion = await exportService.listJson(userId, id);
  sendFile(res, 200, {
    body: JSON.stringify(exportacion, null, 2),
    contentType: 'application/json',
    filename: exportFilename({
      title: exportacion.list.title,
      fallbackId: id,
      extension: 'json',
      date: exportacion.exportedAt.slice(0, 10),
    }),
  });
});

/**
 * Global search. The app also searches its local cache when offline, so this is
 * the online half of the same behaviour, not a replacement for it.
 */
searchRouter.get('/', async (req, res) => {
  const query = searchQuerySchema.parse(req.query);
  sendData(res, 200, await contentQueryService.search(caller(req), query));
});
