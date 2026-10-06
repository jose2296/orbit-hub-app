import type { Collection, Folder, List, Workspace } from "@orbit-hub/contracts";
import { useEffect, useMemo, useState } from "react";

import { withListDefaults } from "@/lib/lists/item-record";

export interface SpacesTree {
  spaces: () => Workspace[];
  foldersOf: (workspaceId: string, parentId: string | null) => Folder[];
  listsOf: (workspaceId: string, parentId: string | null) => List[];
  collectionsOf: (workspaceId: string, folderId: string | null) => Collection[];
  isEmpty: (workspaceId: string) => boolean;
  isFolderEmpty: (folderId: string) => boolean;
  /**
   * The folder this one hangs in, or `null` at the top of a space.
   *
   * Only here to be able to go **back up**. `foldersOf` walks down and nothing walked
   * up, so a picker that let you step into a subfolder had no way out of it: you could
   * see where you were and not change your mind, which is a dead end in a panel whose
   * only question is *where*.
   */
  parentOf: (folderId: string) => Folder | null;
}

/**
 * Every folder and every list, grouped by where they hang.
 *
 * One read of the cache and then lookups by parent, so opening a folder three
 * levels down costs a lookup and not another read. A folder's own lists are the
 * ones whose `folderId` is that folder, and a space's are the ones with no
 * folder at all.
 *
 * Its own file and not part of the drawer, because two things need it and one of
 * them is not the drawer: the panel that asks where a received list goes has to
 * offer the same spaces the menu shows, and when it reached up into `drawer.tsx`
 * for it the two imported each other. That is a require cycle, it only shows up
 * as a warning at boot, and it is the kind of thing that works until the day the
 * module is loaded the other way round.
 */
