import * as Crypto from "expo-crypto";
import type {
  DashboardWidget,
  Folder,
  SyncConflict,
  SyncEntity,
  SyncOperation,
  SyncOperationKind,
  SyncPullResponse,
  Workspace,
} from "@orbit-hub/contracts";
import { SYNC_DEFAULTS } from "@orbit-hub/config";

import { api, toApiError } from "@/lib/api";
import { keyValueStore } from "@/lib/storage/key-value";

import { resolveDashboardRow } from "./dashboard-row";
import { getLocalStoreReady } from "./local-store";
import type {
  CachedEntity,
  LocalStore,
  PendingOperationRecord,
} from "./local-store";

export interface EnqueueInput {
  kind: SyncOperationKind;
  entity: SyncEntity;
  entityId: string;
  baseVersion: number;
  payload?: Record<string, unknown> | null;
  /** Values the device believed were stored, for the fields being changed. */
  base?: Record<string, unknown> | null;
}

export interface FlushResult {
  attempted: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  failed: number;
  error: string | null;
}

export interface PullResult {
  received: number;
  cursor: string | null;
  error: string | null;
}

const CURSOR_KEY = "sync:cursor";

async function readCursor(): Promise<string | null> {
  void (await getLocalStoreReady());
  return keyValueStore.get(CURSOR_KEY);
}

async function writeCursor(cursor: string | null): Promise<void> {
  if (cursor) {
    keyValueStore.set(CURSOR_KEY, cursor);
  } else {
    // A missing cursor only means a full resync next time.
    keyValueStore.remove(CURSOR_KEY);
  }
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
    base: input.base ? JSON.stringify(input.base) : null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
  };

  await store.enqueue(record);
  return operationId;
}

/**
 * Enqueues a batch as one write.
 *
 * Used by operations that are one user action but many rows, such as
 * duplicating a list. The order is preserved, because the server rejects an
 * item whose list does not exist yet.
 */
export async function enqueueOperations(
  inputs: EnqueueInput[],
): Promise<string[]> {
  if (inputs.length === 0) return [];

  const store = await getLocalStoreReady();
  const clientId = await store.getClientId();
  const createdAt = new Date().toISOString();
  const operationIds: string[] = [];

  for (const input of inputs) {
    const operationId = Crypto.randomUUID();
    operationIds.push(operationId);

    await store.enqueue({
      operationId,
      clientId,
      kind: input.kind,
      entity: input.entity,
      entityId: input.entityId,
      baseVersion: input.baseVersion,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      base: input.base ? JSON.stringify(input.base) : null,
      createdAt,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
    });
  }

  return operationIds;
}

function toOperation(record: PendingOperationRecord): SyncOperation {
  return {
    operationId: record.operationId,
    clientId: record.clientId,
    kind: record.kind,
    entity: record.entity,
    entityId: record.entityId,
    baseVersion: record.baseVersion,
    payload: record.payload
      ? (JSON.parse(record.payload) as Record<string, unknown>)
      : null,
    base: record.base
      ? (JSON.parse(record.base) as Record<string, unknown>)
      : null,
    clientTimestamp: record.createdAt,
  };
}

