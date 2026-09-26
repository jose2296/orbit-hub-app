import type {
  SyncConflict,
  SyncOperation,
  SyncOperationResult,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushResponse,
} from '@orbit-hub/contracts';
import { syncOperationSchema } from '@orbit-hub/contracts';
import { and, eq } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import { LIST_KINDS, MEMBERSHIP_ROLE_RANK, SYNC_ENTITIES, SYNC_WRITABLE_FIELDS } from '../../db/constants.js';
import type { ListKindName, MembershipRoleName, SyncEntityName } from '../../db/constants.js';
import { HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { syncConflicts } from '../../db/schema.js';

import { syncRepository } from './sync-repository';
import type { StoredEntity } from './sync-repository';

/**
 * The id a result carries when the operation it belongs to has no usable one.
 *
 * The zero uuid is accepted by the contract for exactly this, and inventing a
 * random one would make a rejected operation look like a different operation.
 */
const UNKNOWN_OPERATION_ID = '00000000-0000-0000-0000-000000000000';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/** Reads a uuid out of an unvalidated operation, or reports that there is none. */
function readUuid(raw: unknown, key = 'operationId'): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function readEntity(raw: unknown): SyncEntityName | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)['entity'];
  return typeof value === 'string' && (SYNC_ENTITIES as readonly string[]).includes(value)
    ? (value as SyncEntityName)
    : null;
}

interface AppliedResult {
  status: SyncOperationResult['status'];
  version: number | null;
  error?: string;
}

/**
 * The contract declares every entity the product will ever sync; this build
 * stores a subset. Anything else is rejected instead of being silently ignored.
 */
function assertSupportedEntity(entity: string): SyncEntityName {
  if (!(SYNC_ENTITIES as readonly string[]).includes(entity)) {
    throw HttpError.validation(`The entity "${entity}" is not synced yet`);
  }
  return entity as SyncEntityName;
}

/**
 * Keeps only the fields the sync protocol owns, coerced to the column types.
 * Anything else in the payload is dropped instead of being written.
 */
function sanitisePayload(
  entity: SyncEntityName,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  const allowed = new Set(SYNC_WRITABLE_FIELDS[entity]);
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload ?? {})) {
    if (!allowed.has(key) || value === undefined) continue;

    if (key === 'name' || key === 'description' || key === 'emoji') {
      clean[key] = value === null ? null : String(value).slice(0, key === 'name' ? 120 : 500);
      continue;
    }

    if (key === 'position') {
      clean[key] = Math.max(0, Math.trunc(Number(value) || 0));
      continue;
    }

    if (key === 'parentId') {
      clean[key] = value === null ? null : String(value);
      continue;
    }

    if (key === 'layout') {
      clean[key] = Array.isArray(value) ? value : [];
      continue;
    }

    if (key === 'title') {
      clean[key] = String(value).slice(0, entity === 'list_item' ? 300 : 120);
      continue;
    }

    if (key === 'position') {
      clean[key] = Math.max(0, Math.trunc(Number(value) || 0));
      continue;
    }

    if (key === 'folderId') {
      clean[key] = value === null ? null : String(value);
      continue;
    }

    if (key === 'completed' || key === 'favorite') {
      clean[key] = value === true;
      continue;
    }

    if (key === 'priority') {
      clean[key] = ['none', 'low', 'medium', 'high'].includes(String(value))
        ? String(value)
        : 'none';
      continue;
    }

    if (key === 'tags') {
      clean[key] = Array.isArray(value)
        ? value.map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
        : [];
      continue;
    }

    if (key === 'kind') {
      // The list of kinds lives in one place, and this was a second copy of it
      // with three entries: a list of series was silently turned into a list of
      // tasks, and the person who created it never found out why.
      clean[key] = LIST_KINDS.includes(value as ListKindName) ? value : 'tasks';
      continue;
    }

    if (key === 'notes') {
      clean[key] = value === null ? null : String(value).slice(0, 2000);
      continue;
    }

    if (key === 'externalId') {
      clean[key] = value === null ? null : String(value).slice(0, 120);
      continue;
    }

    if (key === 'metadata') {
      clean[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      continue;
    }
  }

  return clean;
}

/**
 * Three way merge.
 *
 * A field is only a conflict when the server changed it *after* the version the
 * client last saw. The client sends what it believed was stored (`base`), so:
 *
 *   server === base  → the client is the only writer: apply
 *   otherwise        → both sides changed it: conflict
 *
 * Without a base state we cannot tell "the server changed it" from "it was
 * always different", so a stale version plus a differing value is a conflict.
 */
