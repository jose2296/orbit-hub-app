import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';

function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

/** Single exit point for errors: one shape, one status, one log line. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = req.requestId ?? 'unknown';

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'The request payload is invalid',
        fields: zodFields(error),
        requestId,
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    // 501 means "planned, not built yet": it is a client-visible fact, not a fault.
    if (error.status >= 500 && error.status !== 501) {
      logger.error({ err: error, requestId, path: req.path }, 'request failed');
    } else {
      logger.warn({ code: error.code, requestId, path: req.path }, 'request rejected');
    }

    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        requestId,
      },
    });
    return;
  }

  logger.error({ err: error, requestId, path: req.path }, 'unhandled error');

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProduction ? 'Internal server error' : String((error as Error)?.message ?? error),
      requestId,
    },
  });
}
