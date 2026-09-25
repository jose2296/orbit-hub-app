/**
 * Non-secret configuration shared by the app and the API.
 *
 * Anything sensitive (client secrets, database URLs, signing keys) must never
 * live here. Those belong in environment variables — see `.env.example`.
 */

export const APP_NAME = 'OrbitHub';
export const APP_SLUG = 'orbit-hub';
export const APP_SCHEME = 'orbithub';
export const APP_TAGLINE = 'Your day, your lists, one place.';

/** Reverse-DNS identifiers. Provisional until the store accounts are created. */
export const IOS_BUNDLE_ID = 'com.orbithub.app';
export const ANDROID_PACKAGE = 'com.orbithub.app';

/** Canonical web origin, used for links, AASA and Asset Links. */
export const WEB_ORIGIN = 'https://app.orbithub.com';

export const API_PREFIX = '/api/v1';
export const SUPPORT_EMAIL = 'support@orbithub.com';

export const SUPPORTED_LOCALES = ['es', 'en'] as const;
export const DEFAULT_LOCALE = 'es' as const;

export const REQUEST_TIMEOUT_MS = 15_000;

/** Local persistence + sync tuning shared by every platform. */
export const SYNC_DEFAULTS = {
  /** How often the app tries to flush the outbox while online. */
  intervalMs: 30_000,
  /** Operations sent per push request. */
  batchSize: 50,
  /** Entities fetched per pull request. */
  pullPageSize: 200,
  /** Give up retrying an operation after this many attempts. */
  maxAttempts: 8,
  /** Proactively refresh the access token this long before it expires. */
  refreshSkewSeconds: 60,
} as const;

export const PUSH_DEFAULTS = {
  /** Batched reminder digest, 09:00 local time. */
  digestHour: 9,
  maxPerDay: 20,
} as const;

/**
 * Feature flags let us ship a partially built screen behind a flag instead of
 * hiding unfinished code in the UI.
 */
export const FEATURES = {
  googleSignIn: false,
  calendar: false,
  planner: false,
  voiceInput: false,
  comments: false,
  dataExport: false,
  pushNotifications: false,
  webPush: false,
  realtime: false,
} as const satisfies Record<string, boolean>;

export type FeatureName = keyof typeof FEATURES;

export function isFeatureEnabled(feature: FeatureName): boolean {
  return FEATURES[feature];
}
