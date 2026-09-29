import { relations, sql } from 'drizzle-orm';
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
import type {
  ItemIconColorName,
  ListKindName,
  ListOrderModeName,
  WorkspaceColorName,
  WorkspaceWashName,
  MembershipRoleName,
  SyncEntityName,
} from './constants';

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
    // A key out of the eight the app offers and not a hex value: the person picks
    // from the eight and the app draws them, so there is no colour nobody can
    // read on a card.
    color: varchar('color', { length: 16 }).$type<WorkspaceColorName>().notNull().default('slate'),
    // Which of the two ways that colour is painted. Separate from the colour
    // because it is a second decision the person made, and folding it into the
    // colour would mean a colour key that means a colour *and* a style.
    wash: varchar('wash', { length: 16 }).$type<WorkspaceWashName>().notNull().default('diagonal'),
    // The colour the wash ends in, chosen like the first one. Null until it has
    // been, and the app falls back to the darker version of `color` meanwhile.
    colorTo: varchar('color_to', { length: 16 }).$type<WorkspaceColorName>(),
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

/**
 * An invitation to join a space.
 *
 * Not a syncable entity and deliberately so: an invitation is an act between two
 * people, not content the person is editing offline. It cannot be created from a
 * phone on a train that later mails itself, and it cannot be queued and applied
 * on a device that no longer belongs to anybody. So it lives in its own table
 * with its own endpoints, and the contract says so next to it.
 *
 * The token is what the link carries. It is random, it is not the id, and the
 * row is thrown away with a tombstone when it is used or revoked, so a link that
 * leaked a year ago answers "this link is no longer valid" instead of handing
 * over a space.
 */
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Who sent it. A tombstone too, so a deleted sender does not hide it. */
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** editor or viewer. There is one owner per workspace and it is not given away here. */
    role: varchar('role', { length: 16 }).$type<'editor' | 'viewer'>().notNull(),
    /** The link, and never the id: the id travels in every API answer. */
    token: varchar('token', { length: 64 }).notNull(),
    /** Who it was addressed to. Null means anybody with the link. */
    invitedEmail: varchar('invited_email', { length: 254 }),
    status: varchar('status', { length: 16 })
      .$type<'pending' | 'accepted' | 'declined' | 'revoked'>()
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_invitations_token_unique').on(table.token),
    index('workspace_invitations_workspace_status_idx').on(table.workspaceId, table.status),
    index('workspace_invitations_email_idx').on(table.invitedEmail),
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
    /*
      How many screens the panel has, and **not** derived from the cards.
      Derived it was: the count was the highest screen a card sat on, plus one,
      so a screen nobody had put anything on yet did not exist. A button that adds
      a screen therefore added a screen that vanished on the next save, which is
      worse than not having the button: you press it, it does something, and then
      it did not.
    */
    pages: integer('pages').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('dashboard_layouts_user_unique').on(table.userId)],
);

/**
 * The widget grid as it sits in the database.
 *
 * A *structural* copy of the contract's `DashboardWidget` and not the imported
 * type, and the reason is that this column is written by whatever arrives over the
 * sync endpoint. `page` is therefore optional here and required by the contract:
 * a layout written before the panel had screens has no `page` on it, and the
 * column has to be able to hold one of those without the type saying otherwise.
 * The contract's default is what turns it into a page on the way out.
 */
