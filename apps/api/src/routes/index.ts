import { Router } from 'express';

import { HttpError } from '../lib/http-error.js';

import { authRouter } from './auth.js';
import { catalogRouter } from './catalogs.js';
import { sharesRouter } from './shares.js';
import { healthRouter } from './health.js';
import { notesRouter } from './notes.js';
import { applyTemplateRouter, noteTemplatesRouter } from './note-templates.js';
import { attachmentBytesRouter, attachmentsRouter } from './attachments.js';

import { syncRouter } from './sync.js';
import { listsRouter, searchRouter } from './lists.js';
import { dashboardRouter, invitationsRouter, workspacesRouter } from './workspaces.js';

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
apiRouter.use('/invitations', invitationsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/lists', listsRouter);
// Templates before `/notes`, because Express matches a prefix: the notes router
// would swallow them and its authentication check would answer 401 for a route
// that does not exist, which is exactly the confusion the 501 exists to avoid.
// Before the templates router, for the same reason everything else here is:
// Express matches a prefix, and afterwards its authentication check answers 401
// for a route that is not built, which is the confusion the 501 exists to avoid.
apiRouter.use('/notes/templates/:templateId/publish', placeholderRouter);
apiRouter.use('/notes/templates', noteTemplatesRouter);
// Under `/notes/templates/apply` rather than a top level `/notes/apply`, because
// it is a template doing something and the result is a note.
apiRouter.use('/templates', applyTemplateRouter);
// Before the notes router, for the same reason the templates are: Express matches
// a prefix, so afterwards the notes router's authentication check would answer 401
// for a path that is not its own.
// The local driver's bytes, signed rather than authenticated: the client never
// sends a session to a URL it got in exchange for one.
apiRouter.use('/attachments', attachmentBytesRouter);
// Both notes routers sit on `/notes` and their paths do not collide: the
// attachments one is `/notes/:noteId/attachments` and the notes one is `/notes/:id`.
// Express tries them in order, so the order only matters in that both must come
// before nothing in particular.
apiRouter.use('/notes', attachmentsRouter);
apiRouter.use('/notes', notesRouter);
apiRouter.use('/catalog', catalogRouter);
apiRouter.use('/shares', sharesRouter);
apiRouter.use('/search', searchRouter);
