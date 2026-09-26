import { describe, expect, it } from 'vitest';

import { newListItem, withListItemDefaults } from '../src/lib/lists/item-record';

/**
 * A row of a list, written and read.
 *
 * The bug this exists to stop: a row is written by hand into the cache and read
 * back by parsing a payload, and a field that is in the contract but missing in
 * one of those places is not a type error. It is a row that crashes the screen,
 * and only for the people whose row it is.
 */

describe('newListItem', () => {
  it('fills in every field the contract has', () => {
    const item = newListItem({
      id: 'a',
      listId: 'l',
      title: 'Pan',
      position: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(item).toEqual({
      id: 'a',
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      listId: 'l',
      title: 'Pan',
      position: 3,
      completed: false,
      favorite: false,
      priority: 'none',
      icon: null,
      tags: [],
      externalId: null,
      metadata: null,
      notes: null,
      deletedAt: null,
    });
  });

  it('does not share the labels between rows', () => {
    // `tags: []` written twice in the same object literal would be the same
    // array in every row, and adding a label to one would add it to all of them.
    const first = newListItem({ id: 'a', listId: 'l', title: 'Pan', position: 0 });
    const second = newListItem({ id: 'b', listId: 'l', title: 'Leche', position: 1 });
    first.tags.push('Mercadona');

    expect(second.tags).toEqual([]);
  });

  it('keeps what the caller passes over the defaults', () => {
    const item = newListItem({
      id: 'a',
      listId: 'l',
      title: 'Urgente',
      position: 0,
      priority: 'high',
      icon: 'bread',
      externalId: 'movie:603',
      metadata: { imageUrl: 'https://x/y.jpg' },
    });

    expect(item.priority).toBe('high');
    expect(item.icon).toBe('bread');
    expect(item.externalId).toBe('movie:603');
    expect(item.metadata).toEqual({ imageUrl: 'https://x/y.jpg' });
  });

  it('leaves a field out rather than writing undefined over a default', () => {
    // `{ externalId: undefined }` spread over the record would replace the
    // null with undefined, and `undefined` is not what the contract means by
    // "no provider id".
    const item = newListItem({
      id: 'a',
      listId: 'l',
      title: 'Pan',
      position: 0,
      externalId: null,
    });

    expect(item.externalId).toBeNull();
  });
});

describe('withListItemDefaults', () => {
  it('reads a row the app wrote itself unchanged', () => {
    const written = newListItem({
      id: 'a',
      listId: 'l',
      title: 'Pan',
      position: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(withListItemDefaults(written)).toEqual(written);
  });

  it('fills in what a row from an older build does not have', () => {
    // A row written before the labels existed. Reading it as it is would break
    // the row the first time somebody opens the app after an update.
    const read = withListItemDefaults({
      id: 'a',
      listId: 'l',
      title: 'Pan',
      position: 0,
      version: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      completed: false,
      favorite: false,
      priority: 'none',
      externalId: null,
      metadata: null,
      notes: null,
      deletedAt: null,
    });

    expect(read.icon).toBeNull();
    expect(read.tags).toEqual([]);
  });

  it('refuses labels that are not a list', () => {
    // A payload that carries a string or a null where the contract says a list
    // is a row that cannot be counted, filtered or read.
    expect(withListItemDefaults({ tags: 'Mercadona' }).tags).toEqual([]);
    expect(withListItemDefaults({ tags: null }).tags).toEqual([]);
    expect(withListItemDefaults({ tags: 42 }).tags).toEqual([]);
  });

  it('keeps the labels it is given when they are a list', () => {
    expect(withListItemDefaults({ tags: ['Mercadona', 'urgente'] }).tags).toEqual([
      'Mercadona',
      'urgente',
    ]);
  });

  it('reads nothing at all as an empty row rather than throwing', () => {
    // A cache row with an empty payload is not a reason to leave the screen
    // blank.
    const read = withListItemDefaults(undefined);
    expect(read.tags).toEqual([]);
    expect(read.title).toBe('');
    expect(read.position).toBe(0);
  });

  it('does not change the numbers it is given', () => {
    expect(withListItemDefaults({ position: 7, version: 3 })).toMatchObject({
      position: 7,
      version: 3,
    });
  });
});