export interface DashboardWidget {
  id: string;
  kind: 'recent_lists' | 'recent_notes' | 'tasks' | 'quick_actions' | 'calendar' | 'stats';
  /** Grid coordinates, normalised to a 12 column grid. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which screen of the panel. Absent on layouts written before there were any. */
  page?: number;
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
  invitations: many(workspaceInvitations),
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
    // 24, not 16: 'movies_and_series' is 17 characters and postgres would
    // refuse to store it rather than warn.
    kind: varchar('kind', { length: 24 }).$type<ListKindName>().notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    emoji: varchar('emoji', { length: 16 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
    // How the items are read. It never renumbers anything: the manual order is
    // kept, so choosing an order to look at is not a way of losing it.
    orderMode: varchar('order_mode', { length: 24 })
      .$type<ListOrderModeName>()
      .notNull()
      .default('manual'),
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
    priority: varchar('priority', { length: 8 })
      .$type<'none' | 'low' | 'medium' | 'high'>()
      .notNull()
      .default('none'),
    // A key out of the icons the app offers, never an emoji: the same shape on
    // every device and something the app can draw with the same care.
    icon: varchar('icon', { length: 32 }),
    // Filled or outline, and which of the app's colours. Both with a default, so
    // a row written before them keeps drawing and does not need its data
    // migrated: what it had was always an outline in the neutral colour.
    iconStyle: varchar('icon_style', { length: 8 })
      .$type<'outline' | 'fill'>()
      .notNull()
      .default('outline'),
    iconColor: varchar('icon_color', { length: 16 })
      .$type<ItemIconColorName>()
      .notNull()
      .default('neutral'),
    // Free labels, so two shops are values and not two folders.
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    externalId: varchar('external_id', { length: 120 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    // A short remark on the row, not a note. Renamed from `notes` so the column
    // name stops implying a note is a column. See adr/0008-note-entity.md.
    annotation: varchar('annotation', { length: 2000 }),
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

/**
 * A note is a document, and a note is an entity.
 *
 * It used to be argued that a note was the `notes` column of a list item, which
 * would have made this table unnecessary. That was a decision about sharing
 * written as a claim about the data model, and Phase 4 makes it false: the
 * editor writes HTML, a document does not fit in a `varchar(2000)`, and the
 * legacy app had a `notes` table too. See `adr/0008-note-entity.md`.
 */
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Where it is filed, or null for a note that lives only in its space. */
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    /**
     * The HTML the editor produces, and the format is the tag set the editor
     * accepts. Validated in the contract before it gets here, because the
     * editor does not sanitise HTML on iOS or Android and this column is what
     * it later reads. See `packages/contracts/src/note-document.ts`.
     *
     * `text` and not `varchar`: a document is not a length we can pick, and
     * truncating one is the one failure this column must not have.
     */
    document: text('document').notNull().default(''),
    /** Denormalised from the document for search, so search is an index hit. */
    plainText: text('plain_text').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    /**
     * Where this note sits among the things in its folder, when somebody has
     * put them in an order by hand.
     *
     * A column and not something derived from the date, for the same reason the
     * folders and the lists have one: a folder browser that shows the notes, the
     * lists and the folders together has to be able to say which order those
     * three are in, and a date cannot be dragged.
     *
     * Default zero, and the browser treats every note with zero as "not placed",
     * so a note written before this column existed lands at the end instead of at
     * the top of somebody's hand-made order.
     */
    position: integer('position').notNull().default(0),
    /**
     * How many files hang off this note. Counted, not derived, so a list of
     * notes does not become a query per note; the writer keeps it true.
     */
    attachmentCount: integer('attachment_count').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('notes_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('notes_folder_idx').on(table.folderId),
    index('notes_deleted_at_idx').on(table.deletedAt),
    // Written by hand below: a GIN index over the tags array and a trigram index
    // over the plain text, which is what a search for a word inside a note needs
    // and what a btree on a column of sentences cannot answer.
  ],
);

export const notesRelations = relations(notes, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [notes.workspaceId], references: [workspaces.id] }),
  folder: one(folders, { fields: [notes.folderId], references: [folders.id] }),
  attachments: many(attachments),
}));

/**
 * A file hung off a note.
 *
 * `storageKey` is a key and not a URL on purpose: a URL in a document is
 * something that can be pasted somewhere else, and access has to be decided per
 * note or it is decided by whoever holds the link.
 *
 * Not a sync entity yet. Uploads are queued separately from note writes so a
 * failed upload never blocks a text edit, and that queue is its own piece of
 * work; a device pulls attachments with the note that owns them, not as
 * operations of their own.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: varchar('storage_key', { length: 512 }).notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('attachments_note_idx').on(table.noteId),
    uniqueIndex('attachments_storage_key_unique').on(table.storageKey),
  ],
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  note: one(notes, { fields: [attachments.noteId], references: [notes.id] }),
}));

/**
 * A template is a note you keep for later.
 *
 * `document` is the same column, the same format and the same validation as a
 * note's, on purpose. A template stored as something else would be a second
 * format to keep in step with the editor, and the day somebody added a block the
 * editor could write and the template store could not, every template would
 * quietly stop opening.
 *
 * `workspace_id` is nullable: a public template and a personal one that follows
 * its author are not in a space. `built_in_key` is what makes the catalogue
 * replaceable — an update recognises the template it is replacing instead of
 * adding a second copy — and it is null for everything a person made.
 */
