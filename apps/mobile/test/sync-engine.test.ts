import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sync engine is what makes local-first writes reach the server without the
 * user asking. Its whole job is timing, so the tests drive fake timers and
 * count the calls: a regression here means data sits in the outbox forever,
 * which no other test would notice.
 */

const flushOutbox = vi.fn();
const pullIntoCache = vi.fn();
const countPending = vi.fn();
const listeners = new Set<() => void>();
const netInfoListeners = new Set<(state: { isConnected: boolean; isInternetReachable: boolean }) => void>();

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: (listener: (state: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
      netInfoListeners.add(listener);
      return () => netInfoListeners.delete(listener);
    },
  },
}));

const storage = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  },
}));

vi.mock('../src/lib/offline/sync-service', () => ({
  flushOutbox: (...args: unknown[]) => flushOutbox(...args),
  pullIntoCache: (...args: unknown[]) => pullIntoCache(...args),
}));

vi.mock('../src/lib/offline/local-store', () => ({
  getLocalStoreReady: async () => ({ countPending: () => countPending() }),
  subscribeToLocalStore: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

const { startSyncEngine, stopSyncEngine, syncNow } = await import('../src/lib/offline/sync-engine');

const DEBOUNCE_MS = 1_500;

function succeed() {
  flushOutbox.mockResolvedValue({ attempted: 1, applied: 1, duplicates: 0, conflicts: 0, failed: 0, error: null });
  pullIntoCache.mockResolvedValue({ received: 2, cursor: 'c1', error: null });
}

beforeEach(() => {
  vi.useFakeTimers();
  storage.clear();
  flushOutbox.mockReset();
  pullIntoCache.mockReset();
  countPending.mockReset();
  countPending.mockResolvedValue(1);
  listeners.clear();
  netInfoListeners.clear();
  succeed();
  stopSyncEngine();
});

describe('sync engine', () => {
  it('pushes queued work shortly after starting', async () => {
    startSyncEngine();
    expect(flushOutbox).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(flushOutbox).toHaveBeenCalledTimes(1);
    expect(pullIntoCache).toHaveBeenCalledTimes(1);
  });

  it('pushes after a local write without any user action', async () => {
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    flushOutbox.mockClear();

    // What enqueueOperation triggers through the store subscription.
    for (const listener of listeners) listener();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('batches a burst of writes into a single push', async () => {
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    flushOutbox.mockClear();

    for (const listener of listeners) {
      listener();
      await vi.advanceTimersByTimeAsync(100);
      listener();
      await vi.advanceTimersByTimeAsync(100);
      listener();
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('pushes as soon as connectivity returns', async () => {
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    flushOutbox.mockClear();

    for (const listener of netInfoListeners) {
      listener({ isConnected: false, isInternetReachable: false });
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(flushOutbox).not.toHaveBeenCalled();

    for (const listener of netInfoListeners) {
      listener({ isConnected: true, isInternetReachable: true });
    }
    await vi.advanceTimersByTimeAsync(10);

    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('does not push when the outbox is empty', async () => {
    countPending.mockResolvedValue(0);
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(flushOutbox).not.toHaveBeenCalled();
    expect(pullIntoCache).toHaveBeenCalledTimes(1);
  });

  it('does not pull after a failed push, and backs off', async () => {
    flushOutbox.mockResolvedValue({
      attempted: 1, applied: 0, duplicates: 0, conflicts: 0, failed: 1, error: 'network down',
    });
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(pullIntoCache).not.toHaveBeenCalled();

    // A write during the backoff waits longer than the normal debounce.
    const before = flushOutbox.mock.calls.length;
    for (const listener of listeners) listener();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(flushOutbox.mock.calls.length).toBe(before);
  });

  it('never runs two batches at once', async () => {
    // Held in an object so the assignment inside the promise is visible to the
    // type checker, which cannot see through the callback otherwise.
    const gate: { release: (() => void) | null } = { release: null };
    flushOutbox.mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.release = () =>
            resolve({ attempted: 1, applied: 1, duplicates: 0, conflicts: 0, failed: 0, error: null });
        }),
    );

    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(flushOutbox).toHaveBeenCalledTimes(1);

    // A write and a manual sync arrive mid flight; both join it.
    for (const listener of listeners) listener();
    const manual = syncNow();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(flushOutbox).toHaveBeenCalledTimes(1);
    gate.release?.();
    await expect(manual).resolves.toMatchObject({ pushed: 1 });
  });

  it('reports the failure to a manual sync', async () => {
    flushOutbox.mockResolvedValue({
      attempted: 1, applied: 0, duplicates: 0, conflicts: 0, failed: 1, error: 'network down',
    });
    startSyncEngine();

    await expect(syncNow()).resolves.toMatchObject({ error: 'network down' });
  });

  it('records when it last synced, so the centre is not stuck on "never"', async () => {
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(storage.get('orbithub:last-synced-at')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('leaves the timestamp alone when the server is unreachable', async () => {
    pullIntoCache.mockResolvedValue({ received: 0, cursor: null, error: 'network down' });
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(storage.get('orbithub:last-synced-at')).toBeUndefined();
  });

  it('stops touching the network after being stopped', async () => {
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    stopSyncEngine();
    flushOutbox.mockClear();

    for (const listener of listeners) listener();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 4);

    expect(flushOutbox).not.toHaveBeenCalled();
  });

  it('ignores a second start, so several callers are safe', async () => {
    startSyncEngine();
    startSyncEngine();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(flushOutbox).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    expect(netInfoListeners.size).toBe(1);
  });
});