function merge(
  operation: SyncOperation,
  server: StoredEntity,
): { values: Record<string, unknown>; conflictingFields: string[] } {
  const clientValues = sanitisePayload(assertSupportedEntity(operation.entity), operation.payload);
  const baseValues = operation.base ?? null;
  const conflictingFields: string[] = [];

  for (const [key, rawClientValue] of Object.entries(clientValues)) {
    const clientValue = rawClientValue ?? null;
    const serverValue = server[key] ?? null;

    if (baseValues === null) {
      if (JSON.stringify(serverValue) !== JSON.stringify(clientValue)) {
        conflictingFields.push(key);
      }
      continue;
    }

    const baseValue = baseValues[key] ?? null;
    const serverChanged = JSON.stringify(serverValue) !== JSON.stringify(baseValue);
    const clientChanged = JSON.stringify(clientValue) !== JSON.stringify(baseValue);

    if (serverChanged && clientChanged) {
      conflictingFields.push(key);
    }
  }

  return { values: clientValues, conflictingFields };
}

export class SyncService {
  private async assertCanWrite(workspaceId: string | null, userId: string): Promise<void> {
    if (!workspaceId) {
      // Workspaces and dashboards are owned by the user; authorisation is the
      // ownership check below.
      return;
    }

    const role = await syncRepository.roleInWorkspace(workspaceId, userId);
    if (!role) {
      // A resource the user cannot see and one that does not exist look the same.
      throw HttpError.notFound('Workspace not found');
    }

    if (MEMBERSHIP_ROLE_RANK[role as MembershipRoleName] < MEMBERSHIP_ROLE_RANK['editor']) {
      throw HttpError.forbidden('You need edit access to make this change');
    }
  }

  /**
   * Items inherit the workspace of their list. Resolving it here keeps the
   * permission check in one place and hides the list behind the same 404.
   */
  private async workspaceOfListItem(item: StoredEntity, userId: string): Promise<string | null> {
    const listId = item['listId'] as string | null;
    if (!listId) return null;

    const list = await syncRepository.findEntity('list', listId);
    if (!list) {
      throw HttpError.notFound('List not found');
    }
    void userId;
    return (list['workspaceId'] as string | null) ?? null;
  }

