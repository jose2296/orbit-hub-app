import type { Response } from 'express';

import type { ApiMeta } from '@orbit-hub/contracts';

/**
 * Success envelope. Every 2xx response with a body goes through here so the
 * shape matches `apiResponseSchema` in the shared contracts.
 */
export function sendData<T>(res: Response, status: number, data: T): void {
  const meta: ApiMeta = { requestId: String(res.getHeader('x-request-id') ?? '') };
  res.status(status).json({ data, meta });
}

/**
 * La excepcion al sobre, y existe porque los dos endpoints de exportacion
 * devuelven bytes con `Content-Disposition` y no el `{ data, meta }`: son los
 * primeros 2xx de la API que no pasan por `sendData`.
 *
 * El `filename=` ASCII lleva todo lo no-ASCII sustituido por `_` porque algunos
 * clientes solo leen ese y no el `filename*`; el `filename*` lleva el nombre
 * real percent-encoded (RFC 5987) para los que si lo leen. Sustituir tambien
 * los caracteres de control es lo que hace que un nombre raro no pueda meter
 * un salto de linea en la cabecera.
 */
export function sendFile(
  res: Response,
  status: number,
  file: { body: string | Buffer; contentType: string; filename: string },
): void {
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, '_');
  res.setHeader('content-type', `${file.contentType}; charset=utf-8`);
  res.setHeader('cache-control', 'no-store');
  res.setHeader(
    'content-disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  );
  res.setHeader('content-length', String(Buffer.byteLength(file.body)));
  res.status(status).send(file.body);
}
