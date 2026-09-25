import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Device, Session, User } from '@orbit-hub/contracts';

import { secureStorage } from '@/lib/storage/secure-storage';

const REFRESH_TOKEN_KEY = 'orbithub:refresh-token';
const SESSION_META_KEY = 'orbithub:session-meta';

interface SessionMeta {
  accessToken: string;
  expiresIn: number;
  issuedAt: number;
  user: User;
  device?: Device;
}

export interface StoredSession {
  session: Session;
  /** When the access token was issued, used to refresh before it expires. */
  issuedAt: number;
}

/**
 * The refresh token is the only long lived credential, so it goes to secure
 * storage (Keychain / Keystore). The rest of the session is non-sensitive
 * profile data and stays in AsyncStorage for fast reads.
 */
export const sessionStorage = {
  async read(): Promise<StoredSession | null> {
    try {
      const [refreshToken, rawMeta] = await Promise.all([
        secureStorage.get(REFRESH_TOKEN_KEY),
        AsyncStorage.getItem(SESSION_META_KEY),
      ]);

      if (!refreshToken || !rawMeta) return null;

      const meta = JSON.parse(rawMeta) as SessionMeta;
      if (!meta?.accessToken) return null;

      return {
        issuedAt: meta.issuedAt,
        session: {
          accessToken: meta.accessToken,
          refreshToken,
          expiresIn: meta.expiresIn,
          tokenType: 'Bearer',
          user: meta.user,
          ...(meta.device ? { device: meta.device } : {}),
        },
      };
    } catch {
      return null;
    }
  },

  async write(session: Session, issuedAt = Date.now()): Promise<void> {
    const meta: SessionMeta = {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      issuedAt,
      user: session.user,
      ...(session.device ? { device: session.device } : {}),
    };

    await Promise.all([
      secureStorage.set(REFRESH_TOKEN_KEY, session.refreshToken),
      AsyncStorage.setItem(SESSION_META_KEY, JSON.stringify(meta)).catch(() => {
        // Storage failures must not break an otherwise successful login.
      }),
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([
      secureStorage.remove(REFRESH_TOKEN_KEY),
      AsyncStorage.removeItem(SESSION_META_KEY).catch(() => {
        // Nothing to do: the in-memory session is cleared by the caller.
      }),
    ]);
  },
};
