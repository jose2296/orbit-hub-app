import 'expo-sqlite/localStorage/install';

/**
 * Key-value storage for everything that is not a secret.
 *
 * The Expo guidance is to use the `expo-sqlite` localStorage polyfill rather than
 * AsyncStorage: on native it is backed by SQLite, on web it is the browser's own
 * `localStorage`, so the same code and the same keys work on all three targets
 * with one implementation. Secrets do not belong here: they go to
 * `secureStorage`, which is backed by the Keychain / Keystore.
 *
 * The API is synchronous on purpose. These values are small, read during startup
 * and written on a user action, and SQLite reads them without a round trip
 * through a bridge, so there is nothing to await.
 */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Private browsing modes can throw on access.
    return null;
  }
}

export const keyValueStore = {
  get(key: string): string | null {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  set(key: string, value: string): void {
    try {
      storage()?.setItem(key, value);
    } catch {
      // A full or unavailable store must not break the action that triggered it.
    }
  },

  remove(key: string): void {
    try {
      storage()?.removeItem(key);
    } catch {
      // Nothing to do: the in-memory value is already gone.
    }
  },

  /** Reads and parses JSON, returning null for missing or corrupted values. */
  getJson<T>(key: string): T | null {
    const raw = keyValueStore.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  setJson(key: string, value: unknown): void {
    keyValueStore.set(key, JSON.stringify(value));
  },
};
