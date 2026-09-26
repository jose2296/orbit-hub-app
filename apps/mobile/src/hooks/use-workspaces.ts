import type { Folder, Workspace } from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  enqueueOperation,
  enqueueOperations,
  localUpdate,
  pullIntoCache,
  readCachedFolders,
  readCachedWorkspaces,
  subscribeToLocalStore,
} from "@/lib/offline";
import { getLocalStoreReady } from "@/lib/offline";

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
      const { randomUUID } = await import("expo-crypto");
      const id = randomUUID();
      const store = await getLocalStoreReady();
      const now = new Date().toISOString();

      // Optimistic local record, so the list updates immediately.
      await store.upsertCached([
        {
          entity: "workspace",
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
            role: "owner",
            memberCount: 1,
          }),
          pending: null,
        },
      ]);

      await enqueueOperation({
        kind: "create",
        entity: "workspace",
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
      await localUpdate("workspace", workspace.id, { name });
      await load();
    },
    [load],
  );

  const deleteWorkspace = useCallback(
    async (workspace: Workspace) => {
      const store = await getLocalStoreReady();
      const cached = await store.getCached("workspace", workspace.id);

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
        kind: "delete",
        entity: "workspace",
        entityId: workspace.id,
        baseVersion: cached?.version ?? workspace.version,
        payload: null,
      });

      await load();
    },
    [load],
  );

  return {
    workspaces,
    isLoading,
    isRefreshing,
    refresh,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  };
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
    async (input: {
      name: string;
      parentId?: string | null;
      position?: number;
    }) => {
      if (!workspaceId) return;
      const { randomUUID } = await import("expo-crypto");
      const id = randomUUID();
      const now = new Date().toISOString();

      const store = await getLocalStoreReady();
      await store.upsertCached([
        {
          entity: "folder",
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
        kind: "create",
        entity: "folder",
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

  /**
   * Renames a folder, and anything else about it that is not its position.
   *
   * A folder is a place and not a record of anything, so the only things worth
   * changing about it are its name and the picture next to it.
   */
  const updateFolder = useCallback(
    async (
      folder: { id: string },
      changes: { name?: string; emoji?: string | null },
    ) => {
      await localUpdate("folder", folder.id, changes);
      await load();
    },
    [load],
  );

  /**
   * Takes a folder out of the way.
   *
   * What is inside it is not deleted with it: the lists in a folder are the
   * work, and losing a folder because it was in the wrong place would throw
   * away everything in it. They move up to the space, which is where a folder
   * that is not there would have left them anyway.
   */
  const deleteFolder = useCallback(
    async (folder: {
      id: string;
      parentId: string | null;
      version: number;
    }) => {
      const store = await getLocalStoreReady();
      const now = new Date().toISOString();
      const inside = (await store.listCached("list")).filter(
        (row) =>
          !row.deletedAt &&
          (JSON.parse(row.payload) as { folderId?: string | null }).folderId ===
            folder.id,
      );
      const up = folder.parentId ?? null;

      if (inside.length > 0) {
        await store.upsertCached(
          inside.map((row) => ({
            ...row,
            updatedAt: now,
            payload: JSON.stringify({
              ...JSON.parse(row.payload),
              folderId: up,
              updatedAt: now,
            }),
            pending: JSON.stringify({ folderId: up }),
          })),
        );
        await enqueueOperations(
          inside.map((row) => ({
            kind: "update" as const,
            entity: "list" as const,
            entityId: row.entityId,
            baseVersion: row.version,
            payload: { folderId: up },
            base: JSON.parse(row.payload) as Record<string, unknown>,
            clientTimestamp: now,
          })),
        );
      }

      const cached = await store.getCached("folder", folder.id);
      if (cached) {
        await store.upsertCached([
          {
            ...cached,
            deletedAt: now,
            updatedAt: now,
            pending: JSON.stringify({ deletedAt: now }),
          },
        ]);
      }
      await enqueueOperation({
        kind: "delete",
        entity: "folder",
        entityId: folder.id,
        baseVersion: cached?.version ?? folder.version,
        payload: null,
      });
      await load();
    },
    [load],
  );

  const renameFolder = useCallback(
    async (folder: Folder, name: string) => {
      await localUpdate("folder", folder.id, { name });
      await load();
    },
    [load],
  );

  return {
    folders,
    isLoading,
    createFolder,
    renameFolder,
    updateFolder,
    deleteFolder,
    reload: load,
  };
}

