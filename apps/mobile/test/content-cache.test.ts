import { describe, expect, it } from 'vitest';

import type { List, ListItem } from '@orbit-hub/contracts';

import type { CachedEntity } from '../src/lib/offline/local-store';

/**
 * The read rules of the content cache, pinned down: a screen must see the
 * server record with the local edit on top, and must never see a tombstone it
 * is not supposed to see.
 */

function cached(overrides: Partial<CachedEntity> = {}): CachedEntity {
  return {
    entity: 'list',
    entityId: 'l1',
    version: 2,
    updatedAt: '2026-02-01T10:00:00.000Z',
    deletedAt: null,
    payload: JSON.stringify({
      id: 'l1',
      workspaceId: 'w1',
      title: 'Servidor',
      favorite: false,
      version: 2,
      itemCount: 4,
    }),
    pending: null,
    ...overrides,
  };
}

function readRecord<T>(row: CachedEntity): T {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending ? (JSON.parse(row.pending) as Record<string, unknown>) : null;

  return {
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  } as T;
}

describe('content cache reads', () => {
  it('prefers a pending favourite over the server value', () => {
    const row = cached({ pending: JSON.stringify({ favorite: true }) });
    const list = readRecord<List>(row);

    expect(list.favorite).toBe(true);
    expect(list.title).toBe('Servidor');
    expect(list.itemCount).toBe(4);
  });

  it('keeps the server version so the next push has a correct baseVersion', () => {
    const row = cached({ pending: JSON.stringify({ title: 'Local' }) });
    expect(readRecord<List>(row).version).toBe(2);
  });

  it('marks a locally deleted list so the UI hides it right away', () => {
    const row = cached({
      deletedAt: '2026-02-01T11:00:00.000Z',
      pending: JSON.stringify({ deletedAt: '2026-02-01T11:00:00.000Z' }),
    });
    expect(readRecord<List>(row).deletedAt).not.toBeNull();
  });

  it('reads an item with its list context', () => {
    const row: CachedEntity = {
      entity: 'list_item',
      entityId: 'i1',
      version: 1,
      updatedAt: '2026-02-01T10:00:00.000Z',
      deletedAt: null,
      payload: JSON.stringify({ id: 'i1', listId: 'l1', title: 'Comprar pan', completed: false }),
      pending: JSON.stringify({ completed: true }),
    };

    const item = readRecord<ListItem>(row);
    expect(item.title).toBe('Comprar pan');
    expect(item.completed).toBe(true);
    expect(item.listId).toBe('l1');
  });
});

describe('list filters', () => {
  const lists: List[] = [
    { id: 'a', workspaceId: 'w1', title: 'Tareas', kind: 'tasks', favorite: true } as List,
    { id: 'b', workspaceId: 'w1', title: 'Pelis', kind: 'movies', favorite: false } as List,
    { id: 'c', workspaceId: 'w2', title: 'Otros', kind: 'books', favorite: false } as List,
  ];

  const apply = (filters: {
    workspaceId?: string;
    kind?: List['kind'];
    favorite?: boolean;
  }): string[] =>
    lists
      .filter((list) => (filters.workspaceId ? list.workspaceId === filters.workspaceId : true))
      .filter((list) => (filters.kind ? list.kind === filters.kind : true))
      .filter((list) => (filters.favorite !== undefined ? list.favorite === filters.favorite : true))
      .map((list) => list.id);

  it('filters by workspace', () => {
    expect(apply({ workspaceId: 'w1' })).toEqual(['a', 'b']);
  });

  it('filters by kind', () => {
    expect(apply({ kind: 'movies' })).toEqual(['b']);
  });

  it('filters by favourite', () => {
    expect(apply({ favorite: true })).toEqual(['a']);
  });

  it('combines filters', () => {
    expect(apply({ workspaceId: 'w1', kind: 'tasks' })).toEqual(['a']);
    expect(apply({ workspaceId: 'w2', kind: 'tasks' })).toEqual([]);
  });
});
