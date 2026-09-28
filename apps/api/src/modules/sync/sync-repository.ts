import type { SyncChange } from '@orbit-hub/contracts';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import type { MembershipRoleName, SyncEntityName } from '../../db/constants.js';
import {
  dashboardLayouts,
  folders,
  listItems,
  lists,
  memberships,
  shares,
  syncCursors,
  syncOperations,
  workspaces,
} from '../../db/schema.js';

/** One live grant, resolved into the chain that holds the node it points at. */
interface CadenaCompartida {
  nodeType: string;
  workspaceId: string;
  folderId: string | null;
  listId: string | null;
  role: 'editor' | 'viewer';
}

/** The ids of one kind out of the shared chains, for an `in` that has to be non-empty. */
function cadenaDe(
  cadenas: readonly { folderId: string | null; listId: string | null }[],
  campo: 'folderId' | 'listId',
): string[] {
  return cadenas.map((c) => c[campo]).filter((v): v is string => Boolean(v));
}

export type SyncEntityTable =
  | typeof workspaces
  | typeof folders
  | typeof lists
  | typeof listItems
  | typeof dashboardLayouts;

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
      case 'list':
        return lists;
      case 'list_item':
        return listItems;
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
  /**
   * The chains this person reaches without being a member.
   *
   * One row per live grant, resolved into the chain that holds the node: the node
   * itself, and the list, folder and space above it. A device cannot show a list
   * it has no folder for and no space for, so a grant on an item is useless to the
   * other end unless its whole path comes with it.
   *
   * The walk up the folders is bounded and not recursive on purpose: a cycle in
   * the folder tree would spin here forever, and a path of more than 32 folders is
   * not a thing a person built.
   */
  private async cadenasDeCompartido(userId: string): Promise<CadenaCompartida[]> {
    const db = await this.db();
    const grants = await db
      .select({
        nodeType: shares.nodeType,
        nodeId: shares.nodeId,
        // The grant's own role, and not the node's: it is what the space has to
        // show when this person is not a member of it, because a role there is
        // the only thing that says whether they can change what they were given.
        role: shares.role,
      })
      .from(shares)
      .where(and(eq(shares.granteeUserId, userId), isNull(shares.revokedAt)));

    const cadenas: CadenaCompartida[] = [];

    for (const grant of grants) {
      if (grant.nodeType === 'workspace') {
        cadenas.push({
          nodeType: 'workspace',
          workspaceId: grant.nodeId,
          folderId: null,
          listId: null,
          role: grant.role,
        });
        continue;
      }

      if (grant.nodeType === 'folder') {
        const row = await db
          .select({ workspaceId: folders.workspaceId, parentId: folders.parentId })
          .from(folders)
          .where(eq(folders.id, grant.nodeId))
          .limit(1);
        const found = row[0];
        if (!found) continue;
        cadenas.push({
          nodeType: 'folder',
          workspaceId: found.workspaceId,
          folderId: found.parentId,
          listId: null,
          role: grant.role,
        });
        continue;
      }

      const listId = grant.nodeType === 'list' ? grant.nodeId : (
        await db
          .select({ listId: listItems.listId })
          .from(listItems)
          .where(eq(listItems.id, grant.nodeId))
          .limit(1)
      )[0]?.listId;
      if (!listId) continue;

      const row = await db
        .select({ workspaceId: lists.workspaceId, folderId: lists.folderId })
        .from(lists)
        .where(eq(lists.id, listId))
        .limit(1);
      const found = row[0];
      if (!found) continue;
      cadenas.push({
        nodeType: grant.nodeType,
        workspaceId: found.workspaceId,
        folderId: found.folderId,
        listId,
        role: grant.role,
      });
    }

    return cadenas;
  }

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

    // What this person reaches without being a member of the space, and the spaces
    // that has to be read as: a granted node, and the chain that holds it.
    //
    // Chains and not subtrees, and it is worth saying why. This pull walks
    // forward by time and hands out a cursor, so "everything under that folder" is
    // a walk of a tree in the middle of a query that is supposed to be a slice of
    // a timeline. What a shared node needs to arrive is its own chain — itself,
    // its list, its folder, the space — because a device cannot show a list it has
    // no folder for. What lives *under* a shared folder arrives in cursor order
    // like anything else, one row at a time, as it changes, and the app has no idea
    // it is shared and needs none.
    const cadenas = await this.cadenasDeCompartido(input.userId);
    const espaciosVisibles = [
      ...new Set([...memberWorkspaceIds, ...cadenas.map((c) => c.workspaceId)]),
    ];

    const changes: SyncChange[] = [];
    let lastUpdatedAt = null as Date | null;

    const remember = (updatedAt: Date) => {
      lastUpdatedAt = lastUpdatedAt && lastUpdatedAt > updatedAt ? lastUpdatedAt : updatedAt;
    };

    if (espaciosVisibles.length > 0) {
      // The grants that put you in each space, and the one with the most reach if
      // there are several: somebody who was given a folder with an editor grant and
      // a list inside it with a viewer grant is, in that space, an editor — the
      // broader one is the one they will meet.
      const porEspacio = new Map<string, 'editor' | 'viewer'>();
      for (const cadena of cadenas) {
        if (cadena.role === 'editor' || !porEspacio.has(cadena.workspaceId)) {
          porEspacio.set(cadena.workspaceId, cadena.role);
        }
      }
      const compartidos = new Set(porEspacio.keys());

      const workspaceChanges = await db
        .select({
          row: workspaces,
          role: memberships.role,
          memberCount: sql<number>`(
            select count(*)::int from ${memberships} as m
            where m.workspace_id = ${workspaces.id}
          )`,
        })
        .from(workspaces)
        .leftJoin(
          memberships,
          and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, input.userId)),
        )
        .where(
          and(
            inArray(workspaces.id, espaciosVisibles),
            gt(workspaces.updatedAt, after),
          ),
        )
        .orderBy(asc(workspaces.updatedAt))
        .limit(input.limit);

      for (const entry of workspaceChanges) {
        // The cache is the app's read model, including offline, so a workspace
        // has to carry the fields the list screen renders. Without these the
        // client sees a workspace with no role and no member count.
        changes.push({
          entity: 'workspace',
          record: {
            ...(entry.row as Record<string, unknown>),
            // The membership role when there is one, and the grant's role when there
            // is not. Never "owner": a space you were given is not a space you own.
            role: entry.role ?? porEspacio.get(entry.row.id) ?? 'viewer',
            memberCount: entry.memberCount,
            // The flag the app draws the symbol from, and it is not the same thing
            // as the role: a viewer who was *invited* is a member, and a viewer who
            // was *given a list* is not. One word for both would put the symbol on
            // the wrong spaces.
            shared: entry.role === null && compartidos.has(entry.row.id),
          },
        });
        remember(entry.row.updatedAt);
      }
    }

    if (espaciosVisibles.length > 0 && changes.length < input.limit) {
      const folderChanges = await db
        .select()
        .from(folders)
        .where(
          and(
            or(
              inArray(folders.workspaceId, memberWorkspaceIds),
              inArray(folders.id, cadenaDe(cadenas, 'folderId')),
            ),
            gt(folders.updatedAt, after),
          ),
        )
        .orderBy(asc(folders.updatedAt))
        .limit(input.limit - changes.length);

      for (const row of folderChanges) {
        changes.push({ entity: 'folder', record: row as Record<string, unknown> });
        remember(row.updatedAt);
      }
    }

    if (espaciosVisibles.length > 0 && changes.length < input.limit) {
      const listChanges = await db
        .select()
        .from(lists)
        .where(
          and(
            or(
              inArray(lists.workspaceId, memberWorkspaceIds),
              inArray(lists.id, cadenaDe(cadenas, 'listId')),
            ),
            gt(lists.updatedAt, after),
          ),
        )
        .orderBy(asc(lists.updatedAt))
        .limit(input.limit - changes.length);

      // itemCount is derived, not stored, so the projection has to count. It is
      // a separate grouped query on purpose: inside a correlated subquery
      // Drizzle emits an unqualified "id" when the outer query has no join,
      // which silently compares list_items.list_id with list_items.id and always
      // counts zero. The client then renders the raw `{count}` placeholder.
      const itemCounts = new Map<string, number>();
      if (listChanges.length > 0) {
        const counted = await db
          .select({ listId: listItems.listId, total: sql<number>`count(*)::int` })
          .from(listItems)
          .where(
            and(
              inArray(
                listItems.listId,
                listChanges.map((row) => row.id),
              ),
              isNull(listItems.deletedAt),
            ),
          )
          .groupBy(listItems.listId);

        for (const row of counted) {
          itemCounts.set(row.listId, row.total);
        }
      }

      for (const row of listChanges) {
        changes.push({
          entity: 'list',
          record: {
            ...(row as Record<string, unknown>),
            itemCount: itemCounts.get(row.id) ?? 0,
          },
        });
        remember(row.updatedAt);
      }
    }

    if (espaciosVisibles.length > 0 && changes.length < input.limit) {
      const itemChanges = await db
        .select({ item: listItems })
        .from(listItems)
        .innerJoin(lists, eq(listItems.listId, lists.id))
        .where(
          and(
            or(
              inArray(lists.workspaceId, memberWorkspaceIds),
              inArray(lists.id, cadenaDe(cadenas, 'listId')),
            ),
            gt(listItems.updatedAt, after),
          ),
        )
        .orderBy(asc(listItems.updatedAt))
        .limit(input.limit - changes.length);

      for (const row of itemChanges) {
        changes.push({ entity: 'list_item', record: row.item as Record<string, unknown> });
        remember(row.item.updatedAt);
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
