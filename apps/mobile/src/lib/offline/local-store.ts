import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import type { SyncConflict, SyncEntity, SyncOperationKind } from '@orbit-hub/contracts';

import { secureStorage } from '@/lib/storage/secure-storage';

/** A write that still has to reach the API. Mirrors `SyncOperation` plus client bookkeeping. */
export interface PendingOperationRecord {
  operationId: string;
  clientId: string;
  kind: SyncOperationKind;
  entity: SyncEntity;
  entityId: string;
  baseVersion: number;
  /** JSON encoded payload, or null for deletes. */
  payload: string | null;
  /** JSON encoded base state the client believed was stored. */
  base: string | null;
  createdAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
}

/**
 * A cached server record. Screens read from here, never straight from the API,
 * which is what makes the app work with no connectivity.
 */
export interface CachedEntity {
  entity: SyncEntity;
  entityId: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
  /** JSON encoded record as the server sent it. */
  payload: string;
  /** Pending local edits, merged over the payload for display. */
  pending: string | null;
}

export interface LocalStore {
  readonly driver: 'sqlite' | 'web-storage';
  initialize(): Promise<void>;
  enqueue(record: PendingOperationRecord): Promise<void>;
  listPending(limit: number): Promise<PendingOperationRecord[]>;
  countPending(): Promise<number>;
  recordAttempt(operationId: string, error: string | null): Promise<void>;
  remove(operationId: string): Promise<void>;
  saveConflict(conflict: SyncConflict): Promise<void>;
  listConflicts(): Promise<SyncConflict[]>;
  countConflicts(): Promise<number>;
  resolveConflict(conflictId: string): Promise<void>;
  getClientId(): Promise<string>;

