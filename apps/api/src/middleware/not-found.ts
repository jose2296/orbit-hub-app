import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../lib/http-error.js';

/** Anything that did not match a route ends here. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(HttpError.notFound(`No route matches ${req.method} ${req.path}`));
}
