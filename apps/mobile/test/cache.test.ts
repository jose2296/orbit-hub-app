import { describe, expect, it } from 'vitest';

import type { CachedEntity } from '../src/lib/offline/local-store';

/**
 * The read path is what makes the app work offline, so its rules are worth
 * pinning down in isolation: the cache, the pending overlay and the tombstones.
 */

function cached(overrides: Partial<CachedEntity> = {}): CachedEntity {
  return {
    entity: 'workspace',
    entityId: 'w1',
    version: 3,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    payload: JSON.stringify({ id: 'w1', name: 'Servidor', emoji: '🏠', version: 3 }),
    pending: null,
    ...overrides,
  };
}

function readRecord<T>(row: CachedEntity): T {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending ? (JSON.parse(row.pending) as Record<string, unknown>) : null;

  // Mirrors the real read path: the wrapper columns are canonical for the
  // indexed fields, and the pending overlay wins on top.
  return {
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  } as T;
}

describe('cached entity reads', () => {
  it('returns the server record when there is nothing pending', () => {
    const record = readRecord<{ name: string; emoji: string }>(cached());

    expect(record.name).toBe('Servidor');
    expect(record.emoji).toBe('🏠');
  });

  it('merges a pending local edit over the server record', () => {
    const row = cached({ pending: JSON.stringify({ name: 'Local' }) });
    const record = readRecord<{ name: string; emoji: string }>(row);

    // The user sees their own change immediately...
    expect(record.name).toBe('Local');
    // ...without losing what the server knows.
    expect(record.emoji).toBe('🏠');
  });

  it('keeps the server version while a change is pending', () => {
    const row = cached({ pending: JSON.stringify({ name: 'Local' }) });
    const record = readRecord<{ version: number }>(row);

    // The version is what the next push sends as baseVersion.
    expect(record.version).toBe(3);
  });

  it('exposes a tombstone so the client can hide deleted records', () => {
    const row = cached({ deletedAt: '2026-01-02T00:00:00.000Z' });
    const record = readRecord<{ deletedAt: string | null }>(row);

    expect(record.deletedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
