import { paginationQuerySchema, uuidSchema } from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { workspaceQueryService } from '../modules/workspaces/workspace-query-service.js';

import { sendData } from './respond.js';

export const workspacesRouter = Router();
export const dashboardRouter = Router();

workspacesRouter.use(requireAuth);

const workspaceParams = z.object({ id: uuidSchema });

/** Every route resolves the caller first, so authorisation is never implicit. */
function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw HttpError.unauthorized();
  return req.auth.userId;
}

workspacesRouter.get('/', async (req, res) => {
  const { limit, cursor } = paginationQuerySchema.parse(req.query);
  sendData(res, 200, await workspaceQueryService.listWorkspaces(caller(req), limit, cursor ?? null));
});

workspacesRouter.get('/:id', async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  sendData(res, 200, await workspaceQueryService.getWorkspace(caller(req), id));
});

const folderQuery = paginationQuerySchema.extend({
  /** Absent returns the whole tree; `root` returns only top level folders. */
  parentId: z.string().optional(),
});

workspacesRouter.get('/:id/folders', async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  const { limit, cursor, parentId } = folderQuery.parse(req.query);

  const parent = parentId === undefined ? undefined : parentId === 'root' ? null : parentId;
  if (parent !== undefined && parent !== null) {
    uuidSchema.parse(parent);
  }

  sendData(
    res,
    200,
    await workspaceQueryService.listFolders(caller(req), id, {
      parentId: parent,
      limit,
      cursor: cursor ?? null,
    }),
  );
});

workspacesRouter.get('/:id/members', async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  sendData(res, 200, await workspaceQueryService.listMembers(caller(req), id));
});

dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (req, res) => {
  sendData(res, 200, await workspaceQueryService.getDashboard(caller(req)));
});
