import type { DashboardWidget } from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import { DEFAULT_LAYOUT, normaliseLayout } from "@/lib/dashboard/layout";
import {
  addWidget,
  compactLayout,
  moveWidget,
  removeWidget,
  togglePin,
} from "@/lib/dashboard/layout";
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
 * The dashboard layout lives in the local cache like everything else, so it
 * renders with no connectivity and every change goes through the same
 * local-first write path as the rest of the content.
 */
export function useDashboard() {
  const [layout, setLayout] = useState<DashboardWidget[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const { row } = await ensureCached();
    setLayout(row ? readLayoutOf(row) : await readCachedDashboard());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const save = useCallback(
    async (next: DashboardWidget[]) => {
      const normalised = normaliseLayout(next);
      setLayout(normalised);
      // The row the read came from, so a pin written here is a pin that comes
      // back on the next read instead of one in a second copy of the panel.
      const { entityId } = await ensureCached();
      await localUpdate("dashboard", entityId, { layout: normalised });
      await load();
    },
    [load],
  );

  const add = useCallback(
    async (kind: DashboardWidget["kind"]) => {
      await save(addWidget(layout, kind));
    },
    [layout, save],
  );

  const remove = useCallback(
    async (id: string) => {
      await save(compactLayout(removeWidget(layout, id)));
    },
    [layout, save],
  );

  const pin = useCallback(
    async (id: string) => {
      await save(togglePin(layout, id));
    },
    [layout, save],
  );

  const move = useCallback(
    async (id: string, direction: "up" | "down") => {
      await save(moveWidget(layout, id, direction));
    },
    [layout, save],
  );

  const refresh = useCallback(async () => {
    await pullIntoCache();
    await load();
  }, [load]);

  const reset = useCallback(async () => {
    await save(normaliseLayout(DEFAULT_LAYOUT));
  }, [save]);

  return { layout, isLoading, add, remove, pin, move, refresh, reset, save };
}