  private async apply(operation: SyncOperation, userId: string): Promise<AppliedResult> {
    // Narrowed once: this build stores a subset of the entities in the contract.
    const entity = assertSupportedEntity(operation.entity);
    // The dashboard row is per user and created on first write, so it is
    // handled before the generic "record does not exist" path.
    if (entity === 'dashboard') {
      const layout = sanitisePayload('dashboard', operation.payload)['layout'] ?? [];
      const row = await syncRepository.upsertDashboard(userId, layout);
      return { status: 'applied', version: row.version };
    }

    const existing = await syncRepository.findEntity(entity, operation.entityId);

    if (operation.kind === 'create') {
      if (existing) {
        // The client created something that already exists: the row wins and
        // the duplicate create is absorbed. This is the retry case.
        return { status: 'duplicate', version: existing.version };
      }

      const payload = sanitisePayload(entity, operation.payload);
      const rawWorkspaceId = operation.payload?.['workspaceId'];
      const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId : '';

      switch (entity) {
        case 'workspace': {
          const row = await syncRepository.insertEntity('workspace', {
            id: operation.entityId,
            name: (payload['name'] as string) ?? 'Workspace',
            description: (payload['description'] as string) ?? null,
            emoji: (payload['emoji'] as string) ?? null,
          });
          // The creator owns what they create.
          await syncRepository.addMembership(row.id, userId, 'owner');
          return { status: 'applied', version: row.version };
        }

        case 'folder': {
          if (workspaceId.length === 0) {
            throw HttpError.validation('A folder needs a workspaceId');
          }
          await this.assertCanWrite(workspaceId, userId);

          const row = await syncRepository.insertEntity('folder', {
            id: operation.entityId,
            workspaceId,
            parentId: (payload['parentId'] as string | null) ?? null,
            name: (payload['name'] as string) ?? 'Folder',
            emoji: (payload['emoji'] as string) ?? null,
            position: (payload['position'] as number) ?? 0,
          });
          return { status: 'applied', version: row.version };
        }

        case 'list': {
          if (workspaceId.length === 0) {
            throw HttpError.validation('A list needs a workspaceId');
          }
          await this.assertCanWrite(workspaceId, userId);

          const row = await syncRepository.insertEntity('list', {
            id: operation.entityId,
            workspaceId,
            folderId: (payload['folderId'] as string | null) ?? null,
            kind: (payload['kind'] as string) ?? 'tasks',
            title: (payload['title'] as string) ?? 'List',
            description: (payload['description'] as string) ?? null,
            emoji: (payload['emoji'] as string) ?? null,
            favorite: (payload['favorite'] as boolean) ?? false,
            tags: (payload['tags'] as string[]) ?? [],
            position: (payload['position'] as number) ?? 0,
          });
          return { status: 'applied', version: row.version };
        }

        case 'list_item': {
          const rawListId = operation.payload?.['listId'];
          const listId = typeof rawListId === 'string' ? rawListId : '';
          if (listId.length === 0) {
            throw HttpError.validation('An item needs a listId');
          }

          // An item inherits its workspace from the list, and the list is
          // checked for existence first so a dangling item is not created.
          const owner = await syncRepository.findEntity('list', listId);
          if (owner === null || owner['deletedAt']) {
            throw HttpError.notFound('List not found');
          }
          await this.assertCanWrite((owner['workspaceId'] as string | null) ?? null, userId);

          const row = await syncRepository.insertEntity('list_item', {
            id: operation.entityId,
            listId,
            title: (payload['title'] as string) ?? 'Item',
            position: (payload['position'] as number) ?? 0,
            completed: (payload['completed'] as boolean) ?? false,
            favorite: (payload['favorite'] as boolean) ?? false,
            priority: (payload['priority'] as string) ?? 'none',
            externalId: (payload['externalId'] as string) ?? null,
            metadata: (payload['metadata'] as Record<string, unknown>) ?? null,
            notes: (payload['notes'] as string) ?? null,
          });
          return { status: 'applied', version: row.version };
        }

        default:
          throw HttpError.validation(`The entity "${entity}" cannot be created`);
      }
    }

    if (!existing) {
      return {
        status: 'rejected',
        version: null,
        error: 'The record no longer exists',
      };
    }

    if (existing.deletedAt) {
      return {
        status: 'rejected',
        version: existing.version,
        error: 'The record has been deleted',
      };
    }

    if (operation.kind === 'delete') {
      if (entity === 'workspace') {
        await this.assertCanWrite(operation.entityId, userId);
      } else if (entity === 'folder' || entity === 'list') {
        await this.assertCanWrite((existing['workspaceId'] as string | null) ?? null, userId);
      } else if (entity === 'list_item') {
        await this.assertCanWrite(await this.workspaceOfListItem(existing, userId), userId);
      }

      const row = await syncRepository.updateEntity(entity, operation.entityId, {}, {
        tombstone: true,
      });
      return { status: 'applied', version: row.version };
    }

    // update
    if (entity === 'workspace') {
      await this.assertCanWrite(operation.entityId, userId);
    } else if (entity === 'folder' || entity === 'list') {
      await this.assertCanWrite((existing['workspaceId'] as string | null) ?? null, userId);
    } else if (entity === 'list_item') {
      await this.assertCanWrite(await this.workspaceOfListItem(existing, userId), userId);
    }

    if (operation.baseVersion === existing.version) {
      const row = await syncRepository.updateEntity(
        entity,
        operation.entityId,
        sanitisePayload(entity, operation.payload),
      );
      return { status: 'applied', version: row.version };
    }

    const { values, conflictingFields } = merge(operation, existing);

    if (conflictingFields.length === 0) {
      // The client had stale data but touched nothing that changed: a safe merge.
      const row = await syncRepository.updateEntity(entity, operation.entityId, values);
      return { status: 'applied', version: row.version };
    }

    const conflict: Omit<SyncConflict, 'id'> = {
      entity: operation.entity,
      entityId: operation.entityId,
      workspaceId: (existing['workspaceId'] as string | null) ?? null,
      baseVersion: operation.baseVersion,
      serverVersion: existing.version,
      serverRecord: existing as Record<string, unknown>,
      clientRecord: values,
      conflictingFields,
      status: 'pending',
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
    };

    await this.storeConflict(conflict, userId);
    logger.info(
      { entity, entityId: operation.entityId, fields: conflictingFields },
      'sync conflict stored for review',
    );

    return {
      status: 'conflict',
      version: existing.version,
      error: `Conflicting fields: ${conflictingFields.join(', ')}`,
    };
  }

