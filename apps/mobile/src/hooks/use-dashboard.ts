import type { DashboardWidget } from '@orbit-hub/contracts';
import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_LAYOUT, normaliseLayout } from '@/lib/dashboard/layout';
import {
  addWidget,
  compactLayout,
  moveWidget,
  removeWidget,
  togglePin,
} from '@/lib/dashboard/layout';
import { getLocalStoreReady, pullIntoCache, readCachedDashboard, subscribeToLocalStore } from '@/lib/offline';
import { localUpdate } from '@/lib/offline';

const DASHBOARD_ENTITY_ID = 'dashboard';

async function ensureCached() {
  const store = await getLocalStoreReady();
  const rows = await store.listCached('dashboard');
  if (rows.length > 0) return;

  // A brand new user gets a useful starting point instead of a blank screen.
  await store.upsertCached([
    {
      entity: 'dashboard',
      entityId: DASHBOARD_ENTITY_ID,
      version: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      payload: JSON.stringify({ layout: normaliseLayout(DEFAULT_LAYOUT) }),
      pending: null,
    },
  ]);
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
    await ensureCached();
    setLayout(await readCachedDashboard());
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
      await localUpdate('dashboard', DASHBOARD_ENTITY_ID, { layout: normalised });
      await load();
    },
    [load],
  );

  const add = useCallback(
    async (kind: DashboardWidget['kind']) => {
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
    async (id: string, direction: 'up' | 'down') => {
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
