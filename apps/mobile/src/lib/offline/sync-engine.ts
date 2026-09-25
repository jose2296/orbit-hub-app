import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { STORAGE_KEYS } from '@/constants';

import { getLocalStoreReady, subscribeToLocalStore } from './local-store';
import { flushOutbox, pullIntoCache } from './sync-service';

/**
 * Automatic synchronisation.
 *
 * Writes are local first: every change lands in the outbox and the UI moves on.
 * This engine is what empties that outbox again, because leaving it to a manual
 * button means a write made on a train is still unsynced the next morning.
 *
 * It runs on four triggers:
 *   - a local write (debounced, so a burst becomes one batch),
 *   - the app becoming authenticated,
 *   - connectivity coming back,
 *   - a slow timer, to catch changes made by another device.
 *
 * Pushes and pulls are serialised: overlapping batches would race on the same
 * entities and on the cursor.
 */

const DEBOUNCE_MS = 1_500;
const PERIODIC_MS = 120_000;
/** Grows while the server keeps failing, so a dead server is not hammered. */
const MAX_BACKOFF_MS = 60_000;

export interface SyncRunResult {
  pushed: number;
  pulled: number;
  error: string | null;
}

let running = false;
let syncing: Promise<SyncRunResult> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let storeUnsubscribe: (() => void) | null = null;
let backoffMs = 0;

async function runOnce(): Promise<SyncRunResult> {
  // A second caller joins the batch in flight instead of starting its own.
  if (!running) return { pushed: 0, pulled: 0, error: null };
  if (syncing) return syncing;

  syncing = (async () => {
    const store = await getLocalStoreReady();
    const pending = await store.countPending();
    let pushed = 0;

    if (pending > 0) {
      const result = await flushOutbox();
      if (result.error) {
        backoffMs = Math.min(backoffMs === 0 ? DEBOUNCE_MS : backoffMs * 2, MAX_BACKOFF_MS);
        return { pushed, pulled: 0, error: result.error };
      }
      pushed = result.applied + result.duplicates;
      backoffMs = 0;
    }

    const pull = await pullIntoCache();
    if (!pull.error) {
      // Recorded here rather than in the sync centre, so an automatic sync and
      // a manual one leave the same "last synced" trace.
      await AsyncStorage.setItem(STORAGE_KEYS.lastSyncedAt, new Date().toISOString()).catch(() => {
        // Losing the timestamp only affects the "last synced" label.
      });
    }
    return { pushed, pulled: pull.received, error: pull.error };
  })().finally(() => {
    syncing = null;
  });

  return syncing;
}

function schedule(delay: number): void {
  if (!running) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runOnce();
  }, delay);
}

/**
 * Starts syncing. Safe to call more than once: only the first call does
 * anything, so several components can ask for it without coordinating.
 */
export function startSyncEngine(): void {
  if (running) return;
  running = true;
  backoffMs = 0;

  // Drain whatever a previous session left behind before waiting for events.
  schedule(DEBOUNCE_MS);

  storeUnsubscribe = subscribeToLocalStore(() => {
    schedule(DEBOUNCE_MS + backoffMs);
  });

  periodicTimer = setInterval(() => {
    void runOnce();
  }, PERIODIC_MS);

  netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    const reachable = state.isInternetReachable !== false;
    const connected = state.isConnected !== false && reachable;
    if (connected) {
      // Coming back online is the one moment where a sync is always worth it.
      schedule(backoffMs);
    }
  });
}

/** Stops syncing and forgets the timers. Pending operations stay queued. */
export function stopSyncEngine(): void {
  running = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (periodicTimer) clearInterval(periodicTimer);
  debounceTimer = null;
  periodicTimer = null;
  backoffMs = 0;
  storeUnsubscribe?.();
  netInfoUnsubscribe?.();
  storeUnsubscribe = null;
  netInfoUnsubscribe = null;
}

/** Runs a sync right now, bypassing the debounce. Used by the sync centre. */
export async function syncNow(): Promise<SyncRunResult> {
  if (!running) startSyncEngine();
  return runOnce();
}
