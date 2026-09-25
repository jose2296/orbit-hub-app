import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const syncEntitySchema = z.enum([
  'workspace',
  'membership',
  'folder',
  'list',
  'list_item',
  'note',
  'attachment',
  'dashboard',
]);
export type SyncEntity = z.infer<typeof syncEntitySchema>;

export const syncOperationKindSchema = z.enum(['create', 'update', 'delete']);
export type SyncOperationKind = z.infer<typeof syncOperationKindSchema>;

/**
 * A single write produced by the client. `operationId` is generated on the
 * device and is the idempotency key: retrying the same operation is safe.
 * `baseVersion` is the version the client last saw, so the API can detect
 * concurrent edits instead of silently overwriting them.
 */
export const syncOperationSchema = z.object({
  operationId: uuidSchema,
  clientId: z.string().min(8).max(64),
  kind: syncOperationKindSchema,
  entity: syncEntitySchema,
  entityId: uuidSchema,
  baseVersion: z.number().int().min(0),
  payload: z.record(z.string(), z.unknown()).nullable().default(null),
  /**
   * The values the client believed were stored before this change, for the
   * fields it is touching. With them the server can do a real three way merge
   * and auto apply changes that do not collide. Without them a stale version
   * plus a differing value is treated as a conflict, which is the safe default.
   */
  base: z.record(z.string(), z.unknown()).nullable().default(null),
  clientTimestamp: isoDateTimeSchema,
});
export type SyncOperation = z.infer<typeof syncOperationSchema>;

export const syncPushRequestSchema = z.object({
  deviceId: uuidSchema,
  lastPulledAt: isoDateTimeSchema.nullable().default(null),
  operations: z.array(syncOperationSchema).min(1).max(200),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export const syncOperationResultSchema = z.object({
  operationId: uuidSchema,
  status: z.enum(['applied', 'duplicate', 'rejected', 'conflict']),
  entity: syncEntitySchema,
  entityId: uuidSchema,
  /** Version after the operation was applied. */
  version: z.number().int().min(0).nullable().default(null),
  error: z.string().max(500).nullable().default(null),
});
export type SyncOperationResult = z.infer<typeof syncOperationResultSchema>;

export const syncPushResponseSchema = z.object({
  results: z.array(syncOperationResultSchema),
  serverTime: isoDateTimeSchema,
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

export const syncPullRequestSchema = z.object({
  cursor: z.string().min(1).nullable().default(null),
  limit: z.number().int().min(1).max(500).default(200),
  entities: z.array(syncEntitySchema).optional(),
  /** Stable per device, so each device keeps its own cursor. */
  deviceId: uuidSchema.optional(),
});
export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;

/** A changed (or tombstoned) record. `deletedAt` is set instead of removing the row. */
export const syncChangeSchema = z.object({
  entity: syncEntitySchema,
  record: z.record(z.string(), z.unknown()),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const syncPullResponseSchema = z.object({
  changes: z.array(syncChangeSchema),
  nextCursor: z.string().nullable().default(null),
  hasMore: z.boolean(),
  serverTime: isoDateTimeSchema,
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

export const syncConflictStatusSchema = z.enum(['pending', 'resolved', 'dismissed']);
export type SyncConflictStatus = z.infer<typeof syncConflictStatusSchema>;

/**
 * A conflict is surfaced, never resolved silently. Simple field level merges are
 * attempted server side; anything ambiguous is stored so the user can choose.
 */
export const syncConflictSchema = z.object({
  id: uuidSchema,
  entity: syncEntitySchema,
  entityId: uuidSchema,
  workspaceId: uuidSchema.nullable().default(null),
  baseVersion: z.number().int().min(0),
  serverVersion: z.number().int().min(0),
  serverRecord: z.record(z.string(), z.unknown()),
  clientRecord: z.record(z.string(), z.unknown()),
  conflictingFields: z.array(z.string()).default([]),
  status: syncConflictStatusSchema,
  detectedAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable().default(null),
});
export type SyncConflict = z.infer<typeof syncConflictSchema>;

export const resolveConflictRequestSchema = z.object({
  resolution: z.enum(['keep_server', 'keep_client', 'merge']),
  mergedFields: z.record(z.string(), z.unknown()).optional(),
});
export type ResolveConflictRequest = z.infer<typeof resolveConflictRequestSchema>;

/** Client side sync state, mirrored by the UI (sync centre, banners). */
export const syncStateSchema = z.enum(['idle', 'syncing', 'offline', 'blocked', 'error']);
export type SyncState = z.infer<typeof syncStateSchema>;

export const syncStatusSchema = z.object({
  state: syncStateSchema,
  pendingOperations: z.number().int().min(0),
  pendingConflicts: z.number().int().min(0),
  lastSyncedAt: isoDateTimeSchema.nullable().default(null),
  lastError: z.string().nullable().default(null),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;
