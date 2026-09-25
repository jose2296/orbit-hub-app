import type { DashboardWidget, Folder, Workspace } from '@orbit-hub/contracts';
import { useCallback, useEffect, useState } from 'react';

import {
  enqueueOperation,
  localUpdate,
  pullIntoCache,
  readCachedDashboard,
  readCachedFolders,
  readCachedWorkspaces,
  subscribeToLocalStore,
} from '@/lib/offline';
import { getLocalStoreReady } from '@/lib/offline';

/**
 * Workspaces come from the local cache, never straight from the API: that is
 * what makes the list readable with no connectivity. `refresh` pulls the
 * changes in the background and updates the cache.
 */
export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    setWorkspaces(await readCachedWorkspaces());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const refresh = useCallback(
    async (options: { full?: boolean } = {}) => {
      setIsRefreshing(true);
      try {
        await pullIntoCache(options);
      } finally {
        await load();
        setIsRefreshing(false);
      }
    },
    [load],
  );

  const createWorkspace = useCallback(
    async (input: { name: string; emoji?: string; description?: string }) => {
      const { randomUUID } = await import('expo-crypto');
      const id = randomUUID();
      const store = await getLocalStoreReady();
      const now = new Date().toISOString();

      // Optimistic local record, so the list updates immediately.
      await store.upsertCached([
        {
          entity: 'workspace',
          entityId: id,
          version: 0,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify({
            id,
            name: input.name,
            description: input.description ?? null,
            emoji: input.emoji ?? null,
            version: 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            role: 'owner',
            memberCount: 1,
          }),
          pending: null,
        },
      ]);

      await enqueueOperation({
        kind: 'create',
        entity: 'workspace',
        entityId: id,
        baseVersion: 0,
        payload: {
          name: input.name,
          ...(input.emoji ? { emoji: input.emoji } : {}),
          ...(input.description ? { description: input.description } : {}),
        },
      });

      await load();
      return id;
    },
    [load],
  );

  const renameWorkspace = useCallback(
    async (workspace: Workspace, name: string) => {
      await localUpdate('workspace', workspace.id, { name });
      await load();
    },
    [load],
  );

  const deleteWorkspace = useCallback(
    async (workspace: Workspace) => {
      const store = await getLocalStoreReady();
      const cached = await store.getCached('workspace', workspace.id);

      if (cached) {
        await store.upsertCached([
          {
            ...cached,
            deletedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pending: JSON.stringify({ deletedAt: new Date().toISOString() }),
          },
        ]);
      }

      await enqueueOperation({
        kind: 'delete',
        entity: 'workspace',
        entityId: workspace.id,
        baseVersion: cached?.version ?? workspace.version,
        payload: null,
      });

      await load();
    },
    [load],
  );

  return { workspaces, isLoading, isRefreshing, refresh, createWorkspace, renameWorkspace, deleteWorkspace };
}

export function useFolders(workspaceId: string | undefined) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setFolders([]);
      setIsLoading(false);
      return;
    }
    setFolders(await readCachedFolders(workspaceId));
    setIsLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const createFolder = useCallback(
    async (input: { name: string; parentId?: string | null; position?: number }) => {
      if (!workspaceId) return;
      const { randomUUID } = await import('expo-crypto');
      const id = randomUUID();
      const now = new Date().toISOString();

      const store = await getLocalStoreReady();
      await store.upsertCached([
        {
          entity: 'folder',
          entityId: id,
          version: 0,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify({
            id,
            workspaceId,
            parentId: input.parentId ?? null,
            name: input.name,
            emoji: null,
            position: input.position ?? 0,
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
        entity: 'folder',
        entityId: id,
        baseVersion: 0,
        payload: {
          name: input.name,
          workspaceId,
          parentId: input.parentId ?? null,
          position: input.position ?? 0,
        },
      });

      await load();
      return id;
    },
    [load, workspaceId],
  );

  const renameFolder = useCallback(
    async (folder: Folder, name: string) => {
      await localUpdate('folder', folder.id, { name });
      await load();
    },
    [load],
  );

  return { folders, isLoading, createFolder, renameFolder, reload: load };
}

export function useDashboard() {
  const [layout, setLayout] = useState<DashboardWidget[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setLayout(await readCachedDashboard());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const saveLayout = useCallback(
    async (next: DashboardWidget[]) => {
      const store = await getLocalStoreReady();
      const rows = await store.listCached('dashboard');
      const existing = rows[0];
      const entityId = existing?.entityId ?? 'dashboard';

      await store.upsertCached([
        {
          entity: 'dashboard',
          entityId,
          version: existing?.version ?? 0,
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          payload: JSON.stringify({ layout: next }),
          pending: JSON.stringify({ layout: next }),
        },
      ]);

      await localUpdate('dashboard', entityId, { layout: next });
      await load();
    },
    [load],
  );

  return { layout, isLoading, saveLayout };
}
