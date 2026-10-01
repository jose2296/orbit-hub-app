import type {
  DashboardLayout,
  Folder,
  ListFoldersResponse,
  ListWorkspaceMembersResponse,
  ListWorkspacesResponse,
  Workspace,
  WorkspaceMember,
} from "@orbit-hub/contracts";
import { dashboardLayoutSchema } from "@orbit-hub/contracts";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { getDatabase } from "../../db/client.js";
import type { Database } from "../../db/client.js";
import {
  dashboardLayouts,
  folders,
  memberships,
  users,
  workspaces,
} from "../../db/schema.js";
import { HttpError } from "../../lib/http-error.js";

type Role = Workspace["role"];

/** Read side of the content API. Every write goes through the sync engine. */
export class WorkspaceQueryService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  async listWorkspaces(
    userId: string,
    limit: number,
    cursor: string | null,
  ): Promise<ListWorkspacesResponse> {
    const db = await this.db();
    const after = cursor ? new Date(cursor) : null;

    const workspaceConditions = [
      eq(memberships.userId, userId),
      isNull(workspaces.deletedAt),
    ];
    if (after) {
      // Ordered newest first, so the next page holds older rows.
      workspaceConditions.push(lt(workspaces.updatedAt, after));
    }

    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        emoji: workspaces.emoji,
        color: workspaces.color,
        colorTo: workspaces.colorTo,
        wash: workspaces.wash,
        version: workspaces.version,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
        deletedAt: workspaces.deletedAt,
        role: memberships.role,
        memberCount: sql<number>`(
          select count(*)::int from ${memberships} as m
          where m.workspace_id = ${workspaces.id}
        )`,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(and(...workspaceConditions))
      .orderBy(desc(workspaces.updatedAt))
      .limit(limit);

    const items: Workspace[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      color: row.color,
      colorTo: row.colorTo,
      wash: row.wash,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      role: row.role as Role,
      memberCount: row.memberCount,
      // Every row here comes from the memberships table, so none of them is a
      // space somebody merely gave you: this is the "all your spaces" screen, and
      // it does not show the shared ones. The flag is here because the contract
      // requires it, not because it can be true.
      shared: false,
    }));

    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        rows.length === limit && last ? last.updatedAt.toISOString() : null,
    };
  }

  /**
   * Loads a workspace the user belongs to. A workspace they cannot see and one
   * that does not exist are indistinguishable: both are 404.
   */
  async getWorkspace(userId: string, workspaceId: string): Promise<Workspace> {
    const db = await this.db();

    const [row] = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        emoji: workspaces.emoji,
        color: workspaces.color,
        colorTo: workspaces.colorTo,
        wash: workspaces.wash,
        version: workspaces.version,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
        deletedAt: workspaces.deletedAt,
        role: memberships.role,
        memberCount: sql<number>`(
          select count(*)::int from ${memberships} as m
          where m.workspace_id = ${workspaces.id}
        )`,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(workspaces.id, workspaceId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw HttpError.notFound("Workspace not found");
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      color: row.color,
      colorTo: row.colorTo,
      wash: row.wash,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
      role: row.role as Role,
      memberCount: row.memberCount,
      // Found through a membership, so by definition not shared: this method is
      // what the pull and the space screen call, and a space reached by a grant
      // is not one this lookup will ever return.
      shared: false,
    };
  }

  async listFolders(
    userId: string,
    workspaceId: string,
    options: { parentId?: string | null; limit: number; cursor: string | null },
  ): Promise<ListFoldersResponse> {
    // Authorisation first: an invisible workspace must not leak folder counts. And
    // it already answers the question the badge asks — reaching this endpoint means
    // being a member of that space, and the membership role it returns is the role
    // every folder inside it carries. One query, already being paid for.
    const espacio = await this.getWorkspace(userId, workspaceId);

    const db = await this.db();
    const after = options.cursor ? new Date(options.cursor) : null;

    const conditions = [
      eq(folders.workspaceId, workspaceId),
      isNull(folders.deletedAt),
    ];

    // `parentId: null` means the root level; absent means the whole tree.
    if (options.parentId !== undefined) {
      conditions.push(
        options.parentId === null
          ? isNull(folders.parentId)
          : eq(folders.parentId, options.parentId),
      );
    }
    if (after) {
      conditions.push(gt(folders.updatedAt, after));
    }

    const rows = await db
      .select()
      .from(folders)
      .where(and(...conditions))
      .orderBy(asc(folders.position), asc(folders.updatedAt))
      .limit(options.limit);

    const items: Folder[] = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      parentId: row.parentId,
      name: row.name,
      emoji: row.emoji,
      position: row.position,
      // Folders have no role of their own either: this is the role of the space
      // they are in, and `shared` is false because reaching this endpoint already
      // required being a member of it. The sync pull is where a folder somebody was
      // lent is marked, because there the caller has no membership.
      role: espacio.role,
      shared: false,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
    }));

    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        rows.length === options.limit && last
          ? last.updatedAt.toISOString()
          : null,
    };
  }

  async listMembers(
    userId: string,
    workspaceId: string,
  ): Promise<ListWorkspaceMembersResponse> {
    await this.getWorkspace(userId, workspaceId);

    const db = await this.db();
    const rows = await db
      .select({
        role: memberships.role,
        createdAt: memberships.createdAt,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.workspaceId, workspaceId))
      .orderBy(asc(memberships.createdAt));

    const items: WorkspaceMember[] = rows.map((row) => ({
      user: {
        id: row.userId,
        email: row.email,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
      },
      role: row.role as WorkspaceMember["role"],
      joinedAt: row.createdAt.toISOString(),
    }));

    return { items };
  }

  /**
   * Who somebody is, as far as a space is concerned: the name, the address and
   * the language. Used to write a mail that sounds like the person who sent it
   * and not like the server.
   */
  async getMemberProfile(
    userId: string,
    workspaceId: string,
  ): Promise<{
    displayName: string;
    email: string;
    locale: "es" | "en";
  } | null> {
    const db = await this.db();
    const [row] = await db
      .select({
        displayName: users.displayName,
        email: users.email,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!row) return null;
    return {
      displayName:
        row.displayName?.trim() || row.email.split("@")[0] || "Alguien",
      email: row.email,
      locale: row.locale === "en" ? "en" : "es",
    };
  }

  async getDashboard(userId: string): Promise<DashboardLayout> {
    const db = await this.db();
    const [row] = await db
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.userId, userId))
      .limit(1);

    if (!row) {
      // A user without a saved layout is normal, not an error.
      return {
        userId,
        layout: [],
        version: 0,
        updatedAt: new Date(0).toISOString(),
      };
    }

    return {
      userId: row.userId,
      // Through the schema, and not straight out of the column: a layout stored
      // before the panel had screens has no `page` on any card, and the schema's
      // default is what turns that into screen one. Returning the column as it is
      // would answer with a layout the response type says is wrong, and the
      // client would be the one repairing it.
      layout: dashboardLayoutSchema.shape.layout.parse(row.layout),
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const workspaceQueryService = new WorkspaceQueryService();
