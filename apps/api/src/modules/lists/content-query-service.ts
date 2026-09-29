import { isItemIcon, notePreviewBelowTitle } from '@orbit-hub/contracts';
import type {
  List,
  ListItem,
  ListItemsResponse,
  ListListsResponse,
  SearchResponse,
  SearchResult,
} from '@orbit-hub/contracts';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { folders, listItems, lists, memberships, notes, workspaces } from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';

import type { ListKindName } from '../../db/constants';

interface ListFilters {
  workspaceId?: string;
  folderId?: string;
  kind?: ListKindName;
  limit: number;
  cursor: string | null;
}

/** Read side of lists, items and search. Writes keep going through /sync/push. */
export class ContentQueryService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  /** Workspaces the caller belongs to. Everything else is filtered by this. */
  private async visibleWorkspaceIds(userId: string): Promise<string[]> {
    const db = await this.db();
    const rows = await db
      .select({ id: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    return rows.map((row) => row.id);
  }

  private async canSeeWorkspace(userId: string, workspaceId: string): Promise<void> {
    const db = await this.db();
    const [row] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)),
      )
      .limit(1);

    if (!row) {
      // Invisible and non existent look the same on purpose.
      throw HttpError.notFound('Workspace not found');
    }
  }

  async listLists(userId: string, filters: ListFilters): Promise<ListListsResponse> {
    const workspaceIds = filters.workspaceId
      ? await (async () => {
          await this.canSeeWorkspace(userId, filters.workspaceId as string);
          return [filters.workspaceId as string];
        })()
      : await this.visibleWorkspaceIds(userId);

    if (workspaceIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const db = await this.db();
    const conditions = [inArray(lists.workspaceId, workspaceIds), isNull(lists.deletedAt)];

    if (filters.folderId !== undefined) {
      conditions.push(eq(lists.folderId, filters.folderId));
    }
    if (filters.kind) {
      conditions.push(eq(lists.kind, filters.kind));
    }
    if (filters.cursor) {
      conditions.push(gt(lists.updatedAt, new Date(filters.cursor)));
    }

    const rows = await db
      .select()
      .from(lists)
      .where(and(...conditions))
      .orderBy(desc(lists.updatedAt))
      .limit(filters.limit);

    const items: List[] = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      folderId: row.folderId,
      kind: row.kind,
      title: row.title,
      description: row.description,
      emoji: row.emoji,
      tags: row.tags,
      position: row.position,
      version: row.version,
      itemCount: 0,
      orderMode: row.orderMode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
    }));

    const last = rows.at(-1);
    return {
      items,
      nextCursor: rows.length === filters.limit && last ? last.updatedAt.toISOString() : null,
    };
  }

  async getList(userId: string, listId: string): Promise<List> {
    const db = await this.db();
    const [row] = await db
      .select()
      .from(lists)
      .where(and(eq(lists.id, listId), isNull(lists.deletedAt)))
      .limit(1);

    if (!row) {
      throw HttpError.notFound('List not found');
    }

    // Authorisation after the lookup, so a list in a workspace the caller
    // cannot see is indistinguishable from one that does not exist.
    await this.canSeeWorkspace(userId, row.workspaceId);

    const countRow = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(listItems)
      .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)));

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      folderId: row.folderId,
      kind: row.kind,
      title: row.title,
      description: row.description,
      emoji: row.emoji,
      tags: row.tags,
      position: row.position,
      version: row.version,
      itemCount: countRow[0]?.total ?? 0,
      orderMode: row.orderMode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
    };
  }

  async listItems(
    userId: string,
    listId: string,
    filters: { completed?: boolean; limit: number; cursor: string | null },
  ): Promise<ListItemsResponse> {
    await this.getList(userId, listId);

    const db = await this.db();
    const conditions = [eq(listItems.listId, listId), isNull(listItems.deletedAt)];

    if (filters.completed !== undefined) {
      conditions.push(eq(listItems.completed, filters.completed));
    }
    if (filters.cursor) {
      conditions.push(gt(listItems.updatedAt, new Date(filters.cursor)));
    }

    const rows = await db
      .select()
      .from(listItems)
      .where(and(...conditions))
      .orderBy(asc(listItems.position), asc(listItems.createdAt))
      .limit(filters.limit);

    const items: ListItem[] = rows.map((row) => ({
      id: row.id,
      listId: row.listId,
      title: row.title,
      position: row.position,
      completed: row.completed,
      priority: row.priority,
      // An icon this build does not know is no icon, and not a broken row: the
      // column is free text and a future build can write a key this one has
      // never heard of. Showing nothing in the picture's place is a missing
      // detail; refusing to answer is a list that does not open.
      icon: isItemIcon(row.icon) ? row.icon : null,
      iconStyle: row.iconStyle,
      iconColor: row.iconColor,
      tags: row.tags ?? [],
      externalId: row.externalId,
      metadata: row.metadata,
      annotation: row.annotation,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
    }));

    const last = rows.at(-1);
    return {
      items,
      nextCursor: rows.length === filters.limit && last ? last.updatedAt.toISOString() : null,
    };
  }

  /**
   * One query, one shape: workspaces, folders, lists and items.
   *
   * The app also searches its own cache when offline, so this endpoint only
   * has to be right, not exhaustive.
   */
  async search(
    userId: string,
    query: { q: string; workspaceId?: string; kind?: ListKindName; limit: number },
  ): Promise<SearchResponse> {
    const workspaceIds = query.workspaceId
      ? await (async () => {
          await this.canSeeWorkspace(userId, query.workspaceId as string);
          return [query.workspaceId as string];
        })()
      : await this.visibleWorkspaceIds(userId);

    if (workspaceIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const db = await this.db();
    const pattern = `%${query.q.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    const results: SearchResult[] = [];

    const workspaceRows = await db
      .select()
      .from(workspaces)
      .where(
        and(
          inArray(workspaces.id, workspaceIds),
          isNull(workspaces.deletedAt),
          or(ilike(workspaces.name, pattern), ilike(workspaces.description, pattern)),
        ),
      )
      .limit(query.limit);

    for (const row of workspaceRows) {
      results.push({
        scope: 'workspace',
          completed: null,
        id: row.id,
        workspaceId: row.id,
        listId: null,
        kind: null,
        title: row.name,
        subtitle: row.description,
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    if (results.length < query.limit) {
      const folderRows = await db
        .select()
        .from(folders)
        .where(
          and(
            inArray(folders.workspaceId, workspaceIds),
            isNull(folders.deletedAt),
            ilike(folders.name, pattern),
          ),
        )
        .limit(query.limit - results.length);

      for (const row of folderRows) {
        results.push({
          scope: 'folder',
          completed: null,
          id: row.id,
          workspaceId: row.workspaceId,
          listId: null,
          kind: null,
          title: row.name,
          subtitle: null,
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }

    const listConditions = [
      inArray(lists.workspaceId, workspaceIds),
      isNull(lists.deletedAt),
      or(ilike(lists.title, pattern), ilike(lists.description, pattern)),
    ];
    if (query.kind) {
      listConditions.push(eq(lists.kind, query.kind));
    }

    if (results.length < query.limit) {
      const listRows = await db
        .select()
        .from(lists)
        .where(and(...listConditions))
        .limit(query.limit - results.length);

      for (const row of listRows) {
        results.push({
          scope: 'list',
          completed: null,
          id: row.id,
          workspaceId: row.workspaceId,
          listId: row.id,
          kind: row.kind,
          title: row.title,
          subtitle: row.description,
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }

    if (results.length < query.limit) {
      const itemRows = await db
        .select({ item: listItems, list: lists })
        .from(listItems)
        .innerJoin(lists, eq(listItems.listId, lists.id))
        .where(
          and(
            inArray(lists.workspaceId, workspaceIds),
            isNull(listItems.deletedAt),
            isNull(lists.deletedAt),
            ...(query.kind ? [eq(lists.kind, query.kind)] : []),
            or(ilike(listItems.title, pattern), ilike(listItems.annotation, pattern)),
          ),
        )
        .limit(query.limit - results.length);

      for (const row of itemRows) {
        results.push({
          scope: 'list_item',
          id: row.item.id,
          workspaceId: row.list.workspaceId,
          listId: row.list.id,
          kind: row.list.kind,
          title: row.item.title,
          subtitle: row.list.title,
          completed: row.item.completed,
          updatedAt: row.item.updatedAt.toISOString(),
        });
      }
    }

    if (results.length < query.limit) {
      // Notes are searched by what is written inside them, not only by their
      // title. That is the whole reason `plain_text` is denormalised on save: a
      // note called "Salsa" holding "six tomatoes per onion" is found by either
      // word, and the trigram index is what answers the second one.
      const noteRows = await db
        .select()
        .from(notes)
        .where(
          and(
            inArray(notes.workspaceId, workspaceIds),
            isNull(notes.deletedAt),
            or(ilike(notes.title, pattern), ilike(notes.plainText, pattern)),
          ),
        )
        .limit(query.limit - results.length);

      for (const row of noteRows) {
        results.push({
          scope: 'note',
          id: row.id,
          workspaceId: row.workspaceId,
          // A note is not in a list, so there is nothing to point at. The field is
          // null rather than the note's own id, which would make the app try to
          // open a list that does not exist.
          listId: null,
          kind: null,
          title: row.title,
          // The body, with the title cut off the front: a note whose first block
          // is its own heading would otherwise show the same words twice.
          subtitle: notePreviewBelowTitle(row.document, row.title),
          // `null` and not `false`: a note is not a row and cannot be ticked.
          completed: null,
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }

    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return { items: results.slice(0, query.limit), nextCursor: null };
  }
}

export const contentQueryService = new ContentQueryService();
