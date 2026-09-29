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

/**
 * Just the scheme and host, for the URLs that are not API calls.
 *
 * A storage driver may hand out a path instead of a full address — the local one
 * does, because it is this same process serving the bytes — and a client that
 * resolved that against the page's own origin would send a ten megabyte picture to
 * whatever dev server is serving the page. Joining it here is the one place that
 * knows both halves.
 */
export const API_ORIGIN = new URL(API_BASE_URL).origin;

/** Longest edge case: Expo web dev server vs device on the LAN. */
export const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'http://localhost:8081';
export const DEFAULT_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
