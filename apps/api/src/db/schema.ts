import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { AuthProviderName, DevicePlatform, SessionRevokeReason } from './constants';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
};

/**
 * Identity.
 *
 * Emails are stored already normalised (trimmed + lowercased) by the
 * application, so a plain unique constraint is enough and no citext extension is
 * required.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    avatarUrl: text('avatar_url'),
    emailVerified: boolean('email_verified').notNull().default(false),
    locale: varchar('locale', { length: 5 }).notNull().default('es'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    index('users_status_idx').on(table.status),
    index('users_deleted_at_idx').on(table.deletedAt),
  ],
);

/**
 * One row per login method. A user may hold an `email` identity and a `google`
 * identity; linking rules live in the auth service, not here.
 */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 16 }).$type<AuthProviderName>().notNull(),
    /** `sub` for Google, the normalised email for the email provider. */
    providerSubject: varchar('provider_subject', { length: 320 }).notNull(),
    email: varchar('email', { length: 254 }),
    emailVerified: boolean('email_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    linkedAt: timestamp('linked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('auth_identities_provider_subject_unique').on(table.provider, table.providerSubject),
    uniqueIndex('auth_identities_user_provider_unique').on(table.userId, table.provider),
    index('auth_identities_user_idx').on(table.userId),
  ],
);

/**
 * One row per signed-in device. The refresh token is stored hashed; rotating it
 * rewrites `token_hash` and keeps the family id, so a replayed token can be
 * traced back to the whole family.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenFamilyId: uuid('token_family_id').notNull().defaultRandom(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    deviceLabel: varchar('device_label', { length: 80 }).notNull(),
    platform: varchar('platform', { length: 16 }).$type<DevicePlatform>().notNull().default('unknown'),
    userAgent: varchar('user_agent', { length: 400 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: varchar('revoked_reason', { length: 32 }).$type<SessionRevokeReason>(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_family_idx').on(table.tokenFamilyId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/** Single-use tokens for email verification and password reset, hashed at rest. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).$type<'verify_email' | 'reset_password'>().notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('email_tokens_hash_unique').on(table.tokenHash),
    index('email_tokens_user_type_idx').on(table.userId, table.type),
  ],
);

/** Append-only security trail. Never updated, never deleted on user deletion. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    event: varchar('event', { length: 48 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_user_created_idx').on(table.userId, table.createdAt),
    index('audit_logs_event_created_idx').on(table.event, table.createdAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  identities: many(authIdentities),
  sessions: many(sessions),
}));

export const authIdentitiesRelations = relations(authIdentities, ({ one }) => ({
  user: one(users, { fields: [authIdentities.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const emailTokensRelations = relations(emailTokens, ({ one }) => ({
  user: one(users, { fields: [emailTokens.userId], references: [users.id] }),
}));

export const schema = {
  users,
  authIdentities,
  sessions,
  emailTokens,
  auditLogs,
  usersRelations,
  authIdentitiesRelations,
  sessionsRelations,
  emailTokensRelations,
};

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type AuthIdentityRow = typeof authIdentities.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type EmailTokenRow = typeof emailTokens.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

/** `now()` in SQL, so writes from raw statements stay consistent with Drizzle. */
export const nowSql = sql`now()`;
