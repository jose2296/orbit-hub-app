import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const WEB_PREFIX = 'orbithub:';

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
      return webStorage()?.getItem(WEB_PREFIX + key) ?? null;
    }
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(WEB_PREFIX + key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage()?.removeItem(WEB_PREFIX + key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Deleting a missing key is not an error worth surfacing.
    }
  },
};
