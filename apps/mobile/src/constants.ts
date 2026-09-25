export const STORAGE_KEYS = {
  appearance: 'orbithub:appearance',
  locale: 'orbithub:locale',
  sessionMeta: 'orbithub:session-meta',
  refreshToken: 'orbithub:refresh-token',
  clientId: 'orbithub:client-id',
  lastSyncedAt: 'orbithub:last-synced-at',
} as const;

/** Columns of the local outbox table, kept in sync with lib/offline/local-store. */
export const OUTBOX_MAX_BATCH = 50;
