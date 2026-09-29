import type { SyncEntity } from "@orbit-hub/contracts";

import { getLocalStoreReady, enqueueOperations } from "@/lib/offline";
import type { ContentRow } from "@/lib/content-order";

const ENTITY_DE: Record<ContentRow["kind"], SyncEntity> = {
  folder: "folder",
  list: "list",
  note: "note",
};

/** One row, with its new number, and the number it had. */
type Movimiento = {
  entity: SyncEntity;
  entityId: string;
  /** The version the row is at, read from the cache and never invented. */
  version: number;
  deletedAt: string | null;
  /** The row as it is stored, which is what goes back with a new number in it. */
  registro: Record<string, unknown>;
  anterior: number;
  nueva: number;
};

/**
 * Saves a hand-made order across folders, lists and notes at once.
 *
 * The point of this function is that it does not care which of the three moved.
 * A folder, a list and a note are three tables and three routes, and a person
 * dragging a row in a folder that shows all three does not know or care which
 * one they just moved — so the row says what it is and this writes the right
 * entity for each.
 *
 * **The row that goes into the cache is the one that was already there, with the
 * new number put in.** Not the `ContentRow`, and that is worth spelling out
 * because the first version did exactly that and it quietly ate the data: a
 * `ContentRow` has `name` where a list has `title`, and no `document` and no
 * `version`, so one drag replaced every field of the cached row with a sort key.
 * The screen kept drawing — the name was there under its own key — and the title
 * of every list and the whole document of every note that had been dragged was
 * gone from the device, to be pushed to the server as an empty object on the
 * next sync. Nothing about it looked wrong until you read the cache.
 *
 * So: read what is stored, change one number, write it back. A row this function
 * has not read is a row it does not write, and a row it did not write is a move
 * it does not announce either — with no cached row there is no version to
 * compare against, and a move sent against a version nobody knows is a conflict
 * waiting for somebody else's screen.
 */
export async function saveContentOrder(
  changed: ContentRow[],
  before: Map<string, number>,
): Promise<void> {
  if (changed.length === 0) return;

  const store = await getLocalStoreReady();
  const ahora = new Date().toISOString();
  const movimientos: Movimiento[] = [];

  for (const row of changed) {
    const entity = ENTITY_DE[row.kind];
    const guardado = await store.getCached(entity, row.id);
    // Not here: deleted on another device, or the cache was cleared under us.
    if (!guardado) continue;
    movimientos.push({
      entity,
      entityId: row.id,
      version: guardado.version,
      deletedAt: guardado.deletedAt,
      registro: JSON.parse(guardado.payload) as Record<string, unknown>,
      anterior: before.get(row.id) ?? row.position,
      nueva: row.position,
    });
  }

  if (movimientos.length === 0) return;

  const guardadas = movimientos.map((movimiento) => ({
    entity: movimiento.entity,
    entityId: movimiento.entityId,
    version: movimiento.version,
    updatedAt: ahora,
    deletedAt: movimiento.deletedAt,
    payload: JSON.stringify({ ...movimiento.registro, position: movimiento.nueva }),
    pending: JSON.stringify({ position: movimiento.nueva }),
  }));

  await store.upsertCached(guardadas);

  await enqueueOperations(
    movimientos.map((movimiento) => ({
      kind: "update" as const,
      entity: movimiento.entity,
      entityId: movimiento.entityId,
      baseVersion: movimiento.version,
      // The previous number as the base, so a change on another device merges
      // instead of overwriting: the position did not change over there.
      base: { position: movimiento.anterior },
      payload: { position: movimiento.nueva },
    })),
  );
}
