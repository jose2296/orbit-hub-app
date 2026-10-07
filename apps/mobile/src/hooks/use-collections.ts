import type { Bookmark, Collection } from "@orbit-hub/contracts";
import { useEffect, useMemo, useState } from "react";

import { readBookmarkFromRow } from "@/hooks/use-bookmarks";
import { getLocalStoreReady, subscribeToLocalStore } from "@/lib/offline";
import type { CachedEntity } from "@/lib/offline";

/**
 * Leer colecciones de la cache.
 *
 * Mismo molde que los bookmarks: la fila trae el envoltorio (id, version,
 * updatedAt, deletedAt) como canonico, el payload como el servidor y `pending`
 * como lo ultimo escrito, que gana. Asi una coleccion recien creada o renombrada
 * se ve al momento, sin esperar a la red.
 */

/** Una coleccion leida de su fila, o `null` si esta borrada o no se puede leer. */
export function readCollectionFromRow(row: CachedEntity): Collection | null {
  if (row.deletedAt) return null;
  try {
    const server = JSON.parse(row.payload) as Record<string, unknown>;
    const pending = row.pending ? (JSON.parse(row.pending) as Record<string, unknown>) : null;
    const record = {
      ...server,
      id: row.entityId,
      version: row.version,
      updatedAt: row.updatedAt,
      ...pending,
    } as Record<string, unknown>;
    const role = record["role"];
    return {
      id: row.entityId,
      version: row.version,
      createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : "",
      updatedAt: row.updatedAt,
      workspaceId: typeof record["workspaceId"] === "string" ? record["workspaceId"] : "",
      folderId: typeof record["folderId"] === "string" ? record["folderId"] : null,
      name: typeof record["name"] === "string" ? record["name"] : "",
      description: typeof record["description"] === "string" ? record["description"] : null,
      emoji: typeof record["emoji"] === "string" ? record["emoji"] : null,
      position: typeof record["position"] === "number" ? Math.max(0, record["position"]) : 0,
      bookmarkCount: 0,
      role: role === "owner" || role === "editor" || role === "viewer" ? role : "editor",
      shared: record["shared"] === true,
      deletedAt: null,
    };
  } catch {
    return null;
  }
}

/** Cuantos enlaces vivos hay en cada coleccion. Los sin clasificar no cuentan. */
export function countBookmarksByCollection(
  bookmarks: Pick<Bookmark, "collectionId">[],
): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const bookmark of bookmarks) {
    if (bookmark.collectionId == null) continue; // eslint-disable-line eqeqeq
    cuenta[bookmark.collectionId] = (cuenta[bookmark.collectionId] ?? 0) + 1;
  }
  return cuenta;
}

/**
 * Las colecciones de un espacio (de **todas** sus carpetas, que es lo que un
 * filtro de alcance de espacio necesita) y cuantos enlaces tiene cada una.
 */
export function useCollections(workspaceId: string | undefined) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [bookmarkCounts, setBookmarkCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    const cargar = async () => {
      const store = await getLocalStoreReady();
      const [filasColecciones, filasBookmarks] = await Promise.all([
        store.listCached("collection"),
        store.listCached("bookmark"),
      ]);
      if (!activo) return;
      const delEspacio = filasColecciones
        .map(readCollectionFromRow)
        .filter(
          (coleccion): coleccion is Collection =>
            coleccion !== null && (workspaceId === undefined || coleccion.workspaceId === workspaceId),
        );
      const vivos = filasBookmarks.filter((fila) => fila.deletedAt === null).map(readBookmarkFromRow);
      setCollections(delEspacio);
      setBookmarkCounts(countBookmarksByCollection(vivos));
      setIsLoading(false);
    };
    void cargar();
    const baja = subscribeToLocalStore(() => {
      void cargar();
    });
    return () => {
      activo = false;
      baja();
    };
  }, [workspaceId]);

  return useMemo(() => ({ collections, bookmarkCounts, isLoading }), [collections, bookmarkCounts, isLoading]);
}
