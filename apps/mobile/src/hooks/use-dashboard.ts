import type { DashboardWidget } from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import { DEFAULT_LAYOUT, normaliseLayout } from "@/lib/dashboard/layout";
import type { CachedEntity } from "@/lib/offline/local-store";
import { resolveDashboardRow } from "@/lib/offline/dashboard-row";
import {
  getLocalStoreReady,
  pullIntoCache,
  readCachedDashboard,
  subscribeToLocalStore,
} from "@/lib/offline";
import { localUpdate } from "@/lib/offline";

/**
 * Makes sure there is a panel to read, and returns the row it is in.
 *
 * A brand new person gets a useful starting point instead of a blank screen,
 * and everybody else gets the row the server uses, so a change made here and a
 * change that arrives on a pull end up in the same place.
 */
async function ensureCached(): Promise<{
  entityId: string;
  row: CachedEntity | null;
}> {
  const store = await getLocalStoreReady();
  const found = await resolveDashboardRow(store);
  if (found.row) return found;

  await store.upsertCached([
    {
      entity: "dashboard",
      entityId: found.entityId,
      version: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      payload: JSON.stringify({ layout: normaliseLayout(DEFAULT_LAYOUT) }),
      pending: null,
    },
  ]);
  return { entityId: found.entityId, row: null };
}

/** The layout of a panel row, or nothing if the row is not one. */
function readLayoutOf(row: CachedEntity): DashboardWidget[] {
  try {
    const payload = JSON.parse(row.payload) as { layout?: DashboardWidget[] };
    return Array.isArray(payload.layout) ? payload.layout : [];
  } catch {
    return [];
  }
}

/**
 * How many screens the panel claims, as stored.
 *
 * Read out of the cached row's own payload rather than kept in state, because the
 * row arrives from a pull and from another device: a number held in state is a
 * number that goes stale the moment somebody arranges a panel on their phone.
 * A row written before panels had a count simply has none, and one screen is the
 * right answer for it.
 */
function readPagesOf(row: CachedEntity | null): number {
  if (!row) return 1;
  try {
    const payload = JSON.parse(row.payload) as { pages?: unknown };
    const n = Math.trunc(Number(payload.pages));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  } catch {
    return 1;
  }
}

/**
 * The dashboard layout lives in the local cache like everything else, so it
 * renders with no connectivity and every change goes through the same
 * local-first write path as the rest of the content.
 */
export function useDashboard() {
  const [layout, setLayout] = useState<DashboardWidget[]>([]);
  const [pages, setPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  /**
   * Whether a write is in flight.
   *
   * The panel writes a whole layout at once and the write goes through the outbox,
   * so it is not instant even though it looks it. The button that ends the
   * arrangement needs to know: a "Guardar" that can be pressed twice is two writes
   * of the same thing, and one that shows nothing while it works reads as a button
   * that is broken.
   */
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { row } = await ensureCached();
    setLayout(row ? readLayoutOf(row) : await readCachedDashboard());
    setPages(readPagesOf(row));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const save = useCallback(
    async (next: DashboardWidget[], nextPages?: number) => {
      const normalised = normaliseLayout(next);
      const cuenta =
        nextPages === undefined ? pages : Math.max(1, Math.trunc(Number(nextPages)));
      setLayout(normalised);
      setPages(cuenta);
      setSaving(true);
      try {
        // The row the read came from, so a pin written here is a pin that comes
        // back on the next read instead of one in a second copy of the panel.
        const { entityId } = await ensureCached();
        await localUpdate("dashboard", entityId, { layout: normalised, pages: cuenta });
        await load();
      } finally {
        // `finally` and not the happy path: a write that throws still finished, and
        // a button left spinning forever is worse than one that stopped early.
        setSaving(false);
      }
    },
    [load],
  );

  const refresh = useCallback(async () => {
    await pullIntoCache();
    await load();
  }, [load]);

  const reset = useCallback(async () => {
    await save(normaliseLayout(DEFAULT_LAYOUT), 1);
  }, [save]);

  return { layout, pages, isLoading, saving, refresh, reset, save };
}
