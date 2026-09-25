import { Router } from 'express';

import { HttpError } from '../lib/http-error.js';

import { authRouter } from './auth.js';
import { healthRouter } from './health.js';

/**
 * Endpoints that are contracted but not implemented yet return 501 with a
 * machine readable code, so the client can tell "not built" apart from "broken".
 */
const placeholderRouter = Router();

placeholderRouter.use((req) => {
  throw HttpError.notImplemented(
    `${req.method} ${req.baseUrl} is planned for the next phase. See docs/roadmap.md`,
  );
});

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/sync', placeholderRouter);
apiRouter.use('/workspaces', placeholderRouter);