function toConflict(
  record: PendingOperationRecord,
  serverVersion: number,
): SyncConflict {
  return {
    id: Crypto.randomUUID(),
    entity: record.entity,
    entityId: record.entityId,
    workspaceId: null,
    baseVersion: record.baseVersion,
    serverVersion,
    serverRecord: {},
    clientRecord: record.payload
      ? (JSON.parse(record.payload) as Record<string, unknown>)
      : {},
    conflictingFields: [],
    status: "pending",
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
    const response = await api.post<{
      results: {
        operationId: string;
        status: string;
        version: number | null;
        error: string | null;
      }[];
    }>("/sync/push", {
      deviceId: clientId,
      lastPulledAt: null,
      operations: pending.map(toOperation),
    });

    for (const outcome of response.results) {
      const record = pending.find(
        (item) => item.operationId === outcome.operationId,
      );
      if (!record) continue;

      switch (outcome.status) {
        case "applied":
          await store.remove(record.operationId);
          result.applied += 1;
          break;
        case "duplicate":
          await store.remove(record.operationId);
          result.duplicates += 1;
          break;
        case "conflict":
          await store.saveConflict(
            toConflict(record, outcome.version ?? record.baseVersion),
          );
          await store.remove(record.operationId);
          result.conflicts += 1;
          break;
        case "rejected":
        default:
          await store.recordAttempt(record.operationId, outcome.error);
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

/**
 * Fills the local cache with everything changed since the last pull.
 *
 * The cache is what makes the app readable offline: screens never depend on
 * this call having happened recently.
 */
export async function pullIntoCache(
  options: { full?: boolean } = {},
): Promise<PullResult> {
  const store = await getLocalStoreReady();
  const clientId = await store.getClientId();
  const cursor = options.full ? null : await readCursor();

  try {
    const response = await api.post<SyncPullResponse>("/sync/pull", {
      cursor,
      limit: SYNC_DEFAULTS.pullPageSize,
      deviceId: clientId,
    });

    await applyChanges(store, response);
    await writeCursor(response.nextCursor);

    return {
      received: response.changes.length,
      cursor: response.nextCursor,
      error: null,
    };
  } catch (error) {
    return { received: 0, cursor, error: toApiError(error).message };
  }
}

async function applyChanges(
  store: LocalStore,
  response: SyncPullResponse,
): Promise<void> {
  const entities: CachedEntity[] = response.changes.map((change) => {
    const record = change.record as Record<string, unknown>;
    return {
      entity: change.entity,
      entityId: String(record["id"] ?? ""),
      version: Number(record["version"] ?? 0),
      updatedAt: new Date(
        String(record["updatedAt"] ?? new Date().toISOString()),
      ).toISOString(),
      deletedAt: record["deletedAt"]
        ? new Date(String(record["deletedAt"])).toISOString()
        : null,
      payload: JSON.stringify(record),
      pending: null,
    };
  });

  const usable = entities.filter((entity) => entity.entityId.length > 0);
  const panel = usable.filter((entity) => entity.entity === "dashboard");
  const rest = usable.filter((entity) => entity.entity !== "dashboard");

  if (rest.length > 0) {
    await store.upsertCached(rest);
  }

  // The panel is one row per person and the server gives it an identifier of its
  // own, which is not the one this device wrote it under. Writing it as it
  // arrives puts a second copy of the panel in the cache next to the first, and
  // from then on every read takes whichever came first: a list pinned on the
  // phone is gone on the laptop and back again on the phone. So it goes into the
  // row that is already here, under the identifier that keeps coming back.
  for (const change of panel) {
    const { entityId } = await resolveDashboardRow(store);
    await store.upsertCached([
      {
        ...change,
        entityId,
        payload: JSON.stringify({
          layout: readLayoutOfPayload(change.payload),
        }),
      },
    ]);
  }
}

function readLayoutOfPayload(payload: string): DashboardWidget[] {
  try {
    const record = JSON.parse(payload) as { layout?: DashboardWidget[] };
    return Array.isArray(record.layout) ? record.layout : [];
  } catch {
    return [];
  }
}

export async function fetchRemoteConflicts(): Promise<SyncConflict[]> {
  return api.get<SyncConflict[]>("/sync/conflicts");
}

/* ------------------------------------------------------------- read path ---- */

function readRecord<T>(cached: CachedEntity): T {
  const server = JSON.parse(cached.payload) as Record<string, unknown>;
  const pending = cached.pending
    ? (JSON.parse(cached.pending) as Record<string, unknown>)
    : null;

  // The wrapper columns are canonical for the fields the cache indexes on, and
  // the pending overlay wins on top so the user sees their own edit.
  return {
    ...server,
    id: cached.entityId,
    version: cached.version,
    updatedAt: cached.updatedAt,
    deletedAt: cached.deletedAt,
    ...pending,
  } as T;
}

/** Workspaces from the local cache, with pending local creations included. */
export async function readCachedWorkspaces(): Promise<Workspace[]> {
  const store = await getLocalStoreReady();
  const rows = await store.listCached("workspace");

  return rows
    .map((row) => readRecord<Workspace>(row))
    .filter((workspace) => workspace.deletedAt === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readCachedFolders(
  workspaceId: string,
): Promise<Folder[]> {
  const store = await getLocalStoreReady();
  const rows = await store.listCached("folder");

  return rows
    .map((row) => readRecord<Folder>(row))
    .filter(
      (folder) =>
        folder.workspaceId === workspaceId && folder.deletedAt === null,
    )
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export async function readCachedDashboard(): Promise<DashboardWidget[]> {
  const store = await getLocalStoreReady();
  const rows = await store.listCached("dashboard");
  const first = rows[0];
  if (!first) return [];

  const record = readRecord<{ layout: DashboardWidget[] }>(first);
  return record.layout ?? [];
}

/** Writes a local edit and queues it. The UI never waits for the network. */
export async function localUpdate(
  entity: SyncEntity,
  entityId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const store = await getLocalStoreReady();
  const cached = await store.getCached(entity, entityId);
  const baseVersion = cached?.version ?? 0;
  const base = cached
    ? (JSON.parse(cached.payload) as Record<string, unknown>)
    : null;

  const record = cached
    ? { ...JSON.parse(cached.payload), ...values }
    : { ...values, id: entityId };

  await store.upsertCached([
    {
      entity,
      entityId,
      version: baseVersion,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      payload: JSON.stringify(record),
      pending: JSON.stringify(values),
    },
  ]);

  await enqueueOperation({
    kind: "update",
    entity,
    entityId,
    baseVersion,
    payload: values,
    base,
  });
}
