import * as Crypto from 'expo-crypto';
import type {
  SyncConflict,
  SyncEntity,
  SyncOperation,
  SyncOperationKind,
  SyncPullResponse,
  SyncPushResponse,
} from '@orbit-hub/contracts';
import { SYNC_DEFAULTS } from '@orbit-hub/config';

import { api, toApiError } from '@/lib/api';

import { getLocalStoreReady } from './local-store';
import type { PendingOperationRecord } from './local-store';

export interface EnqueueInput {
  kind: SyncOperationKind;
  entity: SyncEntity;
  entityId: string;
  baseVersion: number;
  payload?: Record<string, unknown> | null;
}

export interface FlushResult {
  attempted: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  failed: number;
  error: string | null;
}

/**
 * Every write goes through here: persist locally first, then enqueue an
 * operation. The caller updates the UI immediately and never waits for the API.
 */
export async function enqueueOperation(input: EnqueueInput): Promise<string> {
  const store = await getLocalStoreReady();
  const clientId = await store.getClientId();
  const operationId = Crypto.randomUUID();

  const record: PendingOperationRecord = {
    operationId,
    clientId,
    kind: input.kind,
    entity: input.entity,
    entityId: input.entityId,
    baseVersion: input.baseVersion,
    payload: input.payload ? JSON.stringify(input.payload) : null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
  };

  await store.enqueue(record);
  return operationId;
}

function toOperation(record: PendingOperationRecord): SyncOperation {
  return {
    operationId: record.operationId,
    clientId: record.clientId,
    kind: record.kind,
    entity: record.entity,
    entityId: record.entityId,
    baseVersion: record.baseVersion,
    payload: record.payload ? (JSON.parse(record.payload) as Record<string, unknown>) : null,
    clientTimestamp: record.createdAt,
  };
}

function toConflict(
  record: PendingOperationRecord,
  serverRecord: Record<string, unknown>,
  serverVersion: number,
): SyncConflict {
  return {
    id: Crypto.randomUUID(),
    entity: record.entity,
    entityId: record.entityId,
    workspaceId: typeof serverRecord['workspaceId'] === 'string' ? serverRecord['workspaceId'] : null,
    baseVersion: record.baseVersion,
    serverVersion,
    serverRecord,
    clientRecord: record.payload ? (JSON.parse(record.payload) as Record<string, unknown>) : {},
    conflictingFields: Object.keys(record.payload ? (JSON.parse(record.payload) as object) : {}),
    status: 'pending',
    detectedAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

/**
 * Pushes queued operations. Operations are idempotent (`operationId`), so a
 * retry after a network drop is safe.
 */
export async function flushOutbox(): Promise<FlushResult> {
  const store = await getLocalStoreReady();
  const pending = await store.listPending(SYNC_DEFAULTS.batchSize);
  const clientId = await store.getClientId();

  const result: FlushResult = {
    attempted: pending.length,
    applied: 0,
    duplicates: 0,
    conflicts: 0,
    failed: 0,
    error: null,
  };

  if (pending.length === 0) {
    return result;
  }

  try {
    const response = await api.post<SyncPushResponse>('/sync/push', {
      deviceId: clientId,
      lastPulledAt: null,
      operations: pending.map(toOperation),
    } satisfies { deviceId: string; lastPulledAt: null; operations: SyncOperation[] });

    for (const operationResult of response.results) {
      const record = pending.find((item) => item.operationId === operationResult.operationId);
      if (!record) continue;

      switch (operationResult.status) {
        case 'applied':
        case 'duplicate':
          await store.remove(record.operationId);
          if (operationResult.status === 'applied') result.applied += 1;
          else result.duplicates += 1;
          break;
        case 'conflict':
          await store.saveConflict(
            toConflict(
              record,
              { version: operationResult.version ?? record.baseVersion, error: operationResult.error },
              operationResult.version ?? record.baseVersion,
            ),
          );
          await store.remove(record.operationId);
          result.conflicts += 1;
          break;
        case 'rejected':
        default:
          await store.recordAttempt(record.operationId, operationResult.error);
          if (record.attempts + 1 >= SYNC_DEFAULTS.maxAttempts) {
            await store.remove(record.operationId);
          }
          result.failed += 1;
          break;
      }
    }
  } catch (error) {
    const apiError = toApiError(error);
    result.error = apiError.message;
    for (const record of pending) {
      await store.recordAttempt(record.operationId, apiError.message);
    }
    result.failed = pending.length;
  }

  return result;
}

/** Pulls remote changes. The cache layer is added with the workspaces feature. */
export async function pullChanges(cursor: string | null): Promise<SyncPullResponse> {
  return api.post<SyncPullResponse>('/sync/pull', {
    cursor,
    limit: SYNC_DEFAULTS.pullPageSize,
  });
}
