import { API_PREFIX, REQUEST_TIMEOUT_MS } from '@orbit-hub/config';
import { Platform } from 'react-native';

import { retargetLoopbackHost } from './host';

/** A trailing slash doubles up when a path is joined onto the base. */
function withoutTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * The API base URL is a public build-time value. Defaults target the local API
 * so a fresh clone works without configuration; EAS profiles inject the real one.
 *
 * The same value serves all three targets, because the address each one needs is
 * worked out here rather than in the environment. See ./host.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  const configured = fromEnv
    ? withoutTrailingSlash(fromEnv)
    : `http://localhost:4000${API_PREFIX}`;
  return retargetLoopbackHost(configured, Platform.OS);
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

/**
 * Where the app itself is served, for the links that leave the device: the
 * verification mail and the invitations. On the emulator that is the dev server
 * and not the API, so it is the same three-target problem and the same rule.
 */
export const WEB_ORIGIN = retargetLoopbackHost(
  withoutTrailingSlash(
    process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim() || 'http://localhost:8081',
  ),
  Platform.OS,
);

export const DEFAULT_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
