import type { SyncConflict, SyncState, SyncStatus } from '@orbit-hub/contracts';
import { useCallback, useEffect, useState } from 'react';

import { STORAGE_KEYS } from '@/constants';
import { getLocalStoreReady, subscribeToLocalStore, syncNow as runSyncNow } from '@/lib/offline';
import type { PendingOperationRecord } from '@/lib/offline';
import { keyValueStore } from '@/lib/storage/key-value';

import { useNetworkStatus } from './use-network-status';
import type { ConnectionState } from './use-network-status';

export interface SyncCentre {
  status: SyncStatus;
  pending: PendingOperationRecord[];
  conflicts: SyncConflict[];
  isSyncing: boolean;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
  lastMessage: string | null;
}

const INITIAL_STATUS: SyncStatus = {
  state: 'idle',
  pendingOperations: 0,
  pendingConflicts: 0,
  lastSyncedAt: null,
  lastError: null,
};

/**
 * Single source of truth for the sync indicator used by the home card and the
 * sync centre. Counts come from the local store, never from the API, so the UI
 * is correct even with no connectivity.
 */
export function useSyncStatus(): SyncCentre {
  const network = useNetworkStatus();
  const [status, setStatus] = useState<SyncStatus>(INITIAL_STATUS);
  const [pending, setPending] = useState<PendingOperationRecord[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const store = await getLocalStoreReady();
    const [records, storedConflicts, pendingCount, conflictCount] = await Promise.all([
      store.listPending(50),
      store.listConflicts(),
      store.countPending(),
      store.countConflicts(),
    ]);

    setPending(records);
    setConflicts(storedConflicts);
    setStatus((current) => ({
      ...current,
      pendingOperations: pendingCount,
      pendingConflicts: conflictCount,
      lastSyncedAt: keyValueStore.get(STORAGE_KEYS.lastSyncedAt),
      state: resolveState(network.state, isSyncing, pendingCount, conflictCount, current.lastError),
    }));
  }, [isSyncing, network.state]);

  useEffect(() => {
    void refresh();
    return subscribeToLocalStore(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    setStatus((current) => ({
      ...current,
      state: resolveState(network.state, isSyncing, current.pendingOperations, current.pendingConflicts, current.lastError),
    }));
  }, [isSyncing, network.state]);

  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    setLastMessage(null);
    try {
      // The same serialised path the engine uses, so a manual sync can never
      // race an automatic one over the same operations.
      const result = await runSyncNow();
      if (result.error) {
        setLastMessage(result.error);
        setStatus((current) => ({ ...current, lastError: result.error }));
        return;
      }
      const timestamp = new Date().toISOString();
      keyValueStore.set(STORAGE_KEYS.lastSyncedAt, timestamp);
      setStatus((current) => ({ ...current, lastSyncedAt: timestamp, lastError: null }));
      setLastMessage('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sync failed';
      setLastMessage(message);
      setStatus((current) => ({ ...current, lastError: message }));
    } finally {
      setIsSyncing(false);
      await refresh();
    }
  }, [refresh]);

  return { status, pending, conflicts, isSyncing, refresh, syncNow, lastMessage };
}

function resolveState(
  network: ConnectionState,
  isSyncing: boolean,
  pendingCount: number,
  conflictCount: number,
  lastError: string | null,
): SyncState {
  if (network === 'offline') return 'offline';
  if (isSyncing) return 'syncing';
  if (conflictCount > 0) return 'blocked';
  if (lastError) return 'error';
  return pendingCount > 0 ? 'syncing' : 'idle';
}
