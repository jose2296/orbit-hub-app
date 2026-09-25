import type {
  List,
  ListItem,
  ListKind,
  SearchResult,
} from '@orbit-hub/contracts';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  enqueueOperation,
  getLocalStoreReady,
  localUpdate,
  pullIntoCache,
  readCachedWorkspaces,
  subscribeToLocalStore,
} from '@/lib/offline';
import type { CachedEntity } from '@/lib/offline';

/**
 * Lists and items follow the same local-first rule as the rest of the content:
 * the screen reads the cache, the write is local, and the outbox does the rest.
 */

function readRecord<T>(row: CachedEntity): T {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending ? (JSON.parse(row.pending) as Record<string, unknown>) : null;

  return {
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  } as T;
}

export interface ListFilters {
  workspaceId?: string;
  folderId?: string;
  kind?: ListKind;
  favorite?: boolean;
}

export function useLists(filters: ListFilters = {}) {
  const [lists, setLists] = useState<List[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { workspaceId, folderId, kind, favorite } = filters;

  const load = useCallback(async () => {
    const store = await getLocalStoreReady();
    const rows = await store.listCached('list');

    const visible = rows
      .map((row) => readRecord<List>(row))
      .filter((list) => list.deletedAt === null)
      .filter((list) => (workspaceId ? list.workspaceId === workspaceId : true))
      .filter((list) => (folderId !== undefined ? list.folderId === folderId : true))
      .filter((list) => (kind ? list.kind === kind : true))
      .filter((list) => (favorite !== undefined ? list.favorite === favorite : true));

    visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setLists(visible);
    setIsLoading(false);
  }, [favorite, folderId, kind, workspaceId]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const createList = useCallback(
    async (input: { workspaceId: string; title: string; kind: ListKind; emoji?: string }) => {
      const store = await getLocalStoreReady();
      const id = Crypto.randomUUID();
      const now = new Date().toISOString();

      await store.upsertCached([
        {
          entity: 'list',
          entityId: id,
          version: 0,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify({
            id,
            workspaceId: input.workspaceId,
            folderId: null,
            kind: input.kind,
            title: input.title,
            description: null,
            emoji: input.emoji ?? null,
            favorite: false,
            tags: [],
            position: 0,
            version: 0,
            itemCount: 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }),
          pending: null,
        },
      ]);

      await enqueueOperation({
        kind: 'create',
        entity: 'list',
        entityId: id,
        baseVersion: 0,
        payload: {
          workspaceId: input.workspaceId,
          title: input.title,
          kind: input.kind,
          ...(input.emoji ? { emoji: input.emoji } : {}),
        },
      });

      await load();
      return id;
    },
    [load],
  );

  const deleteList = useCallback(
    async (list: List) => {
      const store = await getLocalStoreReady();
      const cached = await store.getCached('list', list.id);

      if (cached) {
        await store.upsertCached([
          {
            ...cached,
            deletedAt: nowIso(),
            updatedAt: nowIso(),
            pending: JSON.stringify({ deletedAt: nowIso() }),
          },
        ]);
      }

      await enqueueOperation({
        kind: 'delete',
        entity: 'list',
        entityId: list.id,
        baseVersion: cached?.version ?? list.version,
        payload: null,
      });

      await load();
    },
    [load],
  );

  const toggleFavorite = useCallback(
    async (list: List) => {
      await localUpdate('list', list.id, { favorite: !list.favorite });
      await load();
    },
    [load],
  );

  return { lists, isLoading, createList, deleteList, toggleFavorite, reload: load };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function useListItems(listId: string | undefined) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(true);

  const load = useCallback(async () => {
    if (!listId) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    const store = await getLocalStoreReady();
    const rows = await store.listCached('list_item');

    const visible = rows
      .map((row) => readRecord<ListItem>(row))
      .filter((item) => item.listId === listId && item.deletedAt === null)
      .filter((item) => (showCompleted ? true : !item.completed))
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));

    setItems(visible);
    setIsLoading(false);
  }, [listId, showCompleted]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const addItem = useCallback(
    async (input: {
      title: string;
      priority?: ListItem['priority'];
      /** Provider record, when the title came from a catalog. */
      externalId?: string | null;
      metadata?: Record<string, unknown> | null;
    }) => {
      if (!listId) return;

      const store = await getLocalStoreReady();
      const existing = (await store.listCached('list_item')).filter(
        (row) => readRecord<ListItem>(row).listId === listId,
      );
      const id = Crypto.randomUUID();
      const now = nowIso();

      await store.upsertCached([
        {
          entity: 'list_item',
          entityId: id,
          version: 0,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify({
            id,
            listId,
            title: input.title,
            position: existing.length,
            completed: false,
            favorite: false,
            priority: input.priority ?? 'none',
            externalId: input.externalId ?? null,
            metadata: input.metadata ?? null,
            notes: null,
            version: 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }),
          pending: null,
        },
      ]);

      await enqueueOperation({
        kind: 'create',
        entity: 'list_item',
        entityId: id,
        baseVersion: 0,
        payload: {
          listId,
          title: input.title,
          position: existing.length,
          ...(input.priority ? { priority: input.priority } : {}),
          // The provider id travels with the item so the same title is
          // recognisable later, and so a future import can tell them apart.
          ...(input.externalId ? { externalId: input.externalId } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      });

      await load();
      return id;
    },
    [listId, load],
  );

  const toggleCompleted = useCallback(
    async (item: ListItem) => {
      await localUpdate('list_item', item.id, { completed: !item.completed });
      await load();
    },
    [load],
  );

  const removeItem = useCallback(
    async (item: ListItem) => {
      const store = await getLocalStoreReady();
      const cached = await store.getCached('list_item', item.id);

      if (cached) {
        await store.upsertCached([
          { ...cached, deletedAt: nowIso(), updatedAt: nowIso(), pending: null },
        ]);
      }

      await enqueueOperation({
        kind: 'delete',
        entity: 'list_item',
        entityId: item.id,
        baseVersion: cached?.version ?? item.version,
        payload: null,
      });

      await load();
    },
    [load],
  );

  return { items, isLoading, showCompleted, setShowCompleted, addItem, toggleCompleted, removeItem };
}

/**
 * Global search over the local cache, so it works with no connection. The
 * server search (GET /search) is the online half; this is the offline one, and
 * both return the same shape.
 */
export function useLocalSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const search = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim().toLowerCase();
    if (query.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const store = await getLocalStoreReady();
    const [workspaces, folders, lists, items] = await Promise.all([
      store.listCached('workspace'),
      store.listCached('folder'),
      store.listCached('list'),
      store.listCached('list_item'),
    ]);

    const workspacesById = new Map(
      workspaces.map((row) => [row.entityId, readRecord<{ name: string }>(row)]),
    );

    const found: SearchResult[] = [];

    for (const row of workspaces) {
      const record = readRecord<List & { name: string; id: string }>(row);
      if (record.deletedAt !== null) continue;
      if (!record.name?.toLowerCase().includes(query)) continue;
      found.push({
        scope: 'workspace',
        id: record.id,
        workspaceId: record.id,
        listId: null,
        kind: null,
        title: record.name,
        subtitle: record.description ?? null,
        updatedAt: record.updatedAt,
      });
    }

    for (const row of folders) {
      const record = readRecord<{ name: string; id: string; workspaceId: string; updatedAt: string; deletedAt: string | null }>(row);
      if (record.deletedAt !== null) continue;
      if (!record.name?.toLowerCase().includes(query)) continue;
      found.push({
        scope: 'folder',
        id: record.id,
        workspaceId: record.workspaceId,
        listId: null,
        kind: null,
        title: record.name,
        subtitle: workspacesById.get(record.workspaceId)?.name ?? null,
        updatedAt: record.updatedAt,
      });
    }

    for (const row of lists) {
      const record = readRecord<List>(row);
      if (record.deletedAt !== null) continue;
      if (!record.title.toLowerCase().includes(query)) continue;
      found.push({
        scope: 'list',
        id: record.id,
        workspaceId: record.workspaceId,
        listId: record.id,
        kind: record.kind,
        title: record.title,
        subtitle: record.description,
        updatedAt: record.updatedAt,
      });
    }

    const listsById = new Map(lists.map((row) => [row.entityId, readRecord<List>(row)]));

    for (const row of items) {
      const record = readRecord<ListItem>(row);
      if (record.deletedAt !== null) continue;
      if (!record.title.toLowerCase().includes(query)) continue;

      const list = listsById.get(record.listId);
      found.push({
        scope: 'list_item',
        id: record.id,
        workspaceId: list?.workspaceId ?? null,
        listId: record.listId,
        kind: list?.kind ?? null,
        title: record.title,
        // The parent list is the context a hit needs to be understandable.
        subtitle: list?.title ?? null,
        updatedAt: record.updatedAt,
      });
    }

    found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setResults(found.slice(0, 50));
    setIsSearching(false);
  }, []);

  useEffect(() => subscribeToLocalStore(() => undefined), []);

  const grouped = useMemo(() => {
    return {
      workspaces: results.filter((item) => item.scope === 'workspace'),
      lists: results.filter((item) => item.scope === 'list'),
      items: results.filter((item) => item.scope === 'list_item'),
      folders: results.filter((item) => item.scope === 'folder'),
    };
  }, [results]);

  return { results, grouped, isSearching, search };
}

/** Pull everything the user can see and refresh the cache. */
export function useContentSync() {
  return useCallback(async (options: { full?: boolean } = {}) => {
    const workspaces = await readCachedWorkspaces();
    await pullIntoCache(options);
    return workspaces;
  }, []);
}
