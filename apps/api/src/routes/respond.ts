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
