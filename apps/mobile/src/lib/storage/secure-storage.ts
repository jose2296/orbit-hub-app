import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * A SecureStore key on Android is not a free-form string.
 *
 * Android accepts alphanumerics and `.`, `-`, `_`, and nothing else. A colon is
 * rejected, and the error is not "that key is no good" — it comes back as
 * `Invalid key provided to SecureStore`, which reads like a corruption of the
 * stored value rather than a bad name. The app's own keys are namespaced with a
 * colon (`orbithub:access-token`), so on Android they were all invalid and every
 * native sign-in failed at the moment it tried to keep the session.
 *
 * The replacement is not a bare underscore, because that would make
 * `orbithub:access-token` and `orbithub_access-token` the same key — and an
 * underscore is legal on Android, so the second one is a name Android would
 * accept on its own. A character becomes an underscore followed by its hex code
 * (`:` is 3a), and a literal underscore becomes `_5f` rather than staying put.
 * Escaping the escape is what makes it reversible: without it, the `_ac` in
 * `orbithub_access-token` reads as an escaped `¬` and the name cannot be read
 * back. None of the app's real keys contains an underscore, so the escaping is
 * invisible in practice and only ever buys correctness.
 *
 * The prefix is not added on top of the caller's key: the caller already
 * namespaces theirs, and doubling it produced `orbithub:orbithub:access-token`
 * before this.
 */
function nativeKey(key: string): string {
  return key.replace(
    /[^A-Za-z0-9.-]|[_]/g,
    (char) => `_${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

/** The inverse, so the name can be checked back. */
export function fromNativeKey(key: string): string {
  return key.replace(/_([0-9a-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function webStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Private browsing modes can throw on access.
    return null;
  }
}

/**
 * Token storage. Native uses the Keychain / Keystore through expo-secure-store;
 * web falls back to localStorage, which is the strongest option a browser PWA
 * offers (see docs/architecture/auth.md for the trade-off and the mitigations).
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return webStorage()?.getItem(key) ?? null;
    }
    try {
      return await SecureStore.getItemAsync(nativeKey(key));
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(nativeKey(key), value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.removeItem(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(nativeKey(key));
    } catch {
      // Deleting a missing key is not an error worth surfacing.
    }
  },
};
