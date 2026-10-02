import { accountExportQuerySchema } from '@orbit-hub/contracts';
import { Router } from 'express';

import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { exportService } from '../modules/export/export-service.js';

import { sendFile } from './respond.js';

/**
 * La cuenta como dato: de momento, su exportacion.
 *
 * No vive en `/auth` porque `DELETE /auth/account` es la cuenta pero esto no
 * es autenticacion: es contenido, y responde bytes con `Content-Disposition`
 * en vez del sobre.
 */
export const accountRouter = Router();

accountRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw HttpError.unauthorized();
  return req.auth.userId;
}

accountRouter.get('/export', async (req, res) => {
  // El parse a secas es la decision: `accountExportQuerySchema` solo admite
  // `json`, asi que `?format=csv` es un 422 del contrato y no algo que esta
  // ruta tenga que decidir.
  accountExportQuerySchema.parse(req.query);

  // El cuerpo, el tipo y el nombre salen juntos del servicio: la ruta no
  // inventa cabeceras.
  sendFile(res, 200, await exportService.accountJson(caller(req)));
});
