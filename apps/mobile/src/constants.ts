export const STORAGE_KEYS = {
  appearance: 'orbithub:appearance',
  locale: 'orbithub:locale',
  sessionMeta: 'orbithub:session-meta',
  refreshToken: 'orbithub:refresh-token',
  clientId: 'orbithub:client-id',
  lastSyncedAt: 'orbithub:last-synced-at',
  /**
   * Hasta donde ha llegado el pull en este navegador.
   *
   * Vive aqui y no en `sync-service` porque hay dos sitios que tienen que nombrarla:
   * el que la escribe en cada sincronizacion y el que la borra al cerrar sesion. Una
   * clave que solo el primero conoce no se puede tirar al cerrar sesion, que es
   * exactamente el fallo que la dejaba puesta: el servidor devuelve lo posterior al
   * cursor, asi que el siguiente login empieza a descargar donde acabo el anterior
   * y nunca recibe lo escrito antes de ahi.
   */
  syncCursor: 'sync:cursor',
} as const;

/** Columns of the local outbox table, kept in sync with lib/offline/local-store. */
export const OUTBOX_MAX_BATCH = 50;
