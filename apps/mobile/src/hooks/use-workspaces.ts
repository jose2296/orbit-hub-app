import type { Folder, IconRef, SyncEntity, Workspace } from "@orbit-hub/contracts";

import { DEFAULT_WORKSPACE_COLOR } from "@/lib/workspace/color";
import { DEFAULT_WASH } from "@/lib/workspace/wash";
import type { WorkspaceWash } from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  enqueueOperation,

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

  /**
   * Changes what a space is called and what colour it is.
   *
   * The colour is the one field of a space a person goes back and forth on, so
   * it is a write like any other: local first, into the outbox, and the space
   * changes colour the moment they tap and syncs when there is a connection.
   */
  const updateWorkspace = useCallback(
    async (
      workspace: Workspace,
      // An explicit list and not `Partial<Workspace>`: a pick that says "here are
      // the fields you may change on a space" is a sentence about what is
      // writable, and `Partial` would quietly make `id` and `createdAt` writable
      // too. It has to be widened when a field becomes writable, on purpose.
      changes: {
        name?: string;
        description?: string | null;
        icon?: IconRef | null;
        color?: string;
        /** The colour the wash ends in, or `null` to go back to deriving it. */
        colorTo?: string | null;
        /** Which of the two ways the colour is painted. */
        wash?: WorkspaceWash;
      },
    ) => {
      await localUpdate("workspace", workspace.id, changes);
      await load();
    },
    [load],
  );

  const createWorkspace = useCallback(
    async (input: {
      name: string;
      icon?: IconRef | null;
      description?: string;
      color?: string;
      colorTo?: string | null;
      wash?: WorkspaceWash;
    }) => {
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
            icon: input.icon ?? null,
            // The colour a space is painted with travels with it from the start:
            // a space created without one would be a card with no colour to read
            // until somebody remembered to pick it.
            color: input.color ?? DEFAULT_WORKSPACE_COLOR,
            // Null and not derived here: the app derives it, so there is one place
            // that decides what "no second colour" looks like.
            colorTo: input.colorTo ?? null,
            // And the way it is painted, for the same reason: a record written
            // here without the field has no `wash` in it at all, and everything
            // downstream has to cope with `undefined` forever after. It is
            // written so the cache is a complete row from the first frame.
            wash: input.wash ?? DEFAULT_WASH,
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
          color: input.color ?? DEFAULT_WORKSPACE_COLOR,
          ...(input.icon ? { icon: input.icon } : {}),
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
    updateWorkspace,
    deleteWorkspace,
  };
}

/**
 * The folders of every space, in one list.
 *
 * The panel is the one screen that is not inside a space, so it cannot ask "the
 * folders of *this* space" the way every other screen does — it needs all of them
 * to show the folders a person has pinned. One hook that takes the list of spaces
 * and reads them all, rather than a hook per space: hooks cannot be called in a
 * loop, and a panel that only ever offered the folders of whichever space
 * happened to be first would be a panel where a folder you cannot see is a folder
 * you cannot pin.
 */
export function useAllFolders(workspaceIds: string[]): Folder[] {
  const [folders, setFolders] = useState<Folder[]>([]);
  // The ids as one string, so the effect below does not re-run every render on an
  // array the caller built fresh, and so two calls with the same spaces in a
  // different order are the same effect.
  const key = workspaceIds.join(",");

  const load = useCallback(async () => {
    const ids = key.length === 0 ? [] : key.split(",");
    const found: Folder[] = [];
    for (const id of ids) {
      found.push(...(await readCachedFolders(id)));
    }
    setFolders(found);
  }, [key]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return folders;
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
      icon?: IconRef | null;
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
            icon: input.icon ?? null,
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
      changes: { name?: string; icon?: IconRef | null },
    ) => {
      await localUpdate("folder", folder.id, changes);
      await load();
    },
    [load],
  );

  /**
   * Borra una carpeta con todo lo que hay dentro, y lo dice antes la pantalla.
   *
   * Lo que hay dentro se marca borrado en local para que desaparezca ya, y el
   * servidor lo borra en cascada con la carpeta (ver `tombstoneFolderContents`):
   * por eso aqui solo se encola el borrado de la carpeta. Subcarpetas, listas con
   * sus elementos, notas, colecciones y los enlaces de la carpeta y de sus
   * colecciones.
   */
  const deleteFolder = useCallback(
    async (folder: {
      id: string;
      parentId: string | null;
      version: number;
    }) => {
      const store = await getLocalStoreReady();
      const now = new Date().toISOString();
      const payloadOf = <T,>(row: { payload: string }) => JSON.parse(row.payload) as T;

      const folderRows = (await store.listCached("folder")).filter((row) => !row.deletedAt);
      const dentro = new Set<string>([folder.id]);
      for (let added = true; added; ) {
        added = false;
        for (const row of folderRows) {
          const parentId = payloadOf<{ parentId: string | null }>(row).parentId;
          if (parentId && dentro.has(parentId) && !dentro.has(row.entityId)) {
            dentro.add(row.entityId);
            added = true;
          }
        }
      }

      const inside = (entity: SyncEntity, field: string, ids: Set<string>) =>
        store.listCached(entity).then((rows) =>
          rows.filter(
            (row) =>
              !row.deletedAt &&
              ids.has(String(payloadOf<Record<string, unknown>>(row)[field] ?? "")),
          ),
        );

      const listas = await inside("list", "folderId", dentro);
      const colecciones = await inside("collection", "folderId", dentro);
      const notas = await inside("note", "folderId", dentro);
      const enlaces = await inside("bookmark", "folderId", dentro);
      const listaIds = new Set(listas.map((row) => row.entityId));
      const coleccionIds = new Set(colecciones.map((row) => row.entityId));
      const elementos = await inside("list_item", "listId", listaIds);
      const enlacesDeColeccion = await inside("bookmark", "collectionId", coleccionIds);

      const subcarpetas = folderRows.filter((row) => dentro.has(row.entityId) && row.entityId !== folder.id);
      const porBorrar = [
        ...subcarpetas.map((row) => ({ entity: "folder" as const, row })),
        ...listas.map((row) => ({ entity: "list" as const, row })),
        ...elementos.map((row) => ({ entity: "list_item" as const, row })),
        ...notas.map((row) => ({ entity: "note" as const, row })),
        ...colecciones.map((row) => ({ entity: "collection" as const, row })),
        ...[...enlaces, ...enlacesDeColeccion].map((row) => ({ entity: "bookmark" as const, row })),
      ];
      const vistos = new Set<string>();
      const unicos = porBorrar.filter(({ entity, row }) => {
        const clave = `${entity}:${row.entityId}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
      });

      if (unicos.length > 0) {
        await store.upsertCached(
          unicos.map(({ row }) => ({
            ...row,
            updatedAt: now,
            deletedAt: now,
            pending: JSON.stringify({ deletedAt: now }),
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