export const noteTemplates = pgTable(
  'note_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 300 }).notNull().default(''),
    icon: varchar('icon', { length: 40 }).notNull().default('document-text-outline'),
    scope: varchar('scope', { length: 16 })
      .$type<'personal' | 'workspace' | 'public'>()
      .notNull()
      .default('workspace'),
    document: text('document').notNull().default(''),
    plainText: text('plain_text').notNull().default(''),
    builtInKey: varchar('built_in_key', { length: 60 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('note_templates_workspace_idx').on(table.workspaceId),
    index('note_templates_scope_idx').on(table.scope),
    index('note_templates_deleted_at_idx').on(table.deletedAt),
    // One template per key, not two: an update has to replace the built-in rather
    // than sit next to it, and a duplicate would mean the picker shows the same
    // recipe twice and nobody can tell which one is current.
    uniqueIndex('note_templates_built_in_key_unique')
      .on(table.builtInKey)
      .where(sql`${table.builtInKey} is not null`),
  ],
);

export const noteTemplatesRelations = relations(noteTemplates, ({ one }) => ({
  workspace: one(workspaces, { fields: [noteTemplates.workspaceId], references: [workspaces.id] }),
  author: one(users, { fields: [noteTemplates.createdBy], references: [users.id] }),
}));

export type NoteRow = typeof notes.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type NoteTemplateRow = typeof noteTemplates.$inferSelect;

/**
 * A grant: this person, this node, this role.
 *
 * Not a membership. A membership says "this is one of my spaces"; a grant says
 * "this person is letting me see this thing inside a space that is not mine". The
 * two are kept apart because they answer different questions and fail
 * differently: leaving a space is one button, and being un-shared a list has to
 * disappear from a folder somebody else filed it in.
 *
 * `nodeType` and `nodeId` rather than a `workspace_id`, because what is shared is
 * a folder, a list, a single item, a note or a template, and all of them live in
 * somebody else's space.
 *
 * It used to say here that a note is the `notes` column of an item and so is not
 * a node of its own. A note is a document and is its own table; the column on a
 * list row is a short remark called `annotation`. See
 * `docs/architecture/adr/0008-note-entity.md`.
 *
 * `revokedAt` and not a delete: the grantee is told it stopped, and a device that
 * was offline when it happened has something to read on its next pull. A row that
 * vanished would be indistinguishable from a share that never existed.
 */
export const shares = pgTable(
  'shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Who shared it. A tombstone too, so a deleted account does not hide it. */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    nodeType: varchar('node_type', { length: 16 })
      .$type<'workspace' | 'folder' | 'list' | 'list_item' | 'note' | 'note_template'>()
      .notNull(),
    nodeId: uuid('node_id').notNull(),
    granteeUserId: uuid('grantee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).$type<'editor' | 'viewer'>().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // One grant per person and node. Two rows would mean two roles and no way to
    // say which one is the real one.
    uniqueIndex('shares_node_grantee_unique').on(table.nodeType, table.nodeId, table.granteeUserId),
    index('shares_grantee_idx').on(table.granteeUserId),
    index('shares_node_idx').on(table.nodeType, table.nodeId),
  ],
);

/**
 * Where a grantee filed what they were given.
 *
 * The shared node stays in the owner's tree — it is the same object, and moving it
 * there would move it for them too. This is the grantee's own reference, with its
 * own place and its own order, inside a space and folder of theirs.
 *
 * No `folder_id` null meaning "the root of my space" is stored as a real null: a
 * list filed in the root of a space is a different thing from a list that is not
 * filed anywhere, and the second is the one still sitting in "shared with me".
 * `placedAt` is what tells them apart.
 */
export const shareMounts = pgTable(
  'share_mounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareId: uuid('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Where it was filed. Both null would be "filed nowhere", which is not filed. */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    /** Null while it is still in "shared with me", waiting to be placed. */
    placedAt: timestamp('placed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('share_mounts_share_user_unique').on(table.shareId, table.userId),
    index('share_mounts_user_idx').on(table.userId),
    index('share_mounts_workspace_idx').on(table.workspaceId),
  ],
);
