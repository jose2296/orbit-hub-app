import * as Crypto from "expo-crypto";

import type { Collection } from "@orbit-hub/contracts";

import { updateBookmarkAction } from "@/lib/bookmarks/actions";
import { enqueueOperation, getLocalStoreReady, localUpdate } from "@/lib/offline";

/**
 * Escribir una coleccion.
 *
 * Funciones sueltas y no hooks, igual que las notas: escriben local primero y
 * encolan despues. Ninguna espera a la red y ninguna puede fallar por ella.
 */

export interface NewCollectionInput {
  workspaceId: string;
  folderId?: string | null;
  name: string;
  description?: string | null;
  emoji?: string | null;
}

export interface NewCollectionRecordInput extends NewCollectionInput {
  id: string;
}

/** Una coleccion nueva: sin lugar todavia, version 0, aun no esta en el servidor. */
export function newCollection(input: NewCollectionRecordInput): Collection {
  const now = new Date().toISOString();
  return {
    id: input.id,
    version: 0,
    createdAt: now,
    updatedAt: now,
    workspaceId: input.workspaceId,
    folderId: input.folderId ?? null,
    name: input.name,
    description: input.description ?? null,
    emoji: input.emoji ?? null,
    // Cero y no "sin valor": una coleccion sin colocar va al final, con las
    // notas y las listas que tampoco tienen sitio, y no a la cabeza.
    position: 0,
    bookmarkCount: 0,
    /*
      Tuyo y editable, por la misma razon que una nota recien escrita: solo se
      llega aqui desde un espacio donde se puede escribir, y el servidor tiene
      la ultima palabra en el proximo pull. Mostrar otra cosa dejaria cada
      coleccion nueva como de solo lectura hasta que volviera la red.
    */
    role: "editor",
    shared: false,
    deletedAt: null,
  };
}

/** Crea una coleccion en local y la encola. Devuelve el id que va a tener. */
export async function createCollectionAction(input: NewCollectionInput): Promise<string> {
  const id = Crypto.randomUUID();
  const collection = newCollection({ id, ...input });

  await localUpdate("collection", id, { ...collection });
  await enqueueOperation({
    kind: "create",
    entity: "collection",
    entityId: id,
    baseVersion: 0,
    // El espacio viaja en el payload porque una coleccion no se puede colocar
    // sin uno. No esta en `base`: ese campo es del servidor, y un cliente que
    // pudiera mover una coleccion entre espacios la archivaria donde el dueno
    // nunca la puso.
    payload: {
      workspaceId: collection.workspaceId,
      folderId: collection.folderId,
      name: collection.name,
      description: collection.description,
      emoji: collection.emoji,
    },
  });
  return id;
}

/**
 * Guarda una coleccion.
 *
 * Sin `workspaceId`: una coleccion no se muda de espacio, igual que una nota
 * no se mueve entre espacios por un payload de sync. Solo llegan los campos
 * definidos: un `undefined` mezclado en el registro pisaria el valor guardado,
 * y una coleccion sin nombre es una fila que el navegador no sabe dibujar.
 */
export async function updateCollectionAction(
  input: { id: string; baseVersion: number } & Partial<Omit<NewCollectionInput, "workspaceId">>,
): Promise<void> {
  const cambios: Record<string, unknown> = {};
  if (input.folderId !== undefined) cambios["folderId"] = input.folderId;
  if (input.name !== undefined) cambios["name"] = input.name;
  if (input.description !== undefined) cambios["description"] = input.description;
  if (input.emoji !== undefined) cambios["emoji"] = input.emoji;

  // La version la lee `localUpdate` de la cache, que es la unica que sabe en
  // que numero esta la fila: la que trae el input es la que habia en pantalla
  // cuando se abrio el editor, y ya puede ir por detras.
  await localUpdate("collection", input.id, cambios);
}

/** Una fila de la cache, con lo unico que hace falta para decidir si es de la coleccion. */
interface FilaDeBookmark {
  entityId: string;
  version: number;
  deletedAt: string | null;
  payload: string;
}

/**
 * Los bookmarks vivos de una coleccion, y la version de cada uno.
 *
 * Pura y exportada para probarla: es la decision que importa al borrar. Un
 * payload que no se lee se salta, porque una fila rota no puede impedir borrar la
 * coleccion; y los ya borrados no se tocan.
 */
export function bookmarksDeLaColeccion(
  filas: FilaDeBookmark[],
  collectionId: string,
): { id: string; version: number }[] {
  const salida: { id: string; version: number }[] = [];
  for (const fila of filas) {
    if (fila.deletedAt !== null) continue;
    try {
      const registro = JSON.parse(fila.payload) as { collectionId?: unknown };
      if (registro.collectionId === collectionId) {
        salida.push({ id: fila.entityId, version: fila.version });
      }
    } catch {
      continue;
    }
  }
  return salida;
}

/**
 * Borra una coleccion **sin llevarse sus bookmarks**.
 *
 * Los enlaces pasan a "sin clasificar" antes de que la coleccion desaparezca: el
 * borrado del servidor es un tombstone y no toca los bookmarks, asi que sin este
 * paso se quedarian apuntando a una coleccion que ya no existe, fuera de su sitio
 * y tambien fuera de la bandeja de sin clasificar. Despues, el tombstone local y
 * la operacion, igual que una nota.
 */
export async function deleteCollectionAction(collectionId: string): Promise<void> {
  const store = await getLocalStoreReady();

  const filas = await store.listCached("bookmark");
  for (const { id, version } of bookmarksDeLaColeccion(filas, collectionId)) {
    await updateBookmarkAction({ id, baseVersion: version, collectionId: null });
  }

  const cached = await store.getCached("collection", collectionId);
  const baseVersion = cached?.version ?? 0;
  const now = new Date().toISOString();
  await store.upsertCached([
    {
      entity: "collection",
      entityId: collectionId,
      version: baseVersion,
      updatedAt: now,
      deletedAt: now,
      payload: cached?.payload ?? JSON.stringify({ id: collectionId }),
      pending: null,
    },
  ]);
  await enqueueOperation({
    kind: "delete",
    entity: "collection",
    entityId: collectionId,
    baseVersion,
  });
}
