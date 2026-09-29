import type { DashboardWidget, SyncEntity } from "@orbit-hub/contracts";

import { resolveDashboardRow } from "./dashboard-row";
import type { CachedEntity, LocalStore } from "./local-store";

/**
 * How a panel that arrives from el servidor lands en la fila que ya está aquí.
 *
 * El panel es una fila por persona y el servidor le da un identificador propio, que
 * no es el que escribió este dispositivo. Escribir la fila tal cual deja dos
 * paneles en la cache, y a partir de ahí cada lectura se lleva el primero: una lista
 * fijada en el teléfono desaparece en el portátil y vuelve en el teléfono. Así que
 * la fila que llega se copia en la que ya está, bajo el identificador que sigue
 * viniendo.
 *
 * Y se copian **las dos cosas** que el panel necesita. Copiar solo el layout —que
 * fue lo que había— deja el número de pantallas por el camino, y el número de
 * pantallas es lo único que distingue una pantalla con tarjetas de una pantalla
 * vacía que alguien acaba de crear. Lo que se pierde así no se ve: el botón de
 * añadir pantalla hace su trabajo, se guarda, y a la siguiente carga no está.
 */
export async function applyDashboardChanges(
  store: LocalStore,
  changes: { entity: SyncEntity; record: unknown }[],
): Promise<void> {
  for (const change of changes) {
    if (change.entity !== "dashboard") continue;
    const record = (change.record ?? {}) as Record<string, unknown>;
    const { entityId } = await resolveDashboardRow(store);
    await store.upsertCached([
      {
        ...filaDe(change),
        entityId,
        payload: JSON.stringify({
          layout: readLayoutOf(record),
          pages: readPagesOf(record),
        }),
      },
    ]);
  }
}

/** The row as it arrives, with the two fields the cache row is shaped by. */
function filaDe(change: { entity: SyncEntity; record: unknown }): CachedEntity {
  const record = (change.record ?? {}) as Record<string, unknown>;
  return {
    entity: change.entity,
    entityId: String(record["id"] ?? ""),
    version: Number(record["version"] ?? 0),
    updatedAt: new Date(
      String(record["updatedAt"] ?? new Date().toISOString()),
    ).toISOString(),
    deletedAt: record["deletedAt"]
      ? new Date(String(record["deletedAt"])).toISOString()
      : null,
    payload: JSON.stringify(record),
    pending: null,
  };
}

/**
 * The cards, whether the row brings them as a column or inside a `payload`.
 *
 * Both, because both exist: the sync pull hands the record over flat and the routes
 * that answer for a workspace hand it over wrapped. A reader that only knows one of
 * them shows an empty panel on the other, with nothing saying why.
 */
function readLayoutOf(record: Record<string, unknown>): DashboardWidget[] {
  const directo = record["layout"];
  if (Array.isArray(directo)) return directo as DashboardWidget[];
  const envuelto = record["payload"];
  if (envuelto && typeof envuelto === "object") {
    const dentro = (envuelto as Record<string, unknown>)["layout"];
    if (Array.isArray(dentro)) return dentro as DashboardWidget[];
  }
  return [];
}

/**
 * How many screens the panel claims, never fewer than one.
 *
 * Clamped rather than trusted: a row written before screens existed brings no count
 * and one screen is the right answer for it, and a count of zero would erase a panel
 * that has cards on it.
 */
function readPagesOf(record: Record<string, unknown>): number {
  const directo = record["pages"];
  const envuelto =
    directo === undefined && record["payload"] && typeof record["payload"] === "object"
      ? (record["payload"] as Record<string, unknown>)["pages"]
      : directo;
  const n = Math.trunc(Number(envuelto));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