  private async storeConflict(
    conflict: Omit<SyncConflict, 'id'>,
    userId: string,
  ): Promise<void> {
    const { db } = await getDatabase();

    await db
      .insert(syncConflicts)
      .values({
        userId,
        entity: assertSupportedEntity(conflict.entity),
        entityId: conflict.entityId,
        workspaceId: conflict.workspaceId,
        baseVersion: conflict.baseVersion,
        serverVersion: conflict.serverVersion,
        serverRecord: conflict.serverRecord,
        clientRecord: conflict.clientRecord,
        conflictingFields: conflict.conflictingFields,
        status: conflict.status,
        detectedAt: new Date(conflict.detectedAt),
        resolvedAt: null,
      })
      .onConflictDoNothing();
  }

  /**
   * Applies a batch, one operation at a time and each one on its own terms.
   *
   * A push is everything a person wrote while offline, and the batch is
   * validated here rather than at the door: one operation the server cannot
   * read comes back as `rejected` with the reason, and the other hundred are
   * applied. Rejecting the whole batch for one bad operation left the outbox
   * unable to drain, and the app silent, because a client that retries a
   * rejected batch gets the same rejection forever.
   */
  async push(
    _envelope: { deviceId: string; lastPulledAt: string | null },
    userId: string,
    rawOperations: unknown[],
  ): Promise<SyncPushResponse> {
    const results: SyncOperationResult[] = [];

    for (const raw of rawOperations) {
      const parsed = syncOperationSchema.safeParse(raw);

      if (!parsed.success) {
        // The id is the one thing the result cannot do without, and an
        // operation with no usable id has no id at all: the zero uuid is the
        // one the schema itself accepts as "nothing".
        const operationId = readUuid(raw) ?? UNKNOWN_OPERATION_ID;
        logger.warn({ issues: parsed.error.issues.slice(0, 3) }, 'sync operation is not valid');

        results.push({
          operationId,
          status: 'rejected',
          entity: readEntity(raw) ?? 'dashboard',
          entityId: readUuid(raw, 'entityId') ?? UNKNOWN_OPERATION_ID,
          version: null,
          error: 'The operation is not valid and was not applied',
        });
        continue;
      }

      const operation = parsed.data;
      try {
        const seen = await syncRepository.findOperation(operation.operationId);
        if (seen) {
          // Idempotent replay: answer with what happened the first time.
          results.push({
            operationId: operation.operationId,
            status: 'duplicate',
            entity: operation.entity,
            entityId: operation.entityId,
            version: seen.resultVersion,
            error: null,
          });
          continue;
        }

        const applied = await this.apply(operation, userId);

        await syncRepository.recordOperation({
          operationId: operation.operationId,
          userId,
          entity: assertSupportedEntity(operation.entity),
          entityId: operation.entityId,
          status: applied.status,
          resultVersion: applied.version,
        });

        results.push({
          operationId: operation.operationId,
          status: applied.status,
          entity: operation.entity,
          entityId: operation.entityId,
          version: applied.version,
          error: applied.error ?? null,
        });
      } catch (error) {
        const message = error instanceof HttpError ? error.message : 'The operation failed';
        logger.warn({ err: error, operationId: operation.operationId }, 'sync operation failed');

        results.push({
          operationId: operation.operationId,
          status: 'rejected',
          entity: operation.entity,
          entityId: operation.entityId,
          version: null,
          error: message,
        });
      }
    }

    return { results, serverTime: new Date().toISOString() };
  }

  async pull(input: SyncPullRequest, userId: string, deviceId: string): Promise<SyncPullResponse> {
    const { changes, nextCursor, hasMore } = await syncRepository.changesSince({
      userId,
      cursor: input.cursor,
      limit: input.limit,
    });

    await syncRepository.saveCursor(userId, deviceId, nextCursor);

    return { changes, nextCursor, hasMore, serverTime: new Date().toISOString() };
  }

  async listConflicts(userId: string): Promise<SyncConflict[]> {
    const { db } = await getDatabase();

    const rows = await db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.status, 'pending')))
      .orderBy(syncConflicts.detectedAt);

    return rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      entityId: row.entityId,
      workspaceId: row.workspaceId,
      baseVersion: row.baseVersion,
      serverVersion: row.serverVersion,
      serverRecord: row.serverRecord,
      clientRecord: row.clientRecord,
      conflictingFields: row.conflictingFields,
      status: 'pending',
      detectedAt: row.detectedAt.toISOString(),
      resolvedAt: null,
    }));
  }
}

export const syncService = new SyncService();
