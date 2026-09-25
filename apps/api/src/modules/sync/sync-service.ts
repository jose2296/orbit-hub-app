import type {
  SyncConflict,
  SyncOperation,
  SyncOperationResult,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '@orbit-hub/contracts';
import { and, eq } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import { MEMBERSHIP_ROLE_RANK, SYNC_ENTITIES, SYNC_WRITABLE_FIELDS } from '../../db/constants.js';
import type { MembershipRoleName, SyncEntityName } from '../../db/constants.js';
import { HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { syncConflicts } from '../../db/schema.js';

import { syncRepository } from './sync-repository';
import type { StoredEntity } from './sync-repository';

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
        // The client created something that already exists: the row wins, the
        // duplicate create is absorbed. This is the retry case.
        return { status: 'duplicate', version: existing.version };
      }

      const payload = sanitisePayload(entity, operation.payload);

      if (entity === 'workspace') {
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

      // folder
      const workspaceId = (operation.payload?.['workspaceId'] as string | undefined) ?? null;
      if (!workspaceId) {
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
      } else if (entity === 'folder') {
        await this.assertCanWrite((existing['workspaceId'] as string | null) ?? null, userId);
      }

      const row = await syncRepository.updateEntity(entity, operation.entityId, {}, {
        tombstone: true,
      });
      return { status: 'applied', version: row.version };
    }

    // update
    if (entity === 'workspace') {
      await this.assertCanWrite(operation.entityId, userId);
    } else if (entity === 'folder') {
      await this.assertCanWrite((existing['workspaceId'] as string | null) ?? null, userId);
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

  async push(input: SyncPushRequest, userId: string): Promise<SyncPushResponse> {
    const results: SyncOperationResult[] = [];

    for (const operation of input.operations) {
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
