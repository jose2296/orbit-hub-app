/**
 * Domain constants shared between the schema and the services.
 *
 * They live in their own module so `schema.ts` stays a pure description of the
 * database and never imports application code.
 */

export const AUTH_PROVIDERS = ['email', 'google'] as const;
export type AuthProviderName = (typeof AUTH_PROVIDERS)[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web', 'unknown'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const EMAIL_TOKEN_TYPES = ['verify_email', 'reset_password'] as const;
export type EmailTokenType = (typeof EMAIL_TOKEN_TYPES)[number];

export const SESSION_REVOKE_REASONS = [
  'logout',
  'rotated',
  'replayed',
  'revoked',
  'password_changed',
  'account_deleted',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/** Workspaces, folders and the dashboard, plus what the sync engine moves. */
export const MEMBERSHIP_ROLES = ['owner', 'editor', 'viewer'] as const;
export type MembershipRoleName = (typeof MEMBERSHIP_ROLES)[number];

/** Numeric rank used for authorisation comparisons. Higher wins. */
export const MEMBERSHIP_ROLE_RANK: Record<MembershipRoleName, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export const SYNC_ENTITIES = [
  'workspace',
  'folder',
  'list',
  'list_item',
  'note',
  'dashboard',
  'collection',
  'bookmark',
  'journal_entry',
] as const;
export type SyncEntityName = (typeof SYNC_ENTITIES)[number];

export const SYNC_OPERATION_KINDS = ['create', 'update', 'delete'] as const;
export type SyncOperationKindName = (typeof SYNC_OPERATION_KINDS)[number];

/**
 * Fields the client may write, per entity. Anything else is ignored.
 *
 * The kinds match the contract exactly: a list is one of these for good, and
 * never two at once. `board` is one of them and not a flag on top of `tasks`,
 * because the difference between them is what a task carries — a state or a
 * checkbox — and a list that is both is a list whose rows nobody can draw.
 */
export const LIST_KINDS = [
  'tasks',
  'movies',
  'series',
  'movies_and_series',
  'books',
  'board',
] as const;
export type ListKindName = (typeof LIST_KINDS)[number];

/**
 * Los estados de la extraccion de un bookmark. Escribi los cuatro valores en
 * `packages/contracts/src/bookmarks.ts` tambien: ahi vive el `z.enum` que
 * valida la red, y aca el tipo que usa la columna. Es el mismo duplicado que
 * `LIST_KINDS` y `listKindSchema`.
 */
export const BOOKMARK_EXTRACTION_STATES = [
  'pending',
  'ready',
  'metadata_only',
  'failed',
] as const;
export type BookmarkExtractionStateName = (typeof BOOKMARK_EXTRACTION_STATES)[number];

/**
 * The colours a space can be painted with.
 *
 * Re-exported from the contract and not a second list: the server refuses a
 * colour it does not know, the app cannot draw one that is not here, and two
 * lists are two lists that are a step behind each other.
 */
export { ITEM_ICON_COLORS, WORKSPACE_COLORS, WORKSPACE_WASHES } from '@orbit-hub/contracts';
export type { WorkspaceColor as WorkspaceColorName } from '@orbit-hub/contracts';
export type { WorkspaceWash as WorkspaceWashName } from '@orbit-hub/contracts';

/**
 * The ways a list can be read. `manual` is the order the items are in and the
 * only one where a row can be dragged.
 *
 * Derived from the contract rather than written out again. This used to be a
 * second copy of the enum with two modes missing, and the sanitiser falls back
 * to `manual` for anything it does not know — so choosing "by release date"
 * painted, synced as `applied`, and came back as `manual` on the next pull, on
 * every device, with no error anywhere. `sync-limits.test.ts` checks the two
 * lists are the same list.
 */
import { listOrderModeSchema } from '@orbit-hub/contracts';
import type { ListOrderMode } from '@orbit-hub/contracts';

export const LIST_ORDER_MODES = listOrderModeSchema.options;
export type ListOrderModeName = ListOrderMode;

export { listOrderModeSchema } from '@orbit-hub/contracts';
export type { ListOrderMode } from '@orbit-hub/contracts';

export const ITEM_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;
export type ItemPriority = (typeof ITEM_PRIORITIES)[number];

/**
 * Fields the client may write, per entity. Anything else in a payload is
 * dropped: the sync engine must never be talked into writing a column it does
 * not own (version, id, workspaceId, timestamps).
 */
export const SYNC_WRITABLE_FIELDS: Record<SyncEntityName, readonly string[]> = {
  // `wash` and `colorTo` are on this list and the comment is here because they
  // were not, once. A field added to the table and to the contract but not to
  // this list is dropped **in silence**: the push answers `applied` and bumps the
  // version, so it looks like it worked and nothing changed. That is worse than a
  // rejection, because a rejection at least tells the person their choice did not
  // save, and this one looked like it saved for four whole rebuilds.
  workspace: ['name', 'description', 'icon', 'color', 'colorTo', 'wash'],
  folder: ['parentId', 'name', 'icon', 'position'],
  // `states` and `stateId` below are the board's two, and being on this list is
  // **half** of writing them: a key allowed here still needs its branch in
  // `sanitisePayload`, and the test that catches the missing half pushes a board
  // and reads its states back (`lists.test.ts`).
  list: [
    'folderId',
    'title',
    'description',
    'icon',
    'tags',
    'tagColors',
    'position',
    'kind',
    'orderMode',
    'states',
  ],
  list_item: [
    'title',
    'position',
    'completed',
    'priority',
    'icon',
    'tags',
    'externalId',
    'metadata',
    'annotation',
    'stateId',
  ],
  /**
   * `document` is on this list and the client is expected to send it, but the
   * server does not trust it: it re-derives `plainText` from the document it
   * just validated, so a client cannot write a body and a search string that
   * disagree. `plainText` and `attachmentCount` are absent on purpose.
   */
  note: ['title', 'document', 'folderId', 'tags', 'position', 'icon'],
  dashboard: ['layout', 'pages'],
  // The day is set once, by the create, and never moves: its id is derived from it.
  journal_entry: ['document'],
  /**
   * Una coleccion es una carpeta con nombre: lo que la persona elige es donde va
   * y como se llama, y nada mas.
   */
  collection: ['folderId', 'name', 'description', 'emoji', 'position'],
  /**
   * De un bookmark el cliente elige el enlace, el titulo, donde queda y como se
   * ordena. Lo que **no** aparece aqui es el corazon de la decision, y son siete
   * campos: `document`, `plainText`, `extractionState`, `extractionError`,
   * `description`, `imageUrl` y `siteName` son del servidor. Un cliente que
   * escribiera el documento podria hacer que la busqueda (que corre sobre
   * `plainText`) dijera una cosa y la lectura otra, que es exactamente el
   * problema que `note` ya resuelve re-derivando `plainText`.
   *
   * `workspaceId` tampoco esta, y por el mismo motivo que en `note`: el servidor
   * es dueno de ese campo, porque un cliente que pudiera mover un bookmark entre
   * espacios lo archivaria donde el dueno nunca lo puso.
   */
  /*
    `workspaceId`, y por que no estaba.

    "Igual que una nota" era la razon que daba `assign-sheet.tsx` para no ofrecer
    mover un bookmark de espacio: una nota no se mueve, asi que un bookmark
    tampoco. Pero la nota no se mueve porque **tampoco esta en esta lista** — la
    razon real era que el campo no se podia escribir, no que no se debiera.

    Y un bookmark sin clasificar si necesita moverse: el pedido era literal,
    "deberia poder moverlo luego a otro sitio si esta sin clasificar". Un bookmark
    siempre esta en un espacio —`bookmarkSchema.workspaceId` no es nullable—, asi
    que esto cambia **cual**, no si tiene.

    Lo demas del camino ya aceptaba cualquier columna: `updateEntity`
    (`sync-repository.ts:207`) hace spread de `values` al UPDATE, y
    `sanitisePayload` solo filtra por esta lista. Faltaba la entrada.
  */
  bookmark: ['url', 'title', 'workspaceId', 'collectionId', 'folderId', 'tags', 'position'],
};

export const AUDIT_EVENTS = [
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.logout_all',
  'auth.refresh',
  'auth.refresh_replay_detected',
  'auth.verify_email',
  'auth.verify_email_resent',
  'auth.email_delivery_failed',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.password_changed',
  'auth.google_linked',
  'auth.session_revoked',
  'account.deleted',
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

/** Token lifetimes. Access tokens are deliberately short lived. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const EMAIL_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;
