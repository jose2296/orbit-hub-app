import type { DashboardWidget } from "@orbit-hub/contracts";

import { getLocalStoreReady } from "@/lib/offline/local-store";
import type { CachedEntity, LocalStore } from "@/lib/offline/local-store";

/**
 * The one row of the cache that holds this person's panel.
 *
 * The panel is a singleton: one per person, whatever device and whatever
 * version of the app wrote it. It used to have two rows, because the device
 * wrote one under an identifier of its own and the server wrote another under
 * its own, and every read took whichever came first. Pinning a list then looked
 * like it worked and came back a day later, on another device, gone.
 *
 * So there is one row. The identifier the server uses wins, because that is the
 * one that comes back on a pull, and the layout the device had is carried into
 * it and the duplicate removed, so nothing is lost in the merge.
 *
 * The fallback identifier is a uuid and not a word because the sync contract
 * rejects anything that is not one, and a single bad identifier holds the whole
 * outbox hostage: the push comes back as a 422 for every operation in it.
 */
export const FALLBACK_DASHBOARD_ID = "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30";

const isFallback = (id: string): boolean => id === FALLBACK_DASHBOARD_ID;

/**
 * The row of the panel this person has, after merging any duplicate into it.
 *
 * A merge and not a choice between the two: a list pinned on the phone and one
 * pinned on the laptop are both things this person asked for, and the panel
 * keeps whichever row has more of them. Ties go to the row that is already the
 * server's, so the result is the same on both devices.
 */
export async function resolveDashboardRow(
  store: LocalStore,
): Promise<{ entityId: string; row: CachedEntity | null }> {
  const rows = (await store.listCached("dashboard")).filter(
    (row) => !row.deletedAt,
  );
  if (rows.length === 0) return { entityId: FALLBACK_DASHBOARD_ID, row: null };

  // The server's row is the one that arrives on a pull, so it is the one that
  // has to be the surviving one whenever there is a choice.
  const keep = rows.find((row) => !isFallback(row.entityId)) ?? rows[0]!;
  const others = rows.filter((row) => row.entityId !== keep.entityId);
  if (others.length === 0) return { entityId: keep.entityId, row: keep };

  const layouts = [keep, ...others]
    .map((row) => readLayout(row))
    .filter((layout): layout is DashboardWidget[] => layout !== null);
  const merged = dedupeById(layouts.flat());

  /*
   * The whole payload, and not just the layout.
   *
   * Writing `{ layout }` threw away the page count, so a merge turned a panel of
   * four screens into one — and a merge happens the first time a row arrives from
   * a pull on a device that had made its own, which is the first run of a new
   * phone. The count is the part of the panel people notice losing, because the
   * cards are all still there on screen one and quietly gone from the other three.
   */
  await store.upsertCached([
    {
      ...keep,
      payload: JSON.stringify({
        ...readPayload(keep),
        layout: merged,
        pages: widestPageCount(keep, others),
      }),
      pending: keep.pending,
    },
  ]);
  for (const row of others) {
    await store.upsertCached([
      {
        ...row,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  }

  return {
    entityId: keep.entityId,
    row: await store.getCached("dashboard", keep.entityId),
  };
}

/** The row of the panel, with the local store ready. */
export async function dashboardRow(): Promise<{
  entityId: string;
  row: CachedEntity | null;
}> {
  return resolveDashboardRow(await getLocalStoreReady());
}

function readPayload(row: CachedEntity): Record<string, unknown> {
  try {
    const payload = JSON.parse(row.payload) as unknown;
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * How many screens survive the merge: the most any of the rows claimed.
 *
 * The most rather than the server's, because a person who made four screens on a
 * phone has four screens whether or not the laptop knows about them yet, and a
 * merge is not the moment to tell them they have one.
 */
function widestPageCount(keep: CachedEntity, others: CachedEntity[]): number {
  const counts = [keep, ...others].map((row) => {
    const n = Math.trunc(Number(readPayload(row).pages));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  });
  return Math.max(...counts);
}

function readLayout(row: CachedEntity): DashboardWidget[] | null {
  try {
    const payload = JSON.parse(row.payload) as { layout?: unknown };
    return Array.isArray(payload.layout)
      ? (payload.layout as DashboardWidget[])
      : null;
  } catch {
    return null;
  }
}

/** One card per identifier: the first one wins, which is the one that was there. */
function dedupeById(widgets: DashboardWidget[]): DashboardWidget[] {
  const seen = new Set<string>();
  return widgets.filter((widget) => {
    if (seen.has(widget.id)) return false;
    seen.add(widget.id);
    return true;
  });
}
