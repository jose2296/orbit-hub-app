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
import { coalescePendingOperations, foldIntoCreate } from './coalesce';
import { SYNC_DEFAULTS } from "@orbit-hub/config";

import { STORAGE_KEYS } from "@/constants";
import { api, toApiError } from "@/lib/api";
import { keyValueStore } from "@/lib/storage/key-value";

import { applyDashboardChanges } from "./apply-panel";
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

async function readCursor(): Promise<string | null> {
  void (await getLocalStoreReady());
  return keyValueStore.get(STORAGE_KEYS.syncCursor);
}

async function writeCursor(cursor: string | null): Promise<void> {
  if (cursor) {
    keyValueStore.set(STORAGE_KEYS.syncCursor, cursor);
  } else {
    // A missing cursor only means a full resync next time.
    keyValueStore.remove(STORAGE_KEYS.syncCursor);
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

  // An edit to a row whose create has not gone out yet goes *into* that create
  // instead of becoming a second operation.
  //
  // The two are almost never in the same batch: the create leaves about a second
  // and a half after it is written, and the first keystroke after that is an
  // update in a later flush. Sent separately, the update carries `baseVersion: 0`
  // because the cache has not seen the answer, the server has the row at 1, and a
  // document nobody else touched comes back as a conflict. Found by running the
  // app: every test passed, because every test either created through the API or
  // waited for the create to be acknowledged first.
  if (input.kind !== 'create') {
    const pending = await store.listPending(SYNC_DEFAULTS.batchSize);
    const folded = foldIntoCreate(pending, record);
    if (folded) {
      await store.remove(folded.operationId);
      await store.enqueue({ ...folded, operationId: folded.operationId });
      return folded.operationId;
    }
  }

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
/**
 * Writes the version the server answered with back into the cached row.
 *
 * A cache that does not know what the server already has makes every later edit
 * look like a stale one. That is invisible until something is created and then
 * edited, which is what a note is.
 */
async function adoptServerVersion(
  store: Awaited<ReturnType<typeof getLocalStoreReady>>,
  record: PendingOperationRecord,
  version: number,
): Promise<void> {
  const cached = await store.getCached(record.entity, record.entityId);
  if (!cached || cached.deletedAt) return;

  const payload = safeParse(cached.payload);
  payload["version"] = version;

  await store.upsertCached([
    {
      entity: cached.entity,
      entityId: cached.entityId,
      version,
      updatedAt: new Date().toISOString(),
      deletedAt: cached.deletedAt,
      payload: JSON.stringify(payload),
      pending: null,
    },
  ]);
}

function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function flushOutbox(): Promise<FlushResult> {
  const store = await getLocalStoreReady();
  const pending = await store.listPending(SYNC_DEFAULTS.batchSize);
  const clientId = await store.getClientId();
  const { operations, folded } = coalescePendingOperations(pending);

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
      operations: operations.map(toOperation),
    });

    for (const outcome of response.results) {
      const record = pending.find(
        (item) => item.operationId === outcome.operationId,
      );
      if (!record) continue;

      switch (outcome.status) {
        case "applied":
        case "duplicate":
          await store.remove(record.operationId);
          if (outcome.status === "duplicate") result.duplicates += 1;
          else result.applied += 1;
          // The version the server now holds, written back into the cache.
          //
          // Without this the cached row keeps the version it had when it was
          // written locally — 0 for a row just created — so the next edit is sent
          // with `baseVersion: 0` while the server is at 1, and a note that was
          // created and typed into in one breath comes back as a conflict. The
          // operation is gone from the outbox but its answer is nowhere, which is
          // the same class of bug as an operation that is never sent.
          if (outcome.version !== null) {
            await adoptServerVersion(store, record, outcome.version);
          }
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

    // The operations that were folded into a create are finished either way. Their
    // values went out inside it, so replaying them would send the same edit again
    // against a version the client does not know about — which is the conflict
    // this folding exists to prevent, caused a second time by the fix.
    for (const id of folded) {
      await store.remove(id);
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
  /*
    The changes as cache rows, one shape for everything that is not the panel.

    The panel is left out on purpose and goes through `apply-panel`, which cannot be
    this mapping: its row has to land on the identifier that keeps coming back
    instead of the one the server made up, and it has to carry both the layout and
    the count of screens. Doing it here —which is where it was— meant a panel of one
    piece, with the count dropped on the floor every single pull.
  */
  const cambios = response.changes.filter((change) => change.entity !== "dashboard");
  const rows: CachedEntity[] = cambios.map((change) => filaDe(change));
  const usable = rows.filter((row) => row.entityId.length > 0);

  if (usable.length > 0) {
    await store.upsertCached(usable);
  }

  await applyDashboardChanges(store, response.changes);
}

function filaDe(change: { entity: SyncEntity; record: unknown }): CachedEntity {
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
  const all = await readAllCachedFolders();
  return all.filter((folder) => folder.workspaceId === workspaceId);
}

/**
 * Every folder the cache knows about, grouped later by whoever asks.
 *
 * A tree of spaces and folders reads all of them at once, and reading the cache
 * once per space to build one list is one read per space for a screen that
 * shows all the spaces together.
 */
export async function readAllCachedFolders(): Promise<Folder[]> {
  const store = await getLocalStoreReady();
  const rows = await store.listCached("folder");

  return rows
    .map((row) => readRecord<Folder>(row))
    .filter((folder) => folder.deletedAt === null)
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
