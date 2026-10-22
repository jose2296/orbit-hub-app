/**
 * Mover una cosa a otro sitio, y la parte que no necesita base de datos.
 *
 * Esto es puro a proposito: la accion de verdad (`actions.ts`) toca SQLite y la cola
 * de sincronizacion, y nada de eso se puede importar desde un test. Lo que se decide
 * aqui --que campos cambian y a quien arrastra-- es lo que se rompe en silencio.
 */

export type MovibleKind = "folder" | "list" | "note" | "collection" | "bookmark";

/** A donde va: un espacio y, dentro, una carpeta o la raiz (`null`). */
export interface DestinoDeMudanza {
  workspaceId: string;
  folderId: string | null;
}

/**
 * Los campos que viajan al servidor.
 *
 * Una carpeta se cuelga de otra con `parentId` y el resto con `folderId`. Un bookmark
 * ademas suelta su coleccion: es del espacio viejo, y el servidor la resolveria igual.
 */
export function valoresDeMudanza(
  kind: MovibleKind,
  destino: DestinoDeMudanza,
): Record<string, unknown> {
  if (kind === "folder") {
    return { workspaceId: destino.workspaceId, parentId: destino.folderId };
  }
  const valores: Record<string, unknown> = {
    workspaceId: destino.workspaceId,
    folderId: destino.folderId,
  };
  if (kind === "bookmark") valores["collectionId"] = null;
  return valores;
}

export interface FilaDeCache {
  entity: string;
  entityId: string;
  payload: Record<string, unknown>;
}

/**
 * Las filas que el servidor mueve **por su cuenta** al mudarse esta, y que el
 * dispositivo tiene que reflejar ya.
 *
 * El arbol del cliente se indexa por `workspaceId:parentId`, asi que una carpeta
 * movida cuyos hijos siguen con el espacio viejo se queda vacia en pantalla hasta el
 * proximo pull. No se encolan operaciones por estas filas: el servidor las mueve y
 * las trae con version nueva.
 */
export function arrastradosPorMudanza(
  kind: MovibleKind,
  id: string,
  cache: readonly FilaDeCache[],
): FilaDeCache[] {
  if (kind === "collection") {
    return cache.filter(
      (fila) => fila.entity === "bookmark" && fila.payload["collectionId"] === id,
    );
  }
  if (kind !== "folder") return [];

  const carpetas = new Set<string>([id]);
  // Por niveles y con tope: un ciclo en el cache no puede colgar la pantalla.
  for (let nivel = 0; nivel < 32; nivel += 1) {
    const antes = carpetas.size;
    for (const fila of cache) {
      if (fila.entity !== "folder") continue;
      const padre = fila.payload["parentId"];
      if (typeof padre === "string" && carpetas.has(padre)) carpetas.add(fila.entityId);
    }
    if (carpetas.size === antes) break;
  }

  return cache.filter((fila) => {
    if (fila.entity === "folder") return fila.entityId !== id && carpetas.has(fila.entityId);
    if (!["list", "note", "collection", "bookmark"].includes(fila.entity)) return false;
    const carpeta = fila.payload["folderId"];
    return typeof carpeta === "string" && carpetas.has(carpeta);
  });
}
