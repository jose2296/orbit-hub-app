import {
  createInvitationRequestSchema,
  paginationQuerySchema,
  updateMemberRoleRequestSchema,
  uuidSchema,
} from "@orbit-hub/contracts";
import { Router } from "express";
import { z } from "zod";

import { logger } from "../lib/logger.js";
import { HttpError } from "../lib/http-error.js";
import { requireAuth } from "../middleware/require-auth.js";
import { emailSender, invitationEmail } from "../modules/email/email.js";
import { invitationService } from "../modules/workspaces/invitation-service.js";
import { workspaceQueryService } from "../modules/workspaces/workspace-query-service.js";

import { sendData } from "./respond.js";

export const workspacesRouter = Router();
export const dashboardRouter = Router();
export const invitationsRouter = Router();

workspacesRouter.use(requireAuth);

const workspaceParams = z.object({ id: uuidSchema });
const memberParams = z.object({ id: uuidSchema, userId: uuidSchema });
const invitationParams = z.object({ id: uuidSchema, invitationId: uuidSchema });
const tokenParams = z.object({ token: z.string().min(10).max(128) });

/** Every route resolves the caller first, so authorisation is never implicit. */
function caller(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw HttpError.unauthorized();
  return req.auth.userId;
}

workspacesRouter.get("/", async (req, res) => {
  const { limit, cursor } = paginationQuerySchema.parse(req.query);
  sendData(
    res,
    200,
    await workspaceQueryService.listWorkspaces(
      caller(req),
      limit,
      cursor ?? null,
    ),
  );
});

workspacesRouter.get("/:id", async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  sendData(res, 200, await workspaceQueryService.getWorkspace(caller(req), id));
});

const folderQuery = paginationQuerySchema.extend({
  /** Absent returns the whole tree; `root` returns only top level folders. */
  parentId: z.string().optional(),
});

workspacesRouter.get("/:id/folders", async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  const { limit, cursor, parentId } = folderQuery.parse(req.query);

  const parent =
    parentId === undefined ? undefined : parentId === "root" ? null : parentId;
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

workspacesRouter.get("/:id/members", async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  sendData(res, 200, await workspaceQueryService.listMembers(caller(req), id));
});

workspacesRouter.patch("/:id/members/:userId", async (req, res) => {
  const { id, userId } = memberParams.parse(req.params);
  const { role } = updateMemberRoleRequestSchema.parse(req.body);
  await invitationService.changeRole(caller(req), id, userId, role);
  res.status(204).end();
});

workspacesRouter.delete("/:id/members/:userId", async (req, res) => {
  const { id, userId } = memberParams.parse(req.params);
  await invitationService.removeMember(caller(req), id, userId);
  res.status(204).end();
});

/* ----------------------------------------------------------- invitations ---- */

/*
 * Invitations are the one write in this API that does not go through
 * `/sync/push`, and the reason is written down in the service: it is a message
 * between two people and not content somebody is editing offline.
 */

workspacesRouter.get("/:id/invitations", async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  sendData(res, 200, await invitationService.list(caller(req), id));
});

workspacesRouter.post("/:id/invitations", async (req, res) => {
  const { id } = workspaceParams.parse(req.params);
  // The space comes from the path and not from the body: a body that named a
  // different one would be two answers about where this invitation goes.
  const { role, email, expiresInHours } = createInvitationRequestSchema
    .omit({ workspaceId: true })
    .parse(req.body);

  const invitation = await invitationService.create(caller(req), {
    workspaceId: id,
    role,
    ...(email ? { email } : {}),
    expiresInHours,
  });

  // The mail goes out after the row exists and never fails the request over it:
  // an invitation that was made and not mailed is one the owner can still copy
  // by hand, and a request that failed with the row already written is one they
  // will press again and end up with two.
  if (email) await mailInvitation(caller(req), id, invitation, email);

  sendData(res, 201, invitation);
});

workspacesRouter.delete("/:id/invitations/:invitationId", async (req, res) => {
  const { id, invitationId } = invitationParams.parse(req.params);
  await invitationService.revoke(caller(req), id, invitationId);
  res.status(204).end();
});

/* --------------------------------------------------------- the link itself -- */

invitationsRouter.use(requireAuth);

invitationsRouter.get("/:token", async (req, res) => {
  const { token } = tokenParams.parse(req.params);
  sendData(res, 200, await invitationService.preview(caller(req), token));
});

invitationsRouter.post("/:token/accept", async (req, res) => {
  const { token } = tokenParams.parse(req.params);
  sendData(res, 200, await invitationService.accept(caller(req), token));
});

invitationsRouter.post("/:token/decline", async (req, res) => {
  const { token } = tokenParams.parse(req.params);
  await invitationService.decline(caller(req), token);
  res.status(204).end();
});

/**
 * Sends the invitation mail, or says why it did not go.
 *
 * The sender is the same one the verification mail uses, and the failure is
 * logged the same way: the invitation exists either way and the app shows the
 * link, so a provider that is down costs a mail and not a space.
 */
async function mailInvitation(
  userId: string,
  workspaceId: string,
  invitation: { token: string; role: "editor" | "viewer"; expiresAt: string },
  email: string,
): Promise<void> {
  try {
    const [workspace, inviter] = await Promise.all([
      workspaceQueryService.getWorkspace(userId, workspaceId),
      workspaceQueryService.getMemberProfile(userId, workspaceId),
    ]);

    await emailSender.send(
      invitationEmail({
        to: email,
        token: invitation.token,
        // In the language of whoever pressed the button. The person reading it
        // is the person who wrote it, and they are the one who knows what they
        // are inviting somebody to.
        locale: inviter?.locale ?? "es",
        workspaceName: workspace.name,
        inviterName: inviter?.displayName ?? "Alguien",
        role: invitation.role,
        expiresAt: new Date(invitation.expiresAt),
      }),
    );
  } catch (error) {
    logger.warn(
      { err: error, workspaceId, to: email },
      "the invitation was created but the mail did not go out",
    );
  }
}

dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res) => {
  sendData(res, 200, await workspaceQueryService.getDashboard(caller(req)));
});
