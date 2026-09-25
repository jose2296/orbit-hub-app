import { API_PREFIX, REQUEST_TIMEOUT_MS } from '@orbit-hub/config';

/**
 * The API base URL is a public build-time value. Defaults target the local API
 * so a fresh clone works without configuration; EAS profiles inject the real one.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return fromEnv.endsWith('/') ? fromEnv.slice(0, -1) : fromEnv;
  }
  return `http://localhost:4000${API_PREFIX}`;
}

export const API_BASE_URL = resolveBaseUrl();

/** Longest edge case: Expo web dev server vs device on the LAN. */
export const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'http://localhost:8081';
export const DEFAULT_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
