import type { Bookmark } from "@orbit-hub/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getLocalStoreReady, subscribeToLocalStore } from "@/lib/offline";
import type { CachedEntity } from "@/lib/offline";

/**
 * Leer bookmarks de la cache.
 *
 * La pantalla lee de aqui y nunca de la API, que es lo que hace que la app
 * funcione sin conexion. El molde es `use-notes.ts`: la fila trae el
 * envoltorio (id, version, updatedAt, deletedAt) como canonico, el payload
 * como servidor y `pending` como lo ultimo escrito, que gana.
 */

export function withBookmarkDefaults(value: unknown): Bookmark {
  const record = (value ?? {}) as Record<string, unknown>;
  const role = record.role;
  const state = record.extractionState;

  return {
    id: typeof record.id === "string" ? record.id : "",
    version: typeof record.version === "number" ? record.version : 0,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : "",
    folderId: typeof record.folderId === "string" ? record.folderId : null,
    collectionId: typeof record.collectionId === "string" ? record.collectionId : null,
    url: typeof record.url === "string" ? record.url : "",
    title: typeof record.title === "string" ? record.title : "",
    siteName: typeof record.siteName === "string" ? record.siteName : null,
    description: typeof record.description === "string" ? record.description : null,
    imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : null,
    // El listado REST recorta `document` y `plainText` (son hasta 512 KB y el
    // listado no los usa), y un bookmark recien creado aun no tiene ni
    // extraccion. Asi que una fila sin texto no es un dato roto: se lee
    // vacia y el lector pide el texto completo aparte.
    document: typeof record.document === "string" ? record.document : "",
    plainText: typeof record.plainText === "string" ? record.plainText : "",
    extractionState:
      state === "pending" ||
      state === "ready" ||
      state === "metadata_only" ||
      state === "failed"
        ? state
        : "pending",
    extractionError:
      typeof record.extractionError === "string" ? record.extractionError : null,
    // Un array y no lo que haya: un payload con un texto donde el contrato
    // dice lista es un bookmark que no se puede filtrar por etiqueta.
    tags: Array.isArray(record.tags) ? (record.tags as string[]) : [],
    position: typeof record.position === "number" ? Math.max(0, record.position) : 0,
    role: role === "owner" || role === "editor" || role === "viewer" ? role : "editor",
    shared: record.shared === true,
    deletedAt: typeof record.deletedAt === "string" ? record.deletedAt : null,
  };
}

export function readBookmarkFromRow(row: CachedEntity): Bookmark {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending
    ? (JSON.parse(row.pending) as Record<string, unknown>)
    : null;

  // Lo pendiente gana, para que un bookmark muestre lo que se acaba de
  // escribir y no lo ultimo que llego a la red.
  return withBookmarkDefaults({
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  });
}

export interface BookmarkFilters {
  workspaceId?: string;
  folderId?: string | null;
  /**
   * `"unclassified"` pide los que no estan en ninguna coleccion, que es
   * distinto de `undefined` ("sin opinion sobre la coleccion"). Igual que
   * `folderId` en notas: `null` es la raiz y `undefined` es no filtrar.
   */
  collectionId?: string | null | "unclassified";
}

/**
 * Que bookmarks pide una pantalla.
 *
 * Exportada y pura porque "sin opinion sobre la coleccion" y "sin coleccion"
 * son dos preguntas distintas y solo una de ellas es `undefined`. Confundirlas
 * esconde todos los sin-clasificar de un espacio, y nada lo canta, porque una
 * pantalla sin bookmarks se ve igual que una pantalla sin nada que mostrar.
 */
export function applyBookmarkFilters(
  bookmarks: Bookmark[],
  filters: BookmarkFilters,
): Bookmark[] {
  return bookmarks.filter((bookmark) => {
    if (filters.workspaceId !== undefined && bookmark.workspaceId !== filters.workspaceId) {
      return false;
    }
    if (filters.folderId !== undefined && bookmark.folderId !== filters.folderId) {
      return false;
    }
    if (filters.collectionId !== undefined) {
      if (filters.collectionId === "unclassified") {
        // `unclassified` filtra por IS NULL en cliente: ni coleccion ni pista
        // de ella. `==` y no `===` a proposito, por si un payload viejo trae
        // el campo ausente en vez de nulo.
        // eslint-disable-next-line eqeqeq
        if (bookmark.collectionId != null) return false;
      } else if (bookmark.collectionId !== filters.collectionId) {
        return false;
      }
    }
    return true;
  });
}

/** Bookmarks de una lista: lo ultimo guardado arriba, que es "leer despues". */
export function sortBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return [...bookmarks].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
  );
}

export function useBookmarks(filters: BookmarkFilters = {}) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Los filtros como clave y no como dependencia: este objeto se reconstruye en
  // cada render, y depender de el releeria la cache cada vez que una pantalla
  // que lo posee escribe en un campo de busqueda.
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    const store = await getLocalStoreReady();
    const rows = await store.listCached("bookmark");
    const read = rows.map(readBookmarkFromRow).filter((bookmark) => bookmark.deletedAt === null);
    setBookmarks(sortBookmarks(applyBookmarkFilters(read, JSON.parse(filterKey) as BookmarkFilters)));
    setIsLoading(false);
  }, [filterKey]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return useMemo(
    () => ({
      bookmarks,
      isLoading,
      reload: load,
    }),
    [bookmarks, isLoading, load],
  );
}

/** Un bookmark, o null. Misma regla: de la cache, nunca de la red. */
export function useBookmark(bookmarkId: string | null) {
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!bookmarkId) {
      setBookmark(null);
      setIsLoading(false);
      return;
    }
    const store = await getLocalStoreReady();
    const row = await store.getCached("bookmark", bookmarkId);
    // Una fila con tombstone se lee como que no hay bookmark: es lo que quiso
    // quien lo borro y lo que necesita un aparato que se perdio el borrado.
    setBookmark(!row || row.deletedAt ? null : readBookmarkFromRow(row));
    setIsLoading(false);
  }, [bookmarkId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return { bookmark, isLoading, reload: load };
}

/**
 * Los sin-clasificar de un espacio: vivos y sin coleccion.
 *
 * Funcion pura y no un metodo del hook, porque un hook no se prueba sin
 * React y esta regla si se puede comprobar sin el. El hook la usa para el
 * badge del drawer y el test la prueba directamente.
 */
export function selectUnclassifiedBookmarks(
  bookmarks: Bookmark[],
  workspaceId?: string,
): Bookmark[] {
  return bookmarks.filter((bookmark) => {
    if (workspaceId !== undefined && bookmark.workspaceId !== workspaceId) {
      return false;
    }
    // eslint-disable-next-line eqeqeq
    if (bookmark.collectionId != null) return false;
    if (bookmark.deletedAt !== null) return false;
    return true;
  });
}

/**
 * Cuantos sin-clasificar tiene un espacio, para el badge del drawer.
 *
 * Una lectura cacheada, sin red, con live-update. Sin endpoint de conteo en
 * servidor a proposito: un round-trip por render del drawer se queda rancio
 * offline, que es justo cuando el badge mas importa.
 */
export function useUnclassifiedCount(workspaceId?: string): number {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const store = await getLocalStoreReady();
    const rows = await store.listCached("bookmark");
    setCount(selectUnclassifiedBookmarks(rows.map(readBookmarkFromRow), workspaceId).length);
  }, [workspaceId]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return count;
}
