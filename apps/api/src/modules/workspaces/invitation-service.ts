import { randomBytes } from "node:crypto";

import type {
  AcceptInvitationResponse,
  IconRef,
  Invitation,
  InvitationStatus,
  ListInvitationsResponse,
  MembershipRole,
  PreviewInvitationResponse,
  Workspace,
} from "@orbit-hub/contracts";
import { membershipRoleRank, sanitiseIconRef } from "@orbit-hub/contracts";
import { and, desc, eq, gt, isNull, notExists, sql } from "drizzle-orm";

import { getDatabase } from "../../db/client.js";
import type { Database } from "../../db/client.js";
import {
  memberships,
  users,
  workspaceInvitations,
  workspaces,
} from "../../db/schema.js";
import { HttpError } from "../../lib/http-error.js";
import { workspaceQueryService } from "./workspace-query-service.js";

/** One invitation, read through the workspace and the person who sent it. */
interface InvitationRow {
  id: string;
  workspaceId: string;
  workspaceName: string;
  /** The whole `IconRef`, not only its emoji: the wire is the one that narrows. */
  workspaceIcon: IconRef | null;
  workspaceColor: Workspace["color"];
  role: "editor" | "viewer";
  status: "pending" | "accepted" | "declined" | "revoked";
  invitedEmail: string | null;
  expiresAt: Date;
  inviterName: string | null;
  inviterEmail: string | null;
}

/**
 * Invitations: the act of letting somebody into a space.
 *
 * Everything here goes through REST and not through `/sync/push`, and the reason
 * is worth writing down because the rest of the app says the opposite. An
 * invitation is not content somebody is editing: it is a message between two
 * people, it is addressed to one of them or to whoever has the link, and it
 * stops being true the moment it is used. Queuing one in an outbox and applying
 * it later is a way of inviting somebody to a space they were removed from
 * yesterday, and a way of mailing a link from a device that has not been online
 * in a week. So it is its own table, its own endpoints, and it is only ever
 * true right now.
 */
