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
