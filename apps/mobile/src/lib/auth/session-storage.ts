import type { Device, Session, User } from '@orbit-hub/contracts';

import { secureStorage } from '@/lib/storage/secure-storage';
import { keyValueStore } from '@/lib/storage/key-value';

const REFRESH_TOKEN_KEY = 'orbithub:refresh-token';
const ACCESS_TOKEN_KEY = 'orbithub:access-token';
const SESSION_META_KEY = 'orbithub:session-meta';

interface SessionMeta {
  expiresIn: number;
  issuedAt: number;
  user: User;
  device?: Device;
}

export interface StoredSession {
  /** Reassembled from the two secure tokens plus the stored profile. */
  session: Session;
  /** When the access token was issued, used to refresh before it expires. */
  issuedAt: number;
}

/**
 * Session persistence.
 *
 * Both tokens are credentials, so both live in secure storage (Keychain /
 * Keystore, and localStorage on web, which is the strongest thing a browser PWA
 * offers). Only the profile goes to the plain key-value store, so the settings
 * screens can read the user's name without unlocking the keychain on every
 * launch. See docs/architecture/auth.md for the web trade-off.
 */
export const sessionStorage = {
  async read(): Promise<StoredSession | null> {
    try {
      const [refreshToken, accessToken] = await Promise.all([
        secureStorage.get(REFRESH_TOKEN_KEY),
        secureStorage.get(ACCESS_TOKEN_KEY),
      ]);
      const meta = keyValueStore.getJson<SessionMeta>(SESSION_META_KEY);

      if (!refreshToken || !accessToken || !meta) return null;

      return {
        session: {
          accessToken,
          refreshToken,
          expiresIn: meta.expiresIn,
          tokenType: 'Bearer',
          user: meta.user,
          ...(meta.device ? { device: meta.device } : {}),
        },
        issuedAt: meta.issuedAt,
      };
    } catch {
      return null;
    }
  },

  async write(session: Session, issuedAt = Date.now()): Promise<void> {
    const meta: SessionMeta = {
      expiresIn: session.expiresIn,
      issuedAt,
      user: session.user,
      ...(session.device ? { device: session.device } : {}),
    };

    await Promise.all([
      secureStorage.set(REFRESH_TOKEN_KEY, session.refreshToken),
      secureStorage.set(ACCESS_TOKEN_KEY, session.accessToken),
    ]);
    // Storage failures must not break an otherwise successful login, and the
    // in-memory session is already correct at this point.
    keyValueStore.setJson(SESSION_META_KEY, meta);
  },

  async clear(): Promise<void> {
    keyValueStore.remove(SESSION_META_KEY);
    await Promise.all([
      secureStorage.remove(REFRESH_TOKEN_KEY),
      secureStorage.remove(ACCESS_TOKEN_KEY),
    ]);
  },
};