export function useSpacesTree(): SpacesTree {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [spaces, setSpaces] = useState<Workspace[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const [{ readAllCachedFolders, readCachedWorkspaces }, localStore] =
        await Promise.all([
          import("@/lib/offline/sync-service"),
          import("@/lib/offline/local-store"),
        ]);

      const store = await localStore.getLocalStoreReady();
      const [folderRows, listRows, collectionRows, workspaceRows] = await Promise.all([
        readAllCachedFolders(),
        store.listCached("list"),
        store.listCached("collection"),
        readCachedWorkspaces(),
      ]);

      const listRecords = listRows
        .map((row) => {
          try {
            // Read the same way `useLists` reads, and for the same reason: this is
            // a cast and not a parse, so a list cached before `tagColors` existed
            // arrives with no key at all. `withListDefaults` is the one place that
            // answers that, and this hook is where the drawer and the three
            // pickers get their lists. The `catch` is still only about the JSON —
            // `withListDefaults` answers an empty map for anything, so it cannot be
            // what throws.
            return withListDefaults(JSON.parse(row.payload));
          } catch {
            return null;
          }
        })
        .filter((list): list is List => list !== null && list.deletedAt === null);

      // Leidas como las listas y por el mismo motivo: el payload manda y la
      // fila borrada no se ofrece. El orden lo pone `selectCollections` al
      // preguntar, igual que `foldersOf` y `listsOf` ordenan al preguntar.
      const collectionRecords = collectionRows
        .map((row) => {
          try {
            return JSON.parse(row.payload) as Collection;
          } catch {
            return null;
          }
        })
        .filter(
          (collection): collection is Collection =>
            collection !== null && collection.deletedAt === null,
        );

      if (!active) return;
      setFolders(folderRows);
      setLists(listRecords);
      setCollections(collectionRecords);
      setSpaces(workspaceRows);
    };

    void load();

    let unsubscribe: (() => void) | undefined;
    void import("@/lib/offline/local-store").then((m) => {
      // Suscrito *despues* de la primera lectura, con un import dinamico de por
      // medio, se pierde lo que se escriba entre medias. Y la sincronizacion
      // escribe fila a fila: la primera lectura caia a mitad, la carpeta de
      // primer nivel llegaba y la de segundo no, y como no hubo aviso después no
      // se releía nunca. Un menú que muestra un árbol a medias es un menú que
      // miente sobre lo que tienes.
      if (!active) return;
      unsubscribe = m.subscribeToLocalStore(() => void load());
      // Y al suscribirse otra vez: lo que se escribió antes de suscribirse
      // tampoco lo hemos visto.
      void load();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return useMemo<SpacesTree>(() => {
    const key = (workspaceId: string, parentId: string | null) =>
      `${workspaceId}:${parentId ?? "root"}`;

    const foldersByParent = new Map<string, Folder[]>();
    const listsByParent = new Map<string, List[]>();
    const foldersById = new Map<string, Folder>();
    // Cuantas cosas cuelgan *directamente* de cada carpeta. Una cuenta y no un
    // recorrido: preguntar si una carpeta esta vacia es preguntarlo una vez por
    // cada fila del menu, y recorrer el arbol entero en cada pregunta es un menu
    // que tarda en abrirse.
    const childCount = new Map<string, number>();
    const bump = (id: string) =>
      childCount.set(id, (childCount.get(id) ?? 0) + 1);

    for (const folder of folders) {
      const parentKey = key(folder.workspaceId, folder.parentId);
      if (!foldersByParent.has(parentKey)) foldersByParent.set(parentKey, []);
      foldersByParent.get(parentKey)!.push(folder);
      foldersById.set(folder.id, folder);
      if (folder.parentId) bump(folder.parentId);
    }

    for (const list of lists) {
      const parentKey = key(list.workspaceId, list.folderId);
      if (!listsByParent.has(parentKey)) listsByParent.set(parentKey, []);
      listsByParent.get(parentKey)!.push(list);
      if (list.folderId) bump(list.folderId);
    }

    const byName = (rows: Folder[]) =>
      [...rows].sort((one, two) => one.name.localeCompare(two.name));
    const byTitle = (rows: List[]) =>
      [...rows].sort((one, two) => one.title.localeCompare(two.title));

    const foldersOf = (workspaceId: string, parentId: string | null) =>
      byName(foldersByParent.get(key(workspaceId, parentId)) ?? []);
    const listsOf = (workspaceId: string, parentId: string | null) =>
      byTitle(listsByParent.get(key(workspaceId, parentId)) ?? []);
    const collectionsOf = (workspaceId: string, folderId: string | null) =>
      selectCollections(collections, workspaceId, folderId);

    return {
      spaces: () => spaces,
      foldersOf,
      listsOf,
      collectionsOf,
      isEmpty: (workspaceId) =>
        (foldersByParent.get(key(workspaceId, null))?.length ?? 0) === 0 &&
        (listsByParent.get(key(workspaceId, null))?.length ?? 0) === 0,
      isFolderEmpty: (folderId) => (childCount.get(folderId) ?? 0) === 0,
      parentOf: (folderId) => {
        const parentId = foldersById.get(folderId)?.parentId;
        if (!parentId) return null;
        return foldersById.get(parentId) ?? null;
      },
    };
  }, [folders, lists, collections, spaces]);
}

/**
 * Las colecciones de un sitio, sin las borradas y en su orden.
 *
 * Funcion pura y no un metodo del hook, porque un hook no se prueba sin
 * React y esta regla si se puede comprobar sin el: filtra por espacio y
 * carpeta (`null` es la raiz del espacio), saca las que tienen `deletedAt`
 * y ordena por `position` con el nombre de desempate, que es lo mismo que
 * `readAllCachedFolders` hace para las carpetas. El hook la usa para su
 * `collectionsOf` y el test la prueba directamente.
 */
export function selectCollections(
  collections: Collection[],
  workspaceId: string,
  folderId: string | null,
): Collection[] {
  return collections
    .filter(
      (collection) =>
        collection.workspaceId === workspaceId &&
        collection.folderId === folderId &&
        collection.deletedAt === null,
    )
    .sort(
      (one, two) =>
        (one.position ?? 0) - (two.position ?? 0) ||
        one.name.localeCompare(two.name),
    );
}
