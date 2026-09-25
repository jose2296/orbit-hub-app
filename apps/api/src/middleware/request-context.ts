import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id, echoed in the response and in every log line. */
    requestId: string;
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
