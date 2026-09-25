import { z } from 'zod';
import { emailSchema, isoDateTimeSchema, uuidSchema } from './common';
import { syncableEntitySchema } from './api';
import { userSchema } from './auth';

export const membershipRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

/** Numeric rank used by the API for permission comparisons. */
export const membershipRoleRank: Record<MembershipRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export const membershipSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  user: userSchema.pick({ id: true, email: true, displayName: true, avatarUrl: true }),
  role: membershipRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

export const workspaceSchema = syncableEntitySchema.extend({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).nullable().default(null),
  emoji: z.string().max(16).nullable().default(null),
  role: membershipRoleSchema,
  memberCount: z.int().min(1),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const folderSchema = syncableEntitySchema.extend({
  workspaceId: uuidSchema,
  parentId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  emoji: z.string().max(16).nullable().default(null),
  position: z.number().int().min(0),
});
export type Folder = z.infer<typeof folderSchema>;

export const listKindSchema = z.enum(['tasks', 'movies', 'books']);
export type ListKind = z.infer<typeof listKindSchema>;

export const listSchema = syncableEntitySchema.extend({
  workspaceId: uuidSchema,
  folderId: uuidSchema.nullable().default(null),
  kind: listKindSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable().default(null),
  emoji: z.string().max(16).nullable().default(null),
  favorite: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  position: z.number().int().min(0),
  itemCount: z.int().min(0).default(0),
});
export type List = z.infer<typeof listSchema>;

/**
 * One row covers the three list kinds. `externalId` points at the provider
 * record (TMDB / Google Books) and `metadata` keeps the raw provider payload
 * so the app can render offline without calling the provider again.
 */
export const listItemSchema = syncableEntitySchema.extend({
  listId: uuidSchema,
  title: z.string().trim().min(1).max(300),
  position: z.number().int().min(0),
  completed: z.boolean().default(false),
  favorite: z.boolean().default(false),
  priority: z.enum(['none', 'low', 'medium', 'high']).default('none'),
  externalId: z.string().max(120).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});
export type ListItem = z.infer<typeof listItemSchema>;

/**
 * Notes store a portable document (BlockNote/ProseMirror compatible JSON) so the
 * native editor and the web editor can both read and write the same payload.
 */
export const noteDocumentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.unknown()),
});

export const noteSchema = syncableEntitySchema.extend({
  workspaceId: uuidSchema,
  folderId: uuidSchema.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  document: noteDocumentSchema,
  plainText: z.string().default(''),
  favorite: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  attachmentCount: z.int().min(0).default(0),
});
export type Note = z.infer<typeof noteSchema>;

export const attachmentSchema = z.object({
  id: uuidSchema,
  noteId: uuidSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  /** Object storage key, never a public URL, so access stays authorisable. */
  storageKey: z.string().min(1),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  createdAt: isoDateTimeSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const invitationStatusSchema = z.enum(['pending', 'accepted', 'declined', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const invitationSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  role: membershipRoleSchema.exclude(['owner']),
  token: z.string().min(10),
  status: invitationStatusSchema,
  invitedBy: userSchema.pick({ id: true, displayName: true }),
  invitedEmail: emailSchema.nullable().default(null),
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  acceptedAt: isoDateTimeSchema.nullable().default(null),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  emoji: z.string().max(16).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const createFolderRequestSchema = z.object({
  workspaceId: uuidSchema,
  parentId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  emoji: z.string().max(16).optional(),
  position: z.number().int().min(0).default(0),
});
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>;

export const createListRequestSchema = z.object({
  workspaceId: uuidSchema,
  folderId: uuidSchema.nullable().default(null),
  kind: listKindSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  emoji: z.string().max(16).optional(),
  position: z.number().int().min(0).default(0),
});
export type CreateListRequest = z.infer<typeof createListRequestSchema>;

export const createInvitationRequestSchema = z.object({
  workspaceId: uuidSchema,
  role: membershipRoleSchema.exclude(['owner']),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

/* ---------------------------------------------------------------- reads ---- */

/**
 * Reads are REST, writes go through `/sync/push`.
 *
 * A single read path keeps the client simple: every screen loads from the local
 * cache, and the cache is filled either by a pull or by a first load. There is
 * no second write path that could disagree with the sync protocol.
 */

export const listWorkspacesResponseSchema = z.object({
  items: z.array(workspaceSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListWorkspacesResponse = z.infer<typeof listWorkspacesResponseSchema>;

export const listFoldersResponseSchema = z.object({
  items: z.array(folderSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListFoldersResponse = z.infer<typeof listFoldersResponseSchema>;

export const workspaceMemberSchema = z.object({
  user: userSchema.pick({ id: true, email: true, displayName: true, avatarUrl: true }),
  role: membershipRoleSchema,
  joinedAt: isoDateTimeSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const listWorkspaceMembersResponseSchema = z.object({
  items: z.array(workspaceMemberSchema),
});
export type ListWorkspaceMembersResponse = z.infer<typeof listWorkspaceMembersResponseSchema>;

/** Dashboard widget grid. Mirrors the JSON stored in `dashboard_layouts`. */
export const dashboardWidgetSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['recent_lists', 'recent_notes', 'tasks', 'quick_actions', 'calendar', 'stats']),
  x: z.number().int().min(0).max(23),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
  pinned: z.boolean().default(false),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;

export const dashboardLayoutSchema = z.object({
  userId: uuidSchema,
  layout: z.array(dashboardWidgetSchema).max(24),
  version: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
});
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

/* ---------------------------------------------------------------- lists ---- */

/** Search across everything the caller can see. One endpoint, one query. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  workspaceId: uuidSchema.optional(),
  kind: listKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultSchema = z.object({
  /** What the hit belongs to, so the app can route to the right screen. */
  scope: z.enum(['workspace', 'folder', 'list', 'list_item']),
  id: uuidSchema,
  workspaceId: uuidSchema.nullable().default(null),
  listId: uuidSchema.nullable().default(null),
  kind: listKindSchema.nullable().default(null),
  title: z.string(),
  subtitle: z.string().nullable().default(null),
  updatedAt: isoDateTimeSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  items: z.array(searchResultSchema),
  nextCursor: z.string().nullable().default(null),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const listListsQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  folderId: uuidSchema.optional(),
  kind: listKindSchema.optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListListsQuery = z.infer<typeof listListsQuerySchema>;

export const listListsResponseSchema = z.object({
  items: z.array(listSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListListsResponse = z.infer<typeof listListsResponseSchema>;

export const listItemsQuerySchema = z.object({
  completed: z
    .enum(['true', 'false', 'any'])
    .default('any')
    .transform((value) => (value === 'any' ? undefined : value === 'true')),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).optional(),
});
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;

export const listItemsResponseSchema = z.object({
  items: z.array(listItemSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListItemsResponse = z.infer<typeof listItemsResponseSchema>;
