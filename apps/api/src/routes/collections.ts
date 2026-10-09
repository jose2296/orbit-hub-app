import { collectionExportQuerySchema, uuidSchema } from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import {
  deleteCollection,
  getCollection,
  listCollections,
} from '../modules/collections/collection-service.js';
import { exportService } from '../modules/export/export-service.js';

import { sendData, sendFile } from './respond.js';

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

/**
 * La coleccion como fichero: JSON con su contexto o CSV de sus enlaces.
 *
 * Bytes por `sendFile` y no el sobre `{ data, meta }`, igual que
 * `GET /lists/:id/export` y que el export de cuenta: son las tres rutas de
 * fichero de la API y las tres son la excepcion. El cuerpo, el tipo y el nombre
 * salen juntos del servicio, que es el unico sitio que ha cargado la coleccion.
 *
 * Va **despues** de `GET /:id` y no antes a proposito: Express empareja las
 * rutas en orden, y `/:id` no se tragaria `/:id/export` —no son el mismo numero
 * de segmentos—, asi que el orden es solo de lectura. Lo que si importa es que
 * la query se parsea con `collectionExportQuerySchema` y no a mano: es el contrato
 * el que dice que `format` admite JSON y CSV, y duplicar esa lista aca seria un
 * segundo sitio donde el formato puede mentir.
 */
collectionsRouter.get('/:id/export', async (req, res) => {
  const { id } = collectionParams.parse(req.params);
  const { format } = collectionExportQuerySchema.parse(req.query);

  const fichero =
    format === 'csv'
      ? await exportService.collectionCsv(caller(req), id)
      : await exportService.collectionJson(caller(req), id);
  sendFile(res, 200, fichero);
});

collectionsRouter.delete('/:id', async (req, res) => {
  const { id } = collectionParams.parse(req.params);
  await deleteCollection(caller(req), id);
  sendData(res, 204, null);
});
