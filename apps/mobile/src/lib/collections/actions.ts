import * as Crypto from "expo-crypto";

import type { Collection } from "@orbit-hub/contracts";

import { enqueueOperation, localUpdate } from "@/lib/offline";

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
 * Solo llegan los campos definidos: un `undefined` mezclado en el registro
 * pisaria el valor guardado, y una coleccion sin nombre es una fila que el
 * navegador no sabe dibujar.
 */
export async function updateCollectionAction(
  input: { id: string; baseVersion: number } & Partial<NewCollectionInput>,
): Promise<void> {
  const cambios: Record<string, unknown> = {};
  if (input.workspaceId !== undefined) cambios["workspaceId"] = input.workspaceId;
  if (input.folderId !== undefined) cambios["folderId"] = input.folderId;
  if (input.name !== undefined) cambios["name"] = input.name;
  if (input.description !== undefined) cambios["description"] = input.description;
  if (input.emoji !== undefined) cambios["emoji"] = input.emoji;

  // La version la lee `localUpdate` de la cache, que es la unica que sabe en
  // que numero esta la fila: la que trae el input es la que habia en pantalla
  // cuando se abrio el editor, y ya puede ir por detras.
  await localUpdate("collection", input.id, cambios);
}
