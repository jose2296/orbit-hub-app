import type { NextFunction, Request, Response } from 'express';

import { verifyAccessToken } from '../lib/tokens.js';
import { HttpError } from '../lib/http-error.js';
import { authRepository } from '../modules/auth/auth-repository.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/**
 * Bearer token guard.
 *
 * The session row is read on every request so a revoked device stops working
 * immediately instead of at token expiry. When this becomes a measurable cost,
 * the fix is a short lived revocation cache, not skipping the check.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization');

  if (!header?.startsWith('Bearer ')) {
    next(HttpError.unauthorized());
    return;
  }

  try {
    const claims = await verifyAccessToken(header.slice('Bearer '.length).trim());
    const session = await authRepository.findSessionById(claims.sid, claims.sub);

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      next(HttpError.unauthorized('This session is no longer valid'));
      return;
    }

    req.auth = { userId: claims.sub, sessionId: claims.sid };
    next();
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    next(HttpError.unauthorized('Invalid access token'));
  }
}
