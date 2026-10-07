import { Router } from "express";

import { accountRouter } from "./account.js";
import { authRouter } from "./auth.js";
import { catalogRouter } from "./catalogs.js";
import { sharesRouter } from "./shares.js";
import { healthRouter } from "./health.js";
import { notesRouter } from "./notes.js";
import { peopleRouter } from "./people.js";
import { applyTemplateRouter, noteTemplatesRouter } from "./note-templates.js";
import { attachmentBytesRouter, attachmentsRouter } from "./attachments.js";
import { bookmarksRouter } from "./bookmarks.js";
import { collectionsRouter } from "./collections.js";

import { syncRouter } from "./sync.js";
import { listsRouter, searchRouter } from "./lists.js";
import {
  dashboardRouter,
  invitationsRouter,
  workspacesRouter,
} from "./workspaces.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
// La cuenta, pero no la autenticacion: `DELETE /auth/account` borra la cuenta
// y eso si es auth; esto sirve su exportacion, que es contenido.
apiRouter.use("/account", accountRouter);
apiRouter.use("/sync", syncRouter);
apiRouter.use("/workspaces", workspacesRouter);
apiRouter.use("/invitations", invitationsRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/lists", listsRouter);
// Templates before `/notes`, because Express matches a prefix: the notes router
// would swallow them and its authentication check would answer 401 for a route
// that does not exist, which is exactly the confusion the 501 exists to avoid.
// The publish verbs live inside the templates router now, so there is no longer
// a 501 standing in for them: they are built, and the route is the one the
// placeholder was holding the door for.
apiRouter.use("/notes/templates", noteTemplatesRouter);
// Under `/notes/templates/apply` rather than a top level `/notes/apply`, because
// it is a template doing something and the result is a note.
apiRouter.use("/templates", applyTemplateRouter);
// Before the notes router, for the same reason the templates are: Express matches
// a prefix, so afterwards the notes router's authentication check would answer 401
// for a path that is not its own.
// The local driver's bytes, signed rather than authenticated: the client never
// sends a session to a URL it got in exchange for one.
apiRouter.use("/attachments", attachmentBytesRouter);
// Both notes routers sit on `/notes` and their paths do not collide: the
// attachments one is `/notes/:noteId/attachments` and the notes one is `/notes/:id`.
// Express tries them in order, so the order only matters in that both must come
// before nothing in particular.
apiRouter.use("/notes", attachmentsRouter);
apiRouter.use("/notes", notesRouter);
apiRouter.use("/collections", collectionsRouter);
apiRouter.use("/bookmarks", bookmarksRouter);
apiRouter.use("/catalog", catalogRouter);
apiRouter.use("/people", peopleRouter);
apiRouter.use("/shares", sharesRouter);
apiRouter.use("/search", searchRouter);
