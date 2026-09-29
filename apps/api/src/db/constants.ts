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
] as const;
export type SyncEntityName = (typeof SYNC_ENTITIES)[number];

export const SYNC_OPERATION_KINDS = ['create', 'update', 'delete'] as const;
export type SyncOperationKindName = (typeof SYNC_OPERATION_KINDS)[number];

/**
 * Fields the client may write, per entity. Anything else is ignored.
 *
 * The kinds match the contract exactly: a list is one of these for good, and
 * never two at once.
 */
export const LIST_KINDS = [
  'tasks',
  'movies',
  'series',
  'movies_and_series',
  'books',
] as const;
export type ListKindName = (typeof LIST_KINDS)[number];

/**
 * The colours a space can be painted with.
 *
 * Re-exported from the contract and not a second list: the server refuses a
 * colour it does not know, the app cannot draw one that is not here, and two
 * lists are two lists that are a step behind each other.
 */
export { ITEM_ICON_COLORS, WORKSPACE_COLORS, WORKSPACE_WASHES, isItemIcon } from '@orbit-hub/contracts';
export type { ItemIconColor as ItemIconColorName } from '@orbit-hub/contracts';
export type { WorkspaceColor as WorkspaceColorName } from '@orbit-hub/contracts';
export type { WorkspaceWash as WorkspaceWashName } from '@orbit-hub/contracts';

/**
 * The ways a list can be read. `manual` is the order the items are in and the
 * only one where a row can be dragged.
 */
export const LIST_ORDER_MODES = [
  'manual',
  'alphabetical',
  'alphabetical_desc',
  'created_desc',
  'created_asc',
  'updated_desc',
  'priority',
] as const;
export type ListOrderModeName = (typeof LIST_ORDER_MODES)[number];

export { ITEM_ICONS } from '@orbit-hub/contracts';
export type { ItemIcon } from '@orbit-hub/contracts';

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
  workspace: ['name', 'description', 'emoji', 'color', 'colorTo', 'wash'],
  folder: ['parentId', 'name', 'emoji', 'position'],
  list: [
    'folderId',
    'title',
    'description',
    'emoji',
    'favorite',
    'tags',
    'position',
    'kind',
    'orderMode',
  ],
  list_item: [
    'title',
    'position',
    'completed',
    'favorite',
    'priority',
    'icon',
    'iconStyle',
    'iconColor',
    'tags',
    'externalId',
    'metadata',
    'annotation',
  ],
  /**
   * `document` is on this list and the client is expected to send it, but the
   * server does not trust it: it re-derives `plainText` from the document it
   * just validated, so a client cannot write a body and a search string that
   * disagree. `plainText` and `attachmentCount` are absent on purpose.
   */
  note: ['title', 'document', 'folderId', 'favorite', 'tags'],
  dashboard: ['layout', 'pages'],
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
