import * as Crypto from "expo-crypto";

import type { Bookmark } from "@orbit-hub/contracts";

import { enqueueOperation, getLocalStoreReady, localUpdate } from "@/lib/offline";

/**
 * Guardar un enlace.
 *
 * Funciones sueltas y no hooks, igual que las notas: escriben local primero y
 * encolan despues. Ninguna espera a la red y ninguna puede fallar por ella.
 */

export interface NewBookmarkInput {
  workspaceId: string;
  folderId?: string | null;
  collectionId?: string | null;
  url: string;
  /** Vacio o ausente: lo rellena el servidor con el titulo del enlace. */
  title?: string;
  tags?: string[];
}

export interface NewBookmarkRecordInput extends NewBookmarkInput {
  id: string;
}

/**
 * Lo que el cliente guarda de un bookmark, y nada mas.
 *
 * Sin `document`, `plainText`, `extractionState`, `extractionError`, `siteName`,
 * `description` ni `imageUrl`: eso lo escribe el servidor en la fase de
 * extraccion, y si el cliente lo mandara el sanitizador lo tiraria en silencio
 * para devolverlo vacio en el pull igual. Mandarlo seria pedir que alguien
 * entienda por que su texto desaparece, y no hay razon para pedirlo.
 */
export type LocalBookmark = Omit<
  Bookmark,
  | "document"
  | "plainText"
  | "extractionState"
  | "extractionError"
  | "siteName"
  | "description"
  | "imageUrl"
>;

/** Un bookmark nuevo: sin extraer todavia, version 0, aun no esta en el servidor. */
export function newBookmark(input: NewBookmarkRecordInput): LocalBookmark {
  const now = new Date().toISOString();
  return {
    id: input.id,
    version: 0,
    createdAt: now,
    updatedAt: now,
    workspaceId: input.workspaceId,
    folderId: input.folderId ?? null,
    collectionId: input.collectionId ?? null,
    url: input.url,
    title: input.title ?? "",
    // Un array nuevo y no una constante compartida: las etiquetas de un enlace
    // no pueden aparecer en todos los demas en cuanto alguien escribe una.
    tags: input.tags ? [...input.tags] : [],
    // Cero y no "sin valor": un enlace sin colocar va al final, con lo demas
    // que tampoco tiene sitio, y no a la cabeza de la carpeta.
    position: 0,
    /*
      Tuyo y editable, por la misma razon que una nota recien escrita: solo se
      llega aqui desde un espacio donde se puede escribir, y el servidor tiene
      la ultima palabra en el proximo pull.
    */
    role: "editor",
    shared: false,
    deletedAt: null,
  };
}

/** Guarda un enlace en local y lo encola. Devuelve el id que va a tener. */
export async function createBookmarkAction(input: NewBookmarkInput): Promise<string> {
  const id = Crypto.randomUUID();
  const bookmark = newBookmark({ id, ...input });

  // Se escribe local y se encola. La UI nunca espera a la red, y el texto del
  // articulo llega despues por el pull: un bookmark se guarda aunque no haya
  // conexion, y esa es la razon de que la extraccion no vaya dentro de este push.
  await localUpdate("bookmark", id, { ...bookmark });
  await enqueueOperation({
    kind: "create",
    entity: "bookmark",
    entityId: id,
    baseVersion: 0,
    payload: {
      workspaceId: bookmark.workspaceId,
      folderId: bookmark.folderId,
      collectionId: bookmark.collectionId,
      url: bookmark.url,
      title: bookmark.title,
      tags: bookmark.tags,
    },
  });
  return id;
}

export interface BookmarkChanges {
  url?: string;
  title?: string;
  /**
   * El espacio, y **por que no estaba**.
   *
   * "Igual que una nota" era la razon que daba `assign-sheet.tsx` para no
   * ofrecerlo: una nota no se mueve de espacio, asi que un bookmark tampoco. Pero
   * un bookmark sin clasificar si necesita moverse —el pedido era literal, "deberia
   * poder moverlo luego a otro sitio si esta sin clasificar"— y el motivo real era
   * que el contrato de cambios no tenia el campo, no que no se pudiera.
   *
   * Y **moverlo no es quitarselo**: `bookmarkSchema.workspaceId` sigue siendo
   * obligatorio. Un bookmark siempre esta en un espacio; esto es cual.
   */
  workspaceId?: string;
  folderId?: string | null;
  collectionId?: string | null;
  tags?: string[];
}

/**
 * Guarda un bookmark.
 *
 * Sin `workspaceId`: un bookmark no se muda de espacio, igual que una nota no
 * se mueve entre espacios por un payload de sync. Solo llegan los campos
 * definidos, por la misma razon que en las colecciones.
 */
export async function updateBookmarkAction(
  input: { id: string; baseVersion: number } & BookmarkChanges,
): Promise<void> {
  const cambios: Record<string, unknown> = {};
  if (input.url !== undefined) cambios["url"] = input.url;
  if (input.title !== undefined) cambios["title"] = input.title;
  if (input.workspaceId !== undefined) cambios["workspaceId"] = input.workspaceId;
  if (input.folderId !== undefined) cambios["folderId"] = input.folderId;
  if (input.collectionId !== undefined) cambios["collectionId"] = input.collectionId;
  if (input.tags !== undefined) cambios["tags"] = input.tags;

  // La version la lee `localUpdate` de la cache: la del input es la que habia
  // en pantalla cuando se abrio el editor, y ya puede ir por detras.
  await localUpdate("bookmark", input.id, cambios);
}

/**
 * Un tombstone, en local tambien.
 *
 * La fila se marca y no se quita, para que el enlace salga de la lista y un
 * aparato que lo tenia se entere de que ya no esta cuando vuelva. Quitar la
 * fila haria un borrado sin sincronizar indistinguible de un enlace que nunca
 * existio.
 */
export async function deleteBookmarkAction(bookmarkId: string): Promise<void> {
  const store = await getLocalStoreReady();
  const cached = await store.getCached("bookmark", bookmarkId);
  const baseVersion = cached?.version ?? 0;
  const now = new Date().toISOString();

  await store.upsertCached([
    {
      entity: "bookmark",
      entityId: bookmarkId,
      version: baseVersion,
      updatedAt: now,
      deletedAt: now,
      payload: cached?.payload ?? JSON.stringify({ id: bookmarkId }),
      pending: null,
    },
  ]);
  await enqueueOperation({
    kind: "delete",
    entity: "bookmark",
    entityId: bookmarkId,
    baseVersion,
  });
}
