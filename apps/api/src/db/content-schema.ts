import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth-schema';
import type { ListKindName, MembershipRoleName, SyncEntityName } from './constants';

/**
 * Workspace: the top level container. Everything the user creates belongs to
 * one, and every shared read is authorised through a membership row.
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }),
    emoji: varchar('emoji', { length: 16 }),
    /** Optimistic concurrency token, compared against the client's baseVersion. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Tombstone. Deletes are never hard, so other devices learn about them. */
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('workspaces_updated_at_idx').on(table.updatedAt),
    index('workspaces_deleted_at_idx').on(table.deletedAt),
  ],
);

/** `(workspace_id, user_id)` is unique: one role per user per workspace. */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).$type<MembershipRoleName>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memberships_workspace_user_unique').on(table.workspaceId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
);

/** Nested folders. `parent_id` is nullable for the root level. */
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 120 }).notNull(),
    emoji: varchar('emoji', { length: 16 }),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('folders_workspace_parent_idx').on(table.workspaceId, table.parentId),
    index('folders_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('folders_deleted_at_idx').on(table.deletedAt),
  ],
);

/**
 * Dashboard layout, one row per user. Stored as the widget grid the legacy app
 * had (pinned, ordered, sized) so the redesign keeps the data.
 *
 * It has its own `id` so every syncable table shares the same key shape; the
 * user is the owner and the unique index enforces one row per user.
 */
export const dashboardLayouts = pgTable(
  'dashboard_layouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    layout: jsonb('layout').$type<DashboardWidget[]>().notNull().default([]),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('dashboard_layouts_user_unique').on(table.userId)],
);

export interface DashboardWidget {
  id: string;
  kind: 'recent_lists' | 'recent_notes' | 'tasks' | 'quick_actions' | 'calendar' | 'stats';
  /** Grid coordinates, normalised to a 12 column grid. */
  x: number;
  y: number;
  w: number;
  h: number;
  pinned: boolean;
  settings?: Record<string, unknown>;
}

/**
 * Idempotency ledger for the sync endpoint. A replayed operation returns the
 * stored result instead of applying the change twice.
 */
export const syncOperations = pgTable(
  'sync_operations',
  {
    operationId: uuid('operation_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entity: varchar('entity', { length: 32 }).$type<SyncEntityName>().notNull(),
    entityId: uuid('entity_id').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    resultVersion: integer('result_version'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('sync_operations_user_created_idx').on(table.userId, table.createdAt),
    index('sync_operations_entity_idx').on(table.entity, table.entityId),
  ],
);

/**
 * Unresolved conflicts. Simple field level merges are resolved inline; anything
 * ambiguous waits here for the user to decide.
 */
export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entity: varchar('entity', { length: 32 }).$type<SyncEntityName>().notNull(),
    entityId: uuid('entity_id').notNull(),
    workspaceId: uuid('workspace_id'),
    baseVersion: integer('base_version').notNull(),
    serverVersion: integer('server_version').notNull(),
    serverRecord: jsonb('server_record').$type<Record<string, unknown>>().notNull(),
    clientRecord: jsonb('client_record').$type<Record<string, unknown>>().notNull(),
    conflictingFields: jsonb('conflicting_fields').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('sync_conflicts_user_status_idx').on(table.userId, table.status),
    index('sync_conflicts_entity_idx').on(table.entity, table.entityId),
  ],
);

/** One row per device: the position of its pull cursor. */
export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').notNull(),
    cursor: text('cursor'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sync_cursors_user_device_unique').on(table.userId, table.deviceId),
  ],
);

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(memberships),
  folders: many(folders),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  workspace: one(workspaces, { fields: [memberships.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const foldersRelations = relations(folders, ({ one }) => ({
  workspace: one(workspaces, { fields: [folders.workspaceId], references: [workspaces.id] }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: 'folder_tree',
  }),
}));

/**
 * Lists. One shape covers the three kinds: tasks, movies and books, so
 * filtering, search and sync stay identical across them.
 */
export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id'),
    kind: varchar('kind', { length: 16 }).$type<ListKindName>().notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    emoji: varchar('emoji', { length: 16 }),
    favorite: boolean('favorite').notNull().default(false),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('lists_workspace_kind_idx').on(table.workspaceId, table.kind),
    index('lists_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('lists_folder_idx').on(table.folderId),
    index('lists_deleted_at_idx').on(table.deletedAt),
  ],
);

/**
 * Items. `external_id` and `metadata` keep the provider record (TheMovieDB,
 * Google Books) so a list renders offline without calling the provider again.
 */
export const listItems = pgTable(
  'list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    position: integer('position').notNull().default(0),
    completed: boolean('completed').notNull().default(false),
    favorite: boolean('favorite').notNull().default(false),
    priority: varchar('priority', { length: 8 })
      .$type<'none' | 'low' | 'medium' | 'high'>()
      .notNull()
      .default('none'),
    externalId: varchar('external_id', { length: 120 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    notes: varchar('notes', { length: 2000 }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('list_items_list_position_idx').on(table.listId, table.position),
    index('list_items_list_updated_at_idx').on(table.listId, table.updatedAt),
    index('list_items_deleted_at_idx').on(table.deletedAt),
  ],
);

export const listsRelations = relations(lists, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [lists.workspaceId], references: [workspaces.id] }),
  items: many(listItems),
}));

export const listItemsRelations = relations(listItems, ({ one }) => ({
  list: one(lists, { fields: [listItems.listId], references: [lists.id] }),
}));

export type ListRow = typeof lists.$inferSelect;
export type ListItemRow = typeof listItems.$inferSelect;