export class InvitationService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  /**
   * The role the caller has in a space, or null when they are not in it.
   *
   * A space they cannot see and one that does not exist are the same 404, and a
   * space they are only a viewer of is a 403: "you are not allowed" and "you
   * are not here" are different answers and the client shows different things.
   */
  private async requireRole(
    userId: string,
    workspaceId: string,
    minimum: MembershipRole = "viewer",
  ): Promise<MembershipRole> {
    const db = await this.db();
    const [row] = await db
      .select({ role: memberships.role, deletedAt: workspaces.deletedAt })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!row || row.deletedAt) throw HttpError.notFound("Workspace not found");
    if (
      membershipRoleRank[row.role as MembershipRole] <
      membershipRoleRank[minimum]
    ) {
      throw HttpError.forbidden(`This needs the ${minimum} role`);
    }

    return row.role as MembershipRole;
  }

  /** The pending and recent invitations of a space. Only an owner can see them. */
  async list(
    userId: string,
    workspaceId: string,
  ): Promise<ListInvitationsResponse> {
    await this.requireRole(userId, workspaceId, "owner");

    const db = await this.db();
    const rows = await db
      .select({
        id: workspaceInvitations.id,
        workspaceId: workspaceInvitations.workspaceId,
        role: workspaceInvitations.role,
        token: workspaceInvitations.token,
        status: workspaceInvitations.status,
        invitedEmail: workspaceInvitations.invitedEmail,
        expiresAt: workspaceInvitations.expiresAt,
        createdAt: workspaceInvitations.createdAt,
        acceptedAt: workspaceInvitations.acceptedAt,
        workspaceName: workspaces.name,
        inviterId: users.id,
        inviterName: users.displayName,
      })
      .from(workspaceInvitations)
      .innerJoin(
        workspaces,
        eq(workspaceInvitations.workspaceId, workspaces.id),
      )
      .leftJoin(users, eq(workspaceInvitations.invitedByUserId, users.id))
      .where(eq(workspaceInvitations.workspaceId, workspaceId))
      // Pending first, and newest first inside each: the ones somebody has to
      // act on are the ones at the top.
      .orderBy(
        sql`case when ${workspaceInvitations.status} = 'pending' then 0 else 1 end`,
        desc(workspaceInvitations.createdAt),
      );

    return { items: rows.map(toInvitation) };
  }

  /**
   * The invitations addressed to this person, waiting for an answer.
   *
   * **The other half of "the owner sees what they sent".** `list` answers "who did I
   * invite to this space"; this answers "who invited me and what have I not answered
   * yet", which had no endpoint at all. The only way in was a token from a mail, so
   * accepting an invitation meant opening a link in a message — and a mail that is also
   * the only door is a door that gets lost.
   *
   * Matched on **the caller's own email**, the same rule `assertUsable` uses, so the
   * list and the accept cannot disagree about who an invitation is for. An invitation
   * with no address — the "here is the link" kind — is not in this list: it is addressed
   * to nobody, and offering to accept one would be offering to accept a link somebody
   * happened to forward.
   *
   * Expired ones are left out rather than shown as dead, and so are the spaces this
   * person is already in: "you have been invited to a space you are in" has only one
   * sensible answer and should not be asked.
   */
  async listForCaller(userId: string): Promise<ListInvitationsResponse> {
    const db = await this.db();

    const [me] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const myEmail = me?.email?.toLowerCase();
    if (!myEmail) return { items: [] };

    const rows = await db
      .select({
        id: workspaceInvitations.id,
        workspaceId: workspaceInvitations.workspaceId,
        role: workspaceInvitations.role,
        token: workspaceInvitations.token,
        status: workspaceInvitations.status,
        invitedEmail: workspaceInvitations.invitedEmail,
        expiresAt: workspaceInvitations.expiresAt,
        createdAt: workspaceInvitations.createdAt,
        acceptedAt: workspaceInvitations.acceptedAt,
        workspaceName: workspaces.name,
        inviterId: users.id,
        inviterName: users.displayName,
      })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
      .leftJoin(users, eq(workspaceInvitations.invitedByUserId, users.id))
      .where(
        and(
          eq(workspaceInvitations.status, "pending"),
          eq(workspaceInvitations.invitedEmail, myEmail),
          gt(workspaceInvitations.expiresAt, new Date()),
          // Not a space this person is already in. `notExists` rather than a join
          // and a filter afterwards, so the membership cannot drop an invitation
          // out of the result by duplicating it.
          notExists(
            db
              .select({ one: sql`1` })
              .from(memberships)
              .where(
                and(
                  eq(memberships.workspaceId, workspaceInvitations.workspaceId),
                  eq(memberships.userId, userId),
                ),
              ),
          ),
        ),
      )
      // Newest first: the one somebody has to act on is the one that just arrived.
      .orderBy(desc(workspaceInvitations.createdAt));

    return { items: rows.map(toInvitation) };
  }

  /**
   * Invites somebody, by email or with a link.
   *
   * With an email it goes out by mail. Without one, the token is the invitation
   * and the app shows the link to send by whatever the two people already use.
   *
   * A space has one open link at a time and one open invitation per address. The
   * new one replaces the old token, so a link that was forwarded does not keep
   * working after the person asked again, and the pending list is a list of
   * people rather than a list of attempts. Addressed invitations are not
   * affected by a new link and the other way round: "here is the link" and "I
   * have also mailed you" are two different invitations and both are real.
   */
  async create(
    userId: string,
    input: {
      workspaceId: string;
      role: "editor" | "viewer";
      email?: string;
      expiresInHours: number;
    },
  ): Promise<Invitation> {
    await this.requireRole(userId, input.workspaceId, "owner");

    const db = await this.db();
    const workspace = await workspaceQueryService.getWorkspace(
      userId,
      input.workspaceId,
    );

    if (input.email) {
      // Inviting somebody who is already in is not a slower way of telling them
      // they are in: it is a second, contradictory answer about their role.
      const [already] = await db
        .select({ role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(
          and(
            eq(memberships.workspaceId, input.workspaceId),
            sql`lower(${users.email}) = ${input.email}`,
          ),
        )
        .limit(1);

      if (already) {
        throw HttpError.conflict(
          `${input.email} is already a member of this space`,
        );
      }
    }

    // A pending invitation to the same address is replaced instead of joined, so
    // the same person does not appear twice and only the newest link works.
    await db
      .update(workspaceInvitations)
      .set({ status: "revoked" })
      .where(
        and(
          eq(workspaceInvitations.workspaceId, input.workspaceId),
          eq(workspaceInvitations.status, "pending"),
          input.email
            ? eq(workspaceInvitations.invitedEmail, input.email)
            : isNull(workspaceInvitations.invitedEmail),
        ),
      );

    const token = newToken();
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);

    const [row] = await db
      .insert(workspaceInvitations)
      .values({
        workspaceId: input.workspaceId,
        invitedByUserId: userId,
        role: input.role,
        token,
        invitedEmail: input.email ?? null,
        expiresAt,
      })
      .returning();

    return {
      id: row!.id,
      workspaceId: row!.workspaceId,
      workspaceName: workspace.name,
      role: row!.role as Invitation["role"],
      token: row!.token,
      status: row!.status as InvitationStatus,
      invitedBy: { id: userId, displayName: await this.displayName(userId) },
      invitedEmail: row!.invitedEmail,
      expiresAt: row!.expiresAt.toISOString(),
      createdAt: row!.createdAt.toISOString(),
      acceptedAt: null,
    };
  }

  /** Throws away a pending invitation. Only the owner of the space can. */
  async revoke(
    userId: string,
    workspaceId: string,
    invitationId: string,
  ): Promise<void> {
    await this.requireRole(userId, workspaceId, "owner");

    const db = await this.db();
    const [row] = await db
      .update(workspaceInvitations)
      .set({ status: "revoked" })
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.status, "pending"),
        ),
      )
      .returning({ id: workspaceInvitations.id });

    if (!row)
      throw HttpError.notFound("That invitation is not waiting for an answer");
  }

  /**
   * What the link says, before deciding about it.
   *
   * The point is that the app can show "Te han invitado a Casa" with the name and
   * the colour of the space before the person presses anything. It says who it
   * is for, because an invitation addressed to somebody else is something you
   * have to be able to see and refuse rather than something you accept by
   * accident.
   */
  async preview(
    userId: string,
    token: string,
  ): Promise<PreviewInvitationResponse> {
    const db = await this.db();
    const row = await this.readByToken(db, token);

    const [me] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, row.workspaceId),
          eq(memberships.userId, userId),
        ),
      )
      .limit(1);

    return {
      workspace: {
        id: row.workspaceId,
        name: row.workspaceName,
        icon: sanitiseIconRef(row.workspaceIcon),
        color: row.workspaceColor,
      },
      role: row.role as "editor" | "viewer",
      invitedBy: displayNameOf(row.inviterName, row.inviterEmail),
      invitedEmail: row.invitedEmail,
      isForYou:
        !row.invitedEmail || row.invitedEmail === me?.email?.toLowerCase(),
      alreadyMember: Boolean(membership),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * Joins the person to the space.
   *
   * Clicking the link twice is not an error, it is somebody clicking twice, so an
   * existing member gets the space back with `alreadyMember: true` and keeps the
   * role they already had. Overwriting a role because a link from three weeks ago
   * was opened would be a way to lose a promotion to an old mail.
   */
  async accept(
    userId: string,
    token: string,
  ): Promise<AcceptInvitationResponse> {
    const db = await this.db();
    const row = await this.readByToken(db, token);
    await this.assertUsable(row, userId, db);

    const [existing] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, row.workspaceId),
          eq(memberships.userId, userId),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        workspace: await workspaceQueryService.getWorkspace(
          userId,
          row.workspaceId,
        ),
        alreadyMember: true,
      };
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(memberships)
        .values({ workspaceId: row.workspaceId, userId, role: row.role })
        .onConflictDoNothing();
      await tx
        .update(workspaceInvitations)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          acceptedByUserId: userId,
        })
        .where(eq(workspaceInvitations.id, row.id));
    });

    return {
      workspace: await workspaceQueryService.getWorkspace(
        userId,
        row.workspaceId,
      ),
      alreadyMember: false,
    };
  }

  /** Says no. Recorded, so the owner sees it instead of an invitation that hangs. */
  async decline(userId: string, token: string): Promise<void> {
    const db = await this.db();
    const row = await this.readByToken(db, token);
    await this.assertUsable(row, userId, db);

    await db
      .update(workspaceInvitations)
      .set({ status: "declined" })
      .where(eq(workspaceInvitations.id, row.id));
  }

  /**
   * Changes somebody's role.
   *
   * The owner cannot be given away from here and cannot be demoted: a space has
   * one owner and handing it over is a different screen with a different
   * confirmation, not a dropdown.
   */
  async changeRole(
    userId: string,
    workspaceId: string,
    memberId: string,
    role: "editor" | "viewer",
  ): Promise<void> {
    await this.requireRole(userId, workspaceId, "owner");

    if (memberId === userId) {
      throw HttpError.badRequest(
        "The owner of a space is not a role you can change here",
      );
    }

    const db = await this.db();
    const [row] = await db
      .update(memberships)
      .set({ role, updatedAt: new Date() })
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.userId, memberId),
        ),
      )
      .returning({ id: memberships.id });

    if (!row) throw HttpError.notFound("That person is not in this space");
  }

  /** Takes somebody out of the space. The owner cannot be taken out. */
  async removeMember(
    userId: string,
    workspaceId: string,
    memberId: string,
  ): Promise<void> {
    await this.requireRole(userId, workspaceId, "owner");

    if (memberId === userId) {
      throw HttpError.badRequest(
        "You are the owner. Delete the space if you do not want it any more.",
      );
    }

    const db = await this.db();
    const removed = await db
      .delete(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.userId, memberId),
        ),
      )
      .returning({ id: memberships.id });

    if (removed.length === 0)
      throw HttpError.notFound("That person is not in this space");
  }

  /**
   * A token nobody can guess and nobody can enumerate.
   *
   * 32 bytes of `randomBytes` in base64url: 256 bits, so guessing one is not a
   * thing anybody does by accident or on purpose. The invitation id is the id
   * and the token is separate, because the id travels in every API answer and a
   * link is the one thing that must not.
   */
  private async readByToken(
    db: Database,
    token: string,
  ): Promise<InvitationRow> {
    const rows = await db
      .select({
        id: workspaceInvitations.id,
        workspaceId: workspaceInvitations.workspaceId,
        role: workspaceInvitations.role,
        status: workspaceInvitations.status,
        invitedEmail: workspaceInvitations.invitedEmail,
        expiresAt: workspaceInvitations.expiresAt,
        workspaceName: workspaces.name,
        workspaceIcon: workspaces.icon,
        workspaceColor: workspaces.color,
        workspaceDeletedAt: workspaces.deletedAt,
        inviterName: users.displayName,
        inviterEmail: users.email,
      })
      .from(workspaceInvitations)
      .innerJoin(
        workspaces,
        eq(workspaceInvitations.workspaceId, workspaces.id),
      )
      .leftJoin(users, eq(workspaceInvitations.invitedByUserId, users.id))
      .where(eq(workspaceInvitations.token, token))
      .limit(1);

    const row = rows[0];
    // A link to a deleted space and a link that never existed are the same
    // answer, and neither of them is a 500.
    if (!row || row.workspaceDeletedAt)
      throw HttpError.notFound("This link is no longer valid");

    return row;
  }

  /**
   * A link is usable when it is pending and not past its date, and when it was
   * addressed to whoever is holding it.
   *
   * The email check is the one that matters: an invitation sent to one address
   * and forwarded to another is not an invitation to the person it now reaches.
   * The caller's address is read here rather than passed in, so no caller can
   * forget the check by handing over a truthy value.
   */
  private async assertUsable(
    row: {
      id: string;
      status: "pending" | "accepted" | "declined" | "revoked";
      invitedEmail: string | null;
      expiresAt: Date;
    },
    userId: string,
    db: Database,
  ): Promise<void> {
    if (row.status === "accepted") {
      throw HttpError.conflict("This invitation has already been used");
    }
    if (row.status === "revoked") {
      throw HttpError.forbidden("This invitation was withdrawn");
    }
    if (row.status === "declined") {
      throw HttpError.conflict("This invitation was already turned down");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw HttpError.forbidden("This invitation has expired");
    }

    if (row.invitedEmail) {
      const [me] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (me?.email?.toLowerCase() !== row.invitedEmail) {
        throw HttpError.forbidden(
          "This invitation was sent to a different email address",
        );
      }
    }
  }

  /** How the person who sent an invitation is called, for the mail and the list. */
  private async displayName(userId: string): Promise<string> {
    const db = await this.db();
    const [row] = await db
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return displayNameOf(row?.displayName ?? null, row?.email ?? null);
  }
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What somebody is called.
 *
 * A deleted user row is `null` and a mail that says "null te ha invitado" is a
 * mail nobody trusts, so the fallbacks are words, not a placeholder.
 */
function displayNameOf(name: string | null, email: string | null): string {
  return name?.trim() || email?.split("@")[0] || "Alguien";
}
export const invitationService = new InvitationService();

/**
 * One selected row as the contract's invitation.
 *
 * Shared by the two lists on purpose. They answer different questions — "who did I
 * invite" and "who invited me" — and both are read by the same app, so a field that
 * only one of them fills is a field that is sometimes missing for reasons nobody can
 * see. One mapper is what keeps the two answers the same shape.
 */
function toInvitation(row: {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
  token: string;
  status: string;
  invitedEmail: string | null;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  inviterId: string | null;
  inviterName: string | null;
}): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    role: row.role as Invitation["role"],
    token: row.token,
    status: row.status as InvitationStatus,
    invitedBy: {
      id: row.inviterId ?? "",
      displayName: row.inviterName ?? "",
    },
    invitedEmail: row.invitedEmail,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
  };
}
