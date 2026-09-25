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
  reset(): Promise<void>;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** Lets React hooks re-render when the outbox changes, without a polling loop. */
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
    const rows = await this.db().getAllAsync<{
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
    }>('SELECT * FROM sync_outbox ORDER BY created_at ASC LIMIT ?', limit);

    return rows.map((row) => ({
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
    }));
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
    const rows = await this.db().getAllAsync<{
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
    }>("SELECT * FROM sync_conflicts WHERE status = 'pending' ORDER BY detected_at DESC");

    return rows.map((row) => ({
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
    }));
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

  async getClientId(): Promise<string> {
    return getOrCreateClientId('sqlite');
  }

  async reset(): Promise<void> {
    await this.db().execAsync('DELETE FROM sync_outbox; DELETE FROM sync_conflicts;');
    notify();
  }
}

const WEB_KEYS = {
  clientId: 'orbithub:client-id',
  outbox: 'orbithub:outbox',
  conflicts: 'orbithub:conflicts',
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
 * an outbox of a few hundred operations; the API surface matches SQLite exactly.
 */
class WebStorageStore implements LocalStore {
  readonly driver = 'web-storage' as const;

  async initialize(): Promise<void> {
    // Nothing to migrate: the schema is implicit in the stored JSON shape.
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
          ? { ...item, attempts: item.attempts + 1, lastAttemptAt: new Date().toISOString(), lastError: error }
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
    const next = current.filter((item) => item.id !== conflict.id);
    next.push(conflict);
    writeJson(storage, WEB_KEYS.conflicts, next);
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

  async getClientId(): Promise<string> {
    return getOrCreateClientId('web');
  }

  async reset(): Promise<void> {
    const storage = webStorage();
    storage?.removeItem(WEB_KEYS.outbox);
    storage?.removeItem(WEB_KEYS.conflicts);
    notify();
  }
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
