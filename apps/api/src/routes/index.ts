import { Router } from 'express';

import { HttpError } from '../lib/http-error.js';

import { authRouter } from './auth.js';
import { healthRouter } from './health.js';
import { syncRouter } from './sync.js';
import { dashboardRouter, workspacesRouter } from './workspaces.js';

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
apiRouter.use('/sync', syncRouter);
apiRouter.use('/workspaces', workspacesRouter);
apiRouter.use('/dashboard', dashboardRouter);

// Phases 3 and 4. They answer 501 so the client can tell "not built yet" apart
// from "broken", instead of a bare 404.
apiRouter.use('/lists', placeholderRouter);
apiRouter.use('/notes', placeholderRouter);
