import type {
  DashboardLayout,
  Folder,
  ListFoldersResponse,
  ListWorkspaceMembersResponse,
  ListWorkspacesResponse,
  Workspace,
  WorkspaceMember,
} from '@orbit-hub/contracts';
import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { dashboardLayouts, folders, memberships, users, workspaces } from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';

type Role = Workspace['role'];

/** Read side of the content API. Every write goes through the sync engine. */
export class WorkspaceQueryService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  async listWorkspaces(userId: string, limit: number, cursor: string | null): Promise<ListWorkspacesResponse> {
    const db = await this.db();
    const after = cursor ? new Date(cursor) : null;

    const workspaceConditions = [eq(memberships.userId, userId), isNull(workspaces.deletedAt)];
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
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      role: row.role as Role,
      memberCount: row.memberCount,
    }));

    const last = rows.at(-1);
    return {
      items,
      nextCursor: rows.length === limit && last ? last.updatedAt.toISOString() : null,
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
      throw HttpError.notFound('Workspace not found');
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
      role: row.role as Role,
      memberCount: row.memberCount,
    };
  }

  async listFolders(
    userId: string,
    workspaceId: string,
    options: { parentId?: string | null; limit: number; cursor: string | null },
  ): Promise<ListFoldersResponse> {
    // Authorisation first: an invisible workspace must not leak folder counts.
    await this.getWorkspace(userId, workspaceId);

    const db = await this.db();
    const after = options.cursor ? new Date(options.cursor) : null;

    const conditions = [eq(folders.workspaceId, workspaceId), isNull(folders.deletedAt)];

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
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
    }));

    const last = rows.at(-1);
    return {
      items,
      nextCursor: rows.length === options.limit && last ? last.updatedAt.toISOString() : null,
    };
  }

  async listMembers(userId: string, workspaceId: string): Promise<ListWorkspaceMembersResponse> {
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
      role: row.role as WorkspaceMember['role'],
      joinedAt: row.createdAt.toISOString(),
    }));

    return { items };
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
      layout: row.layout,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const workspaceQueryService = new WorkspaceQueryService();