  upsertCached(entities: CachedEntity[]): Promise<void>;
  listCached(entity: SyncEntity, options?: { includeDeleted?: boolean }): Promise<CachedEntity[]>;
  getCached(entity: SyncEntity, entityId: string): Promise<CachedEntity | null>;
  putCached(entity: SyncEntity, entityId: string, values: Record<string, unknown>): Promise<void>;
  clearCache(): Promise<void>;
  reset(): Promise<void>;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** Lets React hooks re-render when the outbox or the cache changes. */
export function subscribeToLocalStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_outbox (
  operation_id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  payload TEXT,
  base TEXT,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS sync_outbox_created_at ON sync_outbox (created_at);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  workspace_id TEXT,
  base_version INTEGER NOT NULL,
  server_version INTEGER NOT NULL,
  server_record TEXT NOT NULL,
  client_record TEXT NOT NULL,
  conflicting_fields TEXT NOT NULL,
  status TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS sync_conflicts_status ON sync_conflicts (status);

CREATE TABLE IF NOT EXISTS cached_entities (
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payload TEXT NOT NULL,
  pending TEXT,
  PRIMARY KEY (entity, entity_id)
);
CREATE INDEX IF NOT EXISTS cached_entities_updated_at ON cached_entities (updated_at);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

interface NativeStore extends LocalStore {
  readonly driver: 'sqlite';
  database: SQLite.SQLiteDatabase | null;
}

class ExpoSqliteStore implements NativeStore {
  readonly driver = 'sqlite' as const;
  database: SQLite.SQLiteDatabase | null = null;

  async initialize(): Promise<void> {
    if (this.database) return;
    const database = await SQLite.openDatabaseAsync('orbithub.db');
    await database.execAsync('PRAGMA journal_mode = WAL;');
    await database.execAsync('PRAGMA foreign_keys = ON;');
    await database.execAsync(SCHEMA);
    this.database = database;
  }

  private db(): SQLite.SQLiteDatabase {
    if (!this.database) {
      throw new Error('Local store used before initialisation');
    }
    return this.database;
  }

  async enqueue(record: PendingOperationRecord): Promise<void> {
    await this.db().runAsync(
      `INSERT OR REPLACE INTO sync_outbox
        (operation_id, client_id, kind, entity, entity_id, base_version, payload, base, created_at, attempts, last_attempt_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.operationId,
      record.clientId,
      record.kind,
      record.entity,
      record.entityId,
      record.baseVersion,
      record.payload,
      record.base,
      record.createdAt,
      record.attempts,
      record.lastAttemptAt,
      record.lastError,
    );
    notify();
  }

  async listPending(limit: number): Promise<PendingOperationRecord[]> {
    const rows = await this.db().getAllAsync<OutboxRow>(
      'SELECT * FROM sync_outbox ORDER BY created_at ASC LIMIT ?',
      limit,
    );
    return rows.map(toPendingOperation);
  }

  async countPending(): Promise<number> {
    const row = await this.db().getFirstAsync<{ total: number }>(
      'SELECT COUNT(*) AS total FROM sync_outbox',
    );
    return row?.total ?? 0;
  }

  async recordAttempt(operationId: string, error: string | null): Promise<void> {
    await this.db().runAsync(
      'UPDATE sync_outbox SET attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE operation_id = ?',
      new Date().toISOString(),
      error,
      operationId,
    );
    notify();
  }

  async remove(operationId: string): Promise<void> {
    await this.db().runAsync('DELETE FROM sync_outbox WHERE operation_id = ?', operationId);
    notify();
  }

  async saveConflict(conflict: SyncConflict): Promise<void> {
    await this.db().runAsync(
      `INSERT OR REPLACE INTO sync_conflicts
        (id, entity, entity_id, workspace_id, base_version, server_version, server_record, client_record, conflicting_fields, status, detected_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      conflict.id,
      conflict.entity,
      conflict.entityId,
      conflict.workspaceId,
      conflict.baseVersion,
      conflict.serverVersion,
      JSON.stringify(conflict.serverRecord),
      JSON.stringify(conflict.clientRecord),
      JSON.stringify(conflict.conflictingFields),
      conflict.status,
      conflict.detectedAt,
      conflict.resolvedAt,
    );
    notify();
  }

  async listConflicts(): Promise<SyncConflict[]> {
    const rows = await this.db().getAllAsync<ConflictRow>(
      "SELECT * FROM sync_conflicts WHERE status = 'pending' ORDER BY detected_at DESC",
    );
    return rows.map(toConflict);
  }

  async countConflicts(): Promise<number> {
    const row = await this.db().getFirstAsync<{ total: number }>(
      "SELECT COUNT(*) AS total FROM sync_conflicts WHERE status = 'pending'",
    );
    return row?.total ?? 0;
  }

  async resolveConflict(conflictId: string): Promise<void> {
    await this.db().runAsync(
      "UPDATE sync_conflicts SET status = 'resolved', resolved_at = ? WHERE id = ?",
      new Date().toISOString(),
      conflictId,
    );
    notify();
  }

  async upsertCached(entities: CachedEntity[]): Promise<void> {
    const db = this.db();

    await db.withTransactionAsync(async () => {
      for (const entity of entities) {
        await db.runAsync(
          `INSERT INTO cached_entities (entity, entity_id, version, updated_at, deleted_at, payload, pending)
           VALUES (?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT (entity, entity_id) DO UPDATE SET
             version = excluded.version,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             payload = excluded.payload`,
          entity.entity,
          entity.entityId,
          entity.version,
          entity.updatedAt,
          entity.deletedAt,
          entity.payload,
        );
      }
    });

    notify();
  }

  async listCached(entity: SyncEntity, options: { includeDeleted?: boolean } = {}): Promise<CachedEntity[]> {
    const rows = await this.db().getAllAsync<CachedEntityRow>(
      `SELECT * FROM cached_entities
       WHERE entity = ? ${options.includeDeleted ? '' : 'AND deleted_at IS NULL'}
       ORDER BY updated_at DESC`,
      entity,
    );
    return rows.map(toCachedEntity);
  }

  async getCached(entity: SyncEntity, entityId: string): Promise<CachedEntity | null> {
    const row = await this.db().getFirstAsync<CachedEntityRow>(
      'SELECT * FROM cached_entities WHERE entity = ? AND entity_id = ?',
      entity,
      entityId,
    );
    return row ? toCachedEntity(row) : null;
  }

  async putCached(entity: SyncEntity, entityId: string, values: Record<string, unknown>): Promise<void> {
    await this.db().runAsync(
      `INSERT INTO cached_entities (entity, entity_id, version, updated_at, deleted_at, payload, pending)
       VALUES (?, ?, 0, ?, NULL, ?, NULL)
       ON CONFLICT (entity, entity_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      entity,
      entityId,
      new Date().toISOString(),
      JSON.stringify(values),
    );
    notify();
  }

  async clearCache(): Promise<void> {
    await this.db().execAsync('DELETE FROM cached_entities; DELETE FROM app_state;');
    notify();
  }

  async getClientId(): Promise<string> {
    return getOrCreateClientId('sqlite');
  }

  async reset(): Promise<void> {
    await this.db().execAsync(
      'DELETE FROM sync_outbox; DELETE FROM sync_conflicts; DELETE FROM cached_entities;',
    );
    notify();
  }
}

interface OutboxRow {
  operation_id: string;
  client_id: string;
  kind: string;
  entity: string;
  entity_id: string;
  base_version: number;
  payload: string | null;
  base: string | null;
  created_at: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
}

function toPendingOperation(row: OutboxRow): PendingOperationRecord {
  return {
    operationId: row.operation_id,
    clientId: row.client_id,
    kind: row.kind as PendingOperationRecord['kind'],
    entity: row.entity as PendingOperationRecord['entity'],
    entityId: row.entity_id,
    baseVersion: row.base_version,
    payload: row.payload,
    base: row.base,
    createdAt: row.created_at,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
  };
}

interface ConflictRow {
  id: string;
  entity: string;
  entity_id: string;
  workspace_id: string | null;
  base_version: number;
  server_version: number;
  server_record: string;
  client_record: string;
  conflicting_fields: string;
  status: string;
  detected_at: string;
  resolved_at: string | null;
}

function toConflict(row: ConflictRow): SyncConflict {
  return {
    id: row.id,
    entity: row.entity as SyncConflict['entity'],
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    baseVersion: row.base_version,
    serverVersion: row.server_version,
    serverRecord: JSON.parse(row.server_record) as Record<string, unknown>,
    clientRecord: JSON.parse(row.client_record) as Record<string, unknown>,
    conflictingFields: JSON.parse(row.conflicting_fields) as string[],
    status: row.status as SyncConflict['status'],
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
  };
}

interface CachedEntityRow {
  entity: string;
  entity_id: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
  payload: string;
  pending: string | null;
}

function toCachedEntity(row: CachedEntityRow): CachedEntity {
  return {
    entity: row.entity as CachedEntity['entity'],
    entityId: row.entity_id,
    version: row.version,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    payload: row.payload,
    pending: row.pending,
  };
}

const WEB_KEYS = {
  clientId: 'orbithub:client-id',
  outbox: 'orbithub:outbox',
  conflicts: 'orbithub:conflicts',
  cache: 'orbithub:cache',
  state: 'orbithub:state',
} as const;

function webStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(storage: Storage | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  storage?.setItem(key, JSON.stringify(value));
}

/**
 * Web implementation. localStorage is synchronous and small, which is fine for
 * an outbox and a cache of a few hundred records; the API matches SQLite exactly.
 */
class WebStorageStore implements LocalStore {
  readonly driver = 'web-storage' as const;

  async initialize(): Promise<void> {
    // Nothing to migrate: the shape lives in the stored JSON.
  }

  async enqueue(record: PendingOperationRecord): Promise<void> {
    const storage = webStorage();
    const current = readJson<PendingOperationRecord[]>(storage, WEB_KEYS.outbox, []);
    const next = current.filter((item) => item.operationId !== record.operationId);
    next.push(record);
    writeJson(storage, WEB_KEYS.outbox, next);
    notify();
  }

  async listPending(limit: number): Promise<PendingOperationRecord[]> {
    const current = readJson<PendingOperationRecord[]>(webStorage(), WEB_KEYS.outbox, []);
    return [...current].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
  }

  async countPending(): Promise<number> {
    return readJson<PendingOperationRecord[]>(webStorage(), WEB_KEYS.outbox, []).length;
  }

  async recordAttempt(operationId: string, error: string | null): Promise<void> {
    const storage = webStorage();
    const current = readJson<PendingOperationRecord[]>(storage, WEB_KEYS.outbox, []);
    writeJson(
      storage,
      WEB_KEYS.outbox,
      current.map((item) =>
        item.operationId === operationId
          ? {
              ...item,
              attempts: item.attempts + 1,
              lastAttemptAt: new Date().toISOString(),
              lastError: error,
            }
          : item,
      ),
    );
    notify();
  }

  async remove(operationId: string): Promise<void> {
    const storage = webStorage();
    const current = readJson<PendingOperationRecord[]>(storage, WEB_KEYS.outbox, []);
    writeJson(
      storage,
      WEB_KEYS.outbox,
      current.filter((item) => item.operationId !== operationId),
    );
    notify();
  }

  async saveConflict(conflict: SyncConflict): Promise<void> {
    const storage = webStorage();
    const current = readJson<SyncConflict[]>(storage, WEB_KEYS.conflicts, []);
    writeJson(storage, WEB_KEYS.conflicts, [
      ...current.filter((item) => item.id !== conflict.id),
      conflict,
    ]);
    notify();
  }

  async listConflicts(): Promise<SyncConflict[]> {
    return readJson<SyncConflict[]>(webStorage(), WEB_KEYS.conflicts, [])
      .filter((conflict) => conflict.status === 'pending')
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }

  async countConflicts(): Promise<number> {
    return readJson<SyncConflict[]>(webStorage(), WEB_KEYS.conflicts, []).filter(
      (conflict) => conflict.status === 'pending',
    ).length;
  }

  async resolveConflict(conflictId: string): Promise<void> {
    const storage = webStorage();
    const current = readJson<SyncConflict[]>(storage, WEB_KEYS.conflicts, []);
    writeJson(
      storage,
      WEB_KEYS.conflicts,
      current.map((conflict) =>
        conflict.id === conflictId
          ? { ...conflict, status: 'resolved' as const, resolvedAt: new Date().toISOString() }
          : conflict,
      ),
    );
    notify();
  }

  async upsertCached(entities: CachedEntity[]): Promise<void> {
    const storage = webStorage();
    const current = readJson<Record<string, CachedEntity>>(storage, WEB_KEYS.cache, {});

    for (const entity of entities) {
      const key = cacheKey(entity.entity, entity.entityId);
      // A pending local edit survives an incoming server record: the outbox
      // still owns that value until the push is acknowledged.
      current[key] = { ...current[key], ...entity, pending: current[key]?.pending ?? null };
    }

    writeJson(storage, WEB_KEYS.cache, current);
    notify();
  }

  async listCached(entity: SyncEntity, options: { includeDeleted?: boolean } = {}): Promise<CachedEntity[]> {
    const current = readJson<Record<string, CachedEntity>>(webStorage(), WEB_KEYS.cache, {});
    return Object.values(current)
      .filter((item) => item.entity === entity)
      .filter((item) => options.includeDeleted || item.deletedAt === null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getCached(entity: SyncEntity, entityId: string): Promise<CachedEntity | null> {
    const current = readJson<Record<string, CachedEntity>>(webStorage(), WEB_KEYS.cache, {});
    return current[cacheKey(entity, entityId)] ?? null;
  }

  async putCached(entity: SyncEntity, entityId: string, values: Record<string, unknown>): Promise<void> {
    const storage = webStorage();
    const current = readJson<Record<string, CachedEntity>>(storage, WEB_KEYS.cache, {});
    const key = cacheKey(entity, entityId);

    current[key] = {
      entity,
      entityId,
      version: current[key]?.version ?? 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      payload: JSON.stringify({ ...JSON.parse(current[key]?.payload ?? '{}'), ...values }),
      pending: null,
    };

    writeJson(storage, WEB_KEYS.cache, current);
    notify();
  }

  async clearCache(): Promise<void> {
    const storage = webStorage();
    storage?.removeItem(WEB_KEYS.cache);
    storage?.removeItem(WEB_KEYS.state);
    notify();
  }

  async getClientId(): Promise<string> {
    return getOrCreateClientId('web');
  }

  async reset(): Promise<void> {
    const storage = webStorage();
    storage?.removeItem(WEB_KEYS.outbox);
    storage?.removeItem(WEB_KEYS.conflicts);
    storage?.removeItem(WEB_KEYS.cache);
    notify();
  }
}

function cacheKey(entity: SyncEntity, entityId: string): string {
  return `${entity}:${entityId}`;
}

const CLIENT_ID_KEY = 'orbithub:client-id';

async function getOrCreateClientId(driver: 'sqlite' | 'web'): Promise<string> {
  if (driver === 'web') {
    const storage = webStorage();
    const existing = storage?.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const created = Crypto.randomUUID();
    storage?.setItem(CLIENT_ID_KEY, created);
    return created;
  }

  const existing = await secureStorage.get(CLIENT_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await secureStorage.set(CLIENT_ID_KEY, created);
  return created;
}

const store: LocalStore = Platform.OS === 'web' ? new WebStorageStore() : new ExpoSqliteStore();

let initialised: Promise<void> | null = null;

/** Idempotent: safe to call from several screens at once. */
export function getLocalStoreReady(): Promise<LocalStore> {
  if (!initialised) {
    initialised = store.initialize();
  }
  return initialised.then(() => store);
}
