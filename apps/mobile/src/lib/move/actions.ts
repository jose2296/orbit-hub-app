import type { SyncEntity } from "@orbit-hub/contracts";

import { getLocalStoreReady, localUpdate } from "@/lib/offline";

import { arrastradosPorMudanza, valoresDeMudanza } from "./plan";
import type { DestinoDeMudanza, FilaDeCache, MovibleKind } from "./plan";

const ENTIDADES_CON_ESPACIO: SyncEntity[] = ["folder", "list", "note", "collection", "bookmark"];

/**
 * Mueve una carpeta, lista, nota, coleccion o bookmark a otro sitio, dentro de su
 * espacio o a otro.
 *
 * Una sola operacion `update` por la fila que la persona movio. Lo que cuelga de ella
 * (el subarbol de una carpeta, los bookmarks de una coleccion) lo mueve el servidor en
 * la misma transaccion; aqui solo se refleja en la cache para que la pantalla no
 * espere al proximo pull, **sin encolar nada** por esas filas.
 */
export async function moveEntityAction(
  kind: MovibleKind,
  id: string,
  destino: DestinoDeMudanza,
): Promise<void> {
  await localUpdate(kind, id, valoresDeMudanza(kind, destino));

  if (kind !== "folder" && kind !== "collection") return;

  const store = await getLocalStoreReady();
  const filas = new Map<string, Awaited<ReturnType<typeof store.listCached>>[number]>();
  const vista: FilaDeCache[] = [];
  for (const entity of ENTIDADES_CON_ESPACIO) {
    for (const fila of await store.listCached(entity)) {
      try {
        const payload = JSON.parse(fila.payload) as Record<string, unknown>;
        filas.set(`${fila.entity}:${fila.entityId}`, fila);
        vista.push({ entity: fila.entity, entityId: fila.entityId, payload });
      } catch {
        continue;
      }
    }
  }

  const reflejadas = arrastradosPorMudanza(kind, id, vista).flatMap((arrastrada) => {
    const original = filas.get(`${arrastrada.entity}:${arrastrada.entityId}`);
    if (!original) return [];
    return [
      {
        ...original,
        payload: JSON.stringify({ ...arrastrada.payload, workspaceId: destino.workspaceId }),
      },
    ];
  });

  if (reflejadas.length > 0) await store.upsertCached(reflejadas);
}
