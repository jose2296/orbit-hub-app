import type { SyncChange } from '@orbit-hub/contracts';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import type { MembershipRoleName, SyncEntityName } from '../../db/constants.js';
import {
  dashboardLayouts,
  folders,
  listItems,
  lists,
  memberships,
  notes,
  shares,
  syncCursors,
  syncOperations,
  workspaces,
} from '../../db/schema.js';
import { accessOf } from '../shares/access.js';

/** One live grant, resolved into the chain that holds the node it points at. */
interface CadenaCompartida {
  nodeType: string;
  workspaceId: string;
  folderId: string | null;
  listId: string | null;
  /** Set when the grant is a note. A note is not in a list, so it has no `listId`. */
  noteId: string | null;
  role: 'editor' | 'viewer';
}

/**
 * A share's node type as a sync entity name, or `null` for one that is not a
 * node the sync stream carries. Written out rather than cast, because the
 * alternative is a `as` that is a promise: adding a shareable type to
 * `shareNodeType` without teaching this function about it would silently stop
 * the tombstones for it, and nothing would say so.
 */
function toEntityName(nodeType: string): SyncEntityName | null {
  if (nodeType === 'workspace') return 'workspace';
  if (nodeType === 'folder') return 'folder';
  if (nodeType === 'list') return 'list';
  if (nodeType === 'list_item') return 'list_item';
  if (nodeType === 'note') return 'note';
  return null;
}

/**
 * A node whose grant was taken back, as a change the app can act on.
 *
 * A device that received a list and cached it keeps showing it after the grant
 * is revoked, because that row in the cache is *yours* and nothing in the
 * cursor's stream says otherwise. The chain filter stops bringing new rows; it
 * does not take back the ones already on the phone. So a revocation that only
 * stops the pull leaves a list in somebody's menu that they can open, read and
 * even edit offline, and whose only sign that it is not really theirs is that
 * the next pull says nothing.
 *
 * It is a tombstone — the same shape a delete produces, `deletedAt` set — and
 * not a new entity kind. The app already filters `deletedAt` for its own
 * deletes, and a second way of saying "go away" would be one more thing every
 * reader has to learn.
 *
 * `revokedAt` is the cursor field and not `updatedAt`, so a share that is granted,
 * revoked, granted again and revoked again reports the second revocation.
 */
export function changeDeRevocada(
  nodeType: string,
  nodeId: string,
  revokedAt: Date,
  previo: Record<string, unknown> | null,
): SyncChange | null {
  const entity = toEntityName(nodeType);
  if (!entity) return null;

  return {
    entity,
    record: {
      ...(previo ?? {}),
      id: nodeId,
      // `updatedAt` moves to the revocation and not to the row's own date, and
      // that is not a detail. The pull sorts by `updatedAt` and hands out a
      // cursor built from the largest one it saw, so a tombstone carrying the
      // old date would sort to the front of the page while the cursor jumped
      // past it — the change would be delivered after the cursor had already
      // moved beyond it, and on a device that pulled twice in that window it
      // would arrive out of order or not at all.
      updatedAt: revokedAt.toISOString(),
      deletedAt: revokedAt.toISOString(),
      // Why it went, in the one place the app can read it without asking again.
      // Without it the app can only say "this disappeared", and the person is
      // left wondering whether they did something.
      withdrawn: true,
    },
  };
}

/** The ids of one kind out of the shared chains, for an `in` that has to be non-empty. */
function cadenaDe(
  cadenas: readonly { folderId: string | null; listId: string | null; noteId: string | null }[],
  campo: 'folderId' | 'listId' | 'noteId',
): string[] {
  return cadenas.map((c) => c[campo]).filter((v): v is string => Boolean(v));
}

