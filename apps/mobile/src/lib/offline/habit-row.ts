import type { SyncEntity } from "@orbit-hub/contracts";

import type { CachedEntity, LocalStore } from "./local-store";

/**
 * El merge de una entrada de habito.
 *
 * Precedencia: done > skipped > borrado. Un hecho no se deshace por sync:
 * ni un salto ni un borrado que llega del servidor cambian un done local,
 * y un salto tampoco lo cambia un borrado. El empate lo gana el servidor,
 * que es el que trae la version mas nueva.
 *
 * Y nunca abre conflicto: no toca `sync_conflicts`. Un conflicto pide a la
 * persona que elija entre dos valores, y aqui no hay nada que elegir: la
 * regla lo decide sola, en todos los telefonos igual.
 */
export type EntryStanding = "done" | "skipped" | "deleted";

const RANK: Record<EntryStanding, number> = {
  deleted: 0,
  skipped: 1,
  done: 2,
};

export function standingOf(record: Record<string, unknown>): EntryStanding {
  if (record.deletedAt) return "deleted";
  return record.status === "done" ? "done" : "skipped";
}

/**
 * La entrada que queda, dadas la que trae el servidor y la que hay en
 * cache. Pura: no lee ni escribe nada, asi se prueba sin tienda.
 */
export function mergeHabitEntry(
  server: Record<string, unknown>,
  local: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!local) return { ...server };
  if (RANK[standingOf(local)] > RANK[standingOf(server)]) {
    return { ...server, status: statusOf(local), deletedAt: null };
  }
  return { ...server };
}

function statusOf(record: Record<string, unknown>): "done" | "skipped" {
  return record.status === "done" ? "done" : "skipped";
}

function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Lo que el servidor tiene que saber para converger con lo local. */
export interface EntryCorrection {
  entityId: string;
  baseVersion: number;
  base: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/**
 * Aplica las entradas que trae el pull, ya mezcladas con lo local.
 *
 * Devuelve las correcciones donde lo local gano sobre una fila viva del
 * servidor, para que el que llama las encole y el servidor converja al
 * mismo valor. Una lapida no se revive desde aqui: un update no la limpia,
 * y inventar un create partiria el dia en dos filas.
 */
export async function applyHabitEntryChanges(
  store: LocalStore,
  changes: { entity: SyncEntity; record: unknown }[],
): Promise<{ applied: number; corrections: EntryCorrection[] }> {
  const corrections: EntryCorrection[] = [];
  let applied = 0;

  for (const change of changes) {
    if (change.entity !== "habit_entry") continue;
    const server = (change.record ?? {}) as Record<string, unknown>;
    const entityId = String(server.id ?? "");
    if (!entityId) continue;

    const cached = await store.getCached("habit_entry", entityId);
    // Un pendiente es una edicion sin reconocer: el outbox es dueno de esa
    // verdad y el pull no la pisa. Sin esto, borrar sin conexion y recibir
    // el valor viejo del servidor resucita la entrada en pantalla, y el
    // borrado que sigue en cola la vuelve a borrar: parpadea.
    const local = cached
      ? { ...safeParse(cached.payload), ...safeParse(cached.pending) }
      : null;
    // La lapida local tambien cuenta: si la persona borro sin conexion, lo
    // borrado es lo que hay, aunque el payload todavia diga done.
    const merged = mergeHabitEntry(
      server,
      cached?.deletedAt
        ? { ...local, deletedAt: cached.deletedAt }
        : (local ?? null),
    );
    await store.upsertCached([filaDe(entityId, merged)]);
    applied += 1;

    if (
      cached &&
      local &&
      !cached.deletedAt &&
      !server.deletedAt &&
      statusOf(merged) !== statusOf(server)
    ) {
      corrections.push({
        entityId,
        baseVersion: Number(server.version ?? 0),
        base: { ...server },
        payload: { status: statusOf(merged) },
      });
    }
  }

  return { applied, corrections };
}

function filaDe(entityId: string, merged: Record<string, unknown>): CachedEntity {
  const deletedAt = merged.deletedAt ? String(merged.deletedAt) : null;
  return {
    entity: "habit_entry",
    entityId,
    version: Number(merged.version ?? 0),
    updatedAt: String(merged.updatedAt ?? new Date().toISOString()),
    deletedAt,
    payload: JSON.stringify({ ...merged, id: entityId, deletedAt }),
    pending: null,
  };
}
