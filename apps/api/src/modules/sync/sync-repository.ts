import type { SyncChange } from '@orbit-hub/contracts';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import type { MembershipRoleName, SyncEntityName } from '../../db/constants.js';
import { dashboardLayouts, folders, memberships, syncCursors, syncOperations, workspaces } from '../../db/schema.js';

export type SyncEntityTable = typeof workspaces | typeof folders | typeof dashboardLayouts;

export interface StoredEntity {
  id: string;
  version: number;
  updatedAt: Date;
  deletedAt: Date | null;
  [key: string]: unknown;
}

export class SyncRepository {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  table(entity: SyncEntityName): SyncEntityTable {
    switch (entity) {
      case 'workspace':
        return workspaces;
      case 'folder':
        return folders;
      case 'dashboard':
        return dashboardLayouts;
      default:
        throw new Error(`Unsupported sync entity: ${entity}`);
    }
  }

  /** Idempotency: has this operation already been applied? */
  async findOperation(operationId: string): Promise<{ status: string; resultVersion: number | null } | null> {
    const db = await this.db();
    const [row] = await db
      .select({
        status: syncOperations.status,
        resultVersion: syncOperations.resultVersion,
      })
      .from(syncOperations)
      .where(eq(syncOperations.operationId, operationId))
      .limit(1);

    return row ?? null;
  }

  async recordOperation(input: {
    operationId: string;
    userId: string;
    entity: SyncEntityName;
    entityId: string;
    status: string;
    resultVersion: number | null;
  }): Promise<void> {
    const db = await this.db();
    await db.insert(syncOperations).values(input);
  }

  async findEntity(entity: SyncEntityName, entityId: string): Promise<StoredEntity | null> {
    const db = await this.db();
    const table = this.table(entity);
    const [row] = await db.select().from(table).where(eq(table.id, entityId)).limit(1);
    return (row as StoredEntity | undefined) ?? null;
  }

  async insertEntity(
    entity: SyncEntityName,
    values: Record<string, unknown>,
  ): Promise<StoredEntity> {
    const db = await this.db();
    const table = this.table(entity);
    const [row] = await db.insert(table).values(values).returning();
    if (!row) {
      throw new Error('The insert returned no row');
    }
    return row as StoredEntity;
  }

  async updateEntity(
    entity: SyncEntityName,
    entityId: string,
    values: Record<string, unknown>,
    options: { tombstone?: boolean } = {},
  ): Promise<StoredEntity> {
    const db = await this.db();
    const table = this.table(entity);

    const [row] = await db
      .update(table)
      .set({
        ...values,
        version: sql`${table.version} + 1`,
        updatedAt: new Date(),
        ...(options.tombstone ? { deletedAt: new Date() } : {}),
      })
      .where(eq(table.id, entityId))
      .returning();

    if (!row) {
      throw new Error('The update returned no row');
    }
    return row as StoredEntity;
  }

  /** One row per user, created on first write. */
  async upsertDashboard(userId: string, layout: unknown): Promise<StoredEntity> {
    const db = await this.db();
    const [row] = await db
      .insert(dashboardLayouts)
      .values({ userId, layout: layout as never })
      .onConflictDoUpdate({
        target: dashboardLayouts.userId,
        set: {
          layout: layout as never,
          version: sql`${dashboardLayouts.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw new Error('The dashboard upsert returned no row');
    }
    return row as unknown as StoredEntity;
  }

  async roleInWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipRoleName | null> {
    const db = await this.db();
    const [row] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .limit(1);

    return row?.role ?? null;
  }

  async addMembership(
    workspaceId: string,
    userId: string,
    role: MembershipRoleName,
  ): Promise<void> {
    const db = await this.db();
    await db
      .insert(memberships)
      .values({ workspaceId, userId, role })
      .onConflictDoUpdate({
        target: [memberships.workspaceId, memberships.userId],
        set: { role, updatedAt: new Date() },
      });
  }

  async removeMembership(workspaceId: string, userId: string): Promise<void> {
    const db = await this.db();
    await db
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  }

  /**
   * Changes after a cursor, across every entity the user can see.
   *
   * The cursor is the `updatedAt` of the last row returned, which is stable
   * because every write bumps it. Tombstones come back too, so a delete on one
   * device reaches the others.
   */
  async changesSince(input: {
    userId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ changes: SyncChange[]; nextCursor: string | null; hasMore: boolean }> {
    const db = await this.db();
    const after = input.cursor ? new Date(input.cursor) : new Date(0);

    const memberWorkspaceIds = (
      await db
        .select({ id: memberships.workspaceId })
        .from(memberships)
        .where(eq(memberships.userId, input.userId))
    ).map((row) => row.id);

    const changes: SyncChange[] = [];
    let lastUpdatedAt = null as Date | null;

    const remember = (updatedAt: Date) => {
      lastUpdatedAt = lastUpdatedAt && lastUpdatedAt > updatedAt ? lastUpdatedAt : updatedAt;
    };

    if (memberWorkspaceIds.length > 0) {
      const workspaceChanges = await db
        .select()
        .from(workspaces)
        .where(and(inArray(workspaces.id, memberWorkspaceIds), gt(workspaces.updatedAt, after)))
        .orderBy(asc(workspaces.updatedAt))
        .limit(input.limit);

      for (const row of workspaceChanges) {
        changes.push({ entity: 'workspace', record: row as Record<string, unknown> });
        remember(row.updatedAt);
      }
    }

    if (memberWorkspaceIds.length > 0 && changes.length < input.limit) {
      const folderChanges = await db
        .select()
        .from(folders)
        .where(and(inArray(folders.workspaceId, memberWorkspaceIds), gt(folders.updatedAt, after)))
        .orderBy(asc(folders.updatedAt))
        .limit(input.limit - changes.length);

      for (const row of folderChanges) {
        changes.push({ entity: 'folder', record: row as Record<string, unknown> });
        remember(row.updatedAt);
      }
    }

    if (changes.length < input.limit) {
      const dashboardChanges = await db
        .select()
        .from(dashboardLayouts)
        .where(
          and(
            eq(dashboardLayouts.userId, input.userId),
            gt(dashboardLayouts.updatedAt, after),
          ),
        )
        .orderBy(asc(dashboardLayouts.updatedAt))
        .limit(input.limit - changes.length);

      for (const row of dashboardChanges) {
        changes.push({ entity: 'dashboard', record: row as Record<string, unknown> });
        remember(row.updatedAt);
      }
    }

    changes.sort((a, b) => {
      const left = new Date((a.record['updatedAt'] as Date | string) ?? 0).getTime();
      const right = new Date((b.record['updatedAt'] as Date | string) ?? 0).getTime();
      return left - right;
    });

    return {
      changes,
      nextCursor: lastUpdatedAt ? lastUpdatedAt.toISOString() : input.cursor,
      hasMore: changes.length >= input.limit,
    };
  }

  async saveCursor(userId: string, deviceId: string, cursor: string | null): Promise<void> {
    const db = await this.db();
    await db
      .insert(syncCursors)
      .values({ userId, deviceId, cursor, lastSyncedAt: new Date() })
      .onConflictDoUpdate({
        target: [syncCursors.userId, syncCursors.deviceId],
        set: { cursor, lastSyncedAt: new Date(), updatedAt: new Date() },
      });
  }
}

export const syncRepository = new SyncRepository();