export type SyncEntityTable =
  | typeof workspaces
  | typeof folders
  | typeof lists
  | typeof listItems
  | typeof notes
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
      case 'note':
        return notes;
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
  async upsertDashboard(
    userId: string,
    layout: unknown,
    pages = 1,
  ): Promise<StoredEntity> {
    const db = await this.db();
    const [row] = await db
      .insert(dashboardLayouts)
      .values({ userId, layout: layout as never, pages })
      .onConflictDoUpdate({
        target: dashboardLayouts.userId,
        set: {
          layout: layout as never,
          pages,
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

  /**
   * Whether anybody at all is a member of this workspace.
   *
   * Asked only to tell an orphaned row apart from somebody else's: a workspace
   * with no members is a row whose owner membership was lost and is safe to
   * re-give, and a workspace with members belongs to them and must stay closed.
   */
  async hasAnyMember(workspaceId: string): Promise<boolean> {
    const db = await this.db();
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(memberships)
      .where(eq(memberships.workspaceId, workspaceId))
      .limit(1);

    return row !== undefined;
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
          noteId: null,
          role: grant.role,
        });
        continue;
      }

      if (grant.nodeType === 'note') {
        // A note is not inside a list, so it cannot be resolved by walking up to
        // one. It used to fall through to the item branch below, find no item
        // with that id, and be dropped — which meant the grant appeared in the
        // space, said you could edit, and delivered nothing at all.
        const row = await db
          .select({ workspaceId: notes.workspaceId })
          .from(notes)
          .where(eq(notes.id, grant.nodeId))
          .limit(1);
        const found = row[0];
        if (!found) continue;
        cadenas.push({
          nodeType: 'note',
          workspaceId: found.workspaceId,
          folderId: null,
          listId: null,
          noteId: grant.nodeId,
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
        /*
          The granted folder **itself**, and the list and the note branches above
          both do the same thing with their own id.

          It used to push `parentId` here, which meant a folder grant pointed at
          whatever held the folder and never at the folder: sharing a top-level
          folder produced a chain with `folderId: null`, so the folder filter
          (`inArray(folders.id, cadenaDe(cadenas, 'folderId'))`) matched nothing and
          the folder nobody was ever shown **did not reach the other phone**. A
          nested one arrived as its parent, which is the wrong folder, and its own
          contents still did not come.

          The parent goes in as well, and as a chain of its own, because a device
          cannot draw a folder it has no parent for — which is the same reason
          `ancestorsOf` walks up in the share service.
        */
        cadenas.push({
          nodeType: 'folder',
          workspaceId: found.workspaceId,
          folderId: grant.nodeId,
          listId: null,
          noteId: null,
          role: grant.role,
        });
        if (found.parentId) {
          cadenas.push({
            nodeType: 'folder',
            workspaceId: found.workspaceId,
            folderId: found.parentId,
            listId: null,
            noteId: null,
            role: grant.role,
          });
        }
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
        noteId: null,
        role: grant.role,
      });
    }

    return cadenas;
  }

  /**
   * The grants this person had that were taken back after the cursor.
   *
   * `revokedAt` and not `updatedAt` on purpose. Re-granting a share touches
   * `updatedAt` and clears `revokedAt`, so with `updatedAt` a share that was
   * granted, revoked, granted again and revoked again would report the first
   * revocation forever and never the second: the device would keep re-hiding a
   * list the person is allowed to see, and there is no way for it to tell that
   * apart from a bug.
   */
  private async revocadasDesde(
    userId: string,
    after: Date,
  ): Promise<SyncChange[]> {
    const db = await this.db();

    const rows = await db
      .select({
        nodeType: shares.nodeType,
        nodeId: shares.nodeId,
        revokedAt: shares.revokedAt,
      })
      .from(shares)
      .where(
        and(
          eq(shares.granteeUserId, userId),
          isNotNull(shares.revokedAt),
          gt(shares.revokedAt, after),
        ),
      )
      .orderBy(asc(shares.revokedAt))
      .limit(50);

    const changes: SyncChange[] = [];
    for (const row of rows) {
      if (!row.revokedAt) continue;
      const entity = toEntityName(row.nodeType);
      if (!entity) continue;

      // The row the phone already has, with the deletion stamped on it. Sending
      // only `{ id, deletedAt }` would be enough to hide the list and not enough
      // to say a word about it, and a list that silently vanishes from the menu
      // is the thing that makes people stop trusting a sync.
      const previo = await this.findEntity(entity, row.nodeId);
      const change = changeDeRevocada(
        row.nodeType,
        row.nodeId,
        row.revokedAt,
        previo as Record<string, unknown> | null,
      );
      if (change) changes.push(change);
    }

    return changes;
  }

  /**
   * What this person can do with a node, and whether it is theirs.
   *
   * **It calls `accessOf` and does not decide anything.** The rules — that a grant
   * is a floor and your membership is the floor under that, that a grant can never
   * lift you above a space you are already in, that a grant never lowers you either
   * — live in one pure function in `modules/shares/access.ts`, and this is a second
   * place that needs them. A copy here would be a second answer to the same question
   * that nobody would remember to update, and the symptom would not be a crash: it
   * would be a header that says "puedes editarla" over a list you cannot edit, which
   * is the app lying about permissions in the one place somebody looks to find out
   * what they are allowed to do.
   *
   * `grantRole` is the strongest grant that reaches the node or anything above it,
   * because that is what makes a shared folder carry its lists.
   */
  private accesoDe(args: {
    workspaceId: string;
    folderId?: string | null;
    listId?: string | null;
    noteId?: string | null;
    rolesPorEspacio: Map<string, MembershipRoleName>;
    cadenas: CadenaCompartida[];
  }): { role: MembershipRoleName; shared: boolean } {
    const membershipRole = args.rolesPorEspacio.get(args.workspaceId) ?? null;

    // The strongest grant that reaches this node or anything above it, because
    // "reaches" is what makes a shared folder carry its lists and a shared list
    // carry its rows.
    let grantRole: 'editor' | 'viewer' | null = null;
    for (const cadena of args.cadenas) {
      const alcanza =
        (cadena.folderId !== null && cadena.folderId === args.folderId) ||
        (cadena.listId !== null && cadena.listId === args.listId) ||
        (cadena.noteId !== null && cadena.noteId === args.noteId);
      if (!alcanza) continue;
      if (grantRole === null || cadena.role === 'editor') grantRole = cadena.role;
    }

    const acceso = accessOf({ membershipRole, mountRole: null, grantRole });

    // `owner` is only ever the space's own membership role read straight through: a
    // grant is never an owner, so nobody reaches "owner" here without already being
    // the owner of that space.
    const role: MembershipRoleName =
      membershipRole === 'owner' ? 'owner' : acceso === 'edit' ? 'editor' : 'viewer';

    return {
      role,
      // "Shared" is how you got it, not how many people have it: `true` only when
      // there is a grant reaching it and you are not a member of its space. A list
      // three colleagues also have is in your space and is yours.
      shared: membershipRole === null && grantRole !== null,
    };
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

    /*
      The membership role per space, for the same query and in the same round trip.

      The workspace projection used to `leftJoin` the membership row and read the
      role off the join, which only works for workspaces. Every other node needs the
      role of the space it lives in, and a node is identified by its own id, so the
      role has to be looked up by that space — which is what this map is. One query
      for the whole page, not one per node: a pull that asked the database about
      every row it is about to return would be a hundred round trips to draw a
      header.
    */
    const rolesPorEspacio = new Map<string, MembershipRoleName>();
    if (memberWorkspaceIds.length > 0) {
      const propias = await db
        .select({ workspaceId: memberships.workspaceId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, input.userId));
      for (const row of propias) rolesPorEspacio.set(row.workspaceId, row.role);
    }

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

    /*
      The folders a grant reaches, used by every filter below.

      A grant on a folder names that folder. Its **children** are in the same space
      and below it, and nothing names them — so a filter that admits only the named
      ones delivers the folder, its parent, the space, and **nothing inside it**. And
      because nothing inside ever arrived, nothing inside ever changed, so nothing
      inside ever arrived later either: a device that was sent a folder kept an empty
      folder forever.

      This is one more `in`, not a walk of the tree. What lives under a shared folder
      still arrives in cursor order like anything else, one row at a time, as it
      changes — which is the contract the comment further up describes, and which the
      filters were not keeping.
    */
    const carpetasConcedidas = cadenaDe(cadenas, 'folderId');

    /*
     * The spaces that were handed over **whole**, and the reason this is a separate
     * list and not `cadenas.map(c => c.workspaceId)`.
     *
     * `cadenas` also carries the containing space of every other grant, so the obvious
     * one-liner hands a person the entire space when they were given a single list in
     * it. That is the mistake this line exists to not make.
     *
     * They are separate because the two grants mean different things and the sync
     * projection has to honour both:
     *
     * - A grant on a **folder** brings the things filed in it, and nothing beside it.
     * - A grant on a **list** brings the list, and not the notes next to it.
     * - A grant on the **space** brings the space: every folder, list, item and note
     *   in it. Otherwise "comparte este espacio" produces a space that arrives
     *   **empty** — the record comes down, the drawer lists it, and there is nothing
     *   in it, which reads as the share having failed rather than as half of it
     *   working. That is what was reported.
     */
    const espaciosConcedidos = cadenas
      .filter((c) => c.nodeType === 'workspace')
      .map((c) => c.workspaceId);
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
            wash: entry.row.wash ?? 'diagonal',
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
              // A space handed over whole brings its folders with it. See
              // `espaciosConcedidos`.
              inArray(folders.workspaceId, espaciosConcedidos),
              inArray(folders.id, carpetasConcedidas),
              inArray(folders.parentId, carpetasConcedidas),
            ),
            gt(folders.updatedAt, after),
          ),
        )
        .orderBy(asc(folders.updatedAt))
        .limit(input.limit - changes.length);

      for (const row of folderChanges) {
        changes.push({
          entity: 'folder',
          record: {
            ...(row as Record<string, unknown>),
            ...this.accesoDe({
              workspaceId: row.workspaceId,
              folderId: row.id,
              rolesPorEspacio,
              cadenas,
            }),
          },
        });
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
              inArray(lists.workspaceId, espaciosConcedidos),
              inArray(lists.id, cadenaDe(cadenas, 'listId')),
              // A list filed inside a folder somebody was handed. Same reason as the
              // folders above: the grant reaches it even though nothing names it.
              inArray(lists.folderId, carpetasConcedidas),
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
            ...this.accesoDe({
              workspaceId: row.workspaceId,
              listId: row.id,
              folderId: row.folderId,
              rolesPorEspacio,
              cadenas,
            }),
          },
        });
        remember(row.updatedAt);
      }
    }

    if (espaciosVisibles.length > 0 && changes.length < input.limit) {
      const itemChanges = await db
        .select({
          item: listItems,
          workspaceId: lists.workspaceId,
          // The folder the list is filed in, and not decoration: the filter below
          // admits a row because of a grant on that folder, and `accesoDe` has to
          // reach the same conclusion from the same facts. A row that arrives with
          // `shared: false` because the code that let it in knew something the code
          // that labels it did not is a row wearing the wrong badge.
          folderId: lists.folderId,
        })
        .from(listItems)
        .innerJoin(lists, eq(listItems.listId, lists.id))
        .where(
          and(
            or(
              inArray(lists.workspaceId, memberWorkspaceIds),
              inArray(lists.workspaceId, espaciosConcedidos),
              inArray(lists.id, cadenaDe(cadenas, 'listId')),
              // A row is reached by a grant on its list, or by a grant on the folder
              // the list is filed in. Both are "the grant reaches it", which is what
              // makes "comparte esta carpeta" mean the things inside it too.
              inArray(lists.folderId, carpetasConcedidas),
            ),
            gt(listItems.updatedAt, after),
          ),
        )
        .orderBy(asc(listItems.updatedAt))
        .limit(input.limit - changes.length);

      for (const row of itemChanges) {
        changes.push({
          entity: 'list_item',
          record: {
            ...(row.item as Record<string, unknown>),
            // The list it belongs to, because that is what a grant reaches: being
            // handed a list is being handed its rows, and there is no way to ask
            // "what is the space of this row" from the row itself.
            ...this.accesoDe({
              workspaceId: row.workspaceId,
              listId: row.item.listId,
              folderId: row.folderId,
              rolesPorEspacio,
              cadenas,
            }),
          },
        });
        remember(row.item.updatedAt);
      }
    }

    if (espaciosVisibles.length > 0 && changes.length < input.limit) {
      // Notes, in the same shape as items: the ones in a space the caller is in,
      // plus the ones a share handed them.
      //
      // A share of a note points at the note, and a share of a folder or a list
      // does not bring the notes filed under it. That is a decision about what a
      // grant means, not an oversight: a note is a document somebody wrote, and
      // being handed a shopping list is not consent to read the notes next to it.
      // Sharing a note is an explicit act, on a node of its own.
      const noteChanges = await db
        .select({ row: notes })
        .from(notes)
        .where(
          and(
            or(
              inArray(notes.workspaceId, memberWorkspaceIds),
              inArray(notes.workspaceId, espaciosConcedidos),
              inArray(notes.id, cadenaDe(cadenas, 'noteId')),
            ),
            gt(notes.updatedAt, after),
          ),
        )
        .orderBy(asc(notes.updatedAt))
        .limit(input.limit - changes.length);

      for (const row of noteChanges) {
        changes.push({
          entity: 'note',
          record: {
            ...(row.row as Record<string, unknown>),
            ...this.accesoDe({
              workspaceId: row.row.workspaceId,
              noteId: row.row.id,
              folderId: row.row.folderId,
              rolesPorEspacio,
              cadenas,
            }),
          },
        });
        remember(row.row.updatedAt);
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

    // What stopped being yours, so the device that has it takes it back.
    //
    // After the dashboard and not before: a revocation is rarer than a change, it
    // has to reach a device that was offline to matter, and the panel is the only
    // thing here that is about this person rather than about the content.
    const revocadas = await this.revocadasDesde(input.userId, after);
    for (const change of revocadas) {
      changes.push(change);
      remember(new Date(String(change.record['deletedAt'] ?? new Date().toISOString())));
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
