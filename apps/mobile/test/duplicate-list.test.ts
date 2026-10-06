import { describe, expect, it } from 'vitest';

import { planDuplication } from '../src/lib/lists/duplicate';

/**
 * Duplicating a list copies its items, and the copy has to match the original in
 * every way that matters while still being its own list. The planning is pure so
 * the rules can be checked without a database or a network.
 */

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'list-1',
    workspaceId: 'ws-1',
    folderId: 'folder-1',
    kind: 'movies' as const,
    title: 'Películas 2026',
    description: 'Lo que quiero ver',
    emoji: '🎬',
    tags: ['pendiente'],
    position: 3,
    orderMode: 'manual' as const,
    // A list nobody has chosen a colour for yet: every label falls back to the
    // colour its name hashes to.
    tagColors: {},
    version: 4,
    itemCount: 2,
    ...overrides,
  };
}

const items = [
  {
    id: 'item-1',
    listId: 'list-1',
    title: 'Matrix',
    position: 0,
    completed: true,
    priority: 'high' as const,
    icon: null,
    tags: [] as string[],
    externalId: 'movie:603',
    metadata: { provider: 'tmdb', year: '1999' },
    annotation: 'reverla',
    deletedAt: null,
  },
  {
    id: 'item-2',
    listId: 'list-1',
    title: 'Arrival',
    position: 1,
    completed: false,
    priority: 'none' as const,
    icon: null,
    tags: [] as string[],
    externalId: 'movie:329865',
    metadata: { provider: 'tmdb' },
    annotation: null,
    deletedAt: null,
  },
  {
    id: 'item-3',
    listId: 'list-1',
    title: 'Borrada',
    position: 2,
    completed: false,
    priority: 'none' as const,
    icon: null,
    tags: [] as string[],
    externalId: null,
    metadata: null,
    annotation: null,
    deletedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'item-4',
    listId: 'otra-lista',
    title: 'De otra lista',
    position: 0,
    completed: false,
    priority: 'none' as const,
    icon: null,
    tags: [] as string[],
    externalId: null,
    metadata: null,
    annotation: null,
    deletedAt: null,
  },
];

describe('planDuplication', () => {
  it('copies only the items of the source list that are not deleted', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items.map((item) => item.title)).toEqual(['Matrix', 'Arrival']);
  });

  it('renumbers the copies from zero, in the original order', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: (() => {
        let n = 0;
        return () => `new-${(n += 1)}`;
      })(),
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items.map((item) => item.position)).toEqual([0, 1]);
    expect(plan.items.map((item) => item.id)).toEqual(['new-1', 'new-2']);
  });

  it('keeps the completed state, the priority and the annotation', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    const first = plan.items[0];
    expect(first?.completed).toBe(true);
    expect(first?.priority).toBe('high');
    expect(first?.annotation).toBe('reverla');
  });

  it('keeps the provider record so a catalog item stays recognisable', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items[0]?.externalId).toBe('movie:603');
    expect(plan.items[0]?.metadata).toEqual({ provider: 'tmdb', year: '1999' });
  });


  it('stays in the same workspace, folder and position', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.workspaceId).toBe('ws-1');
    expect(plan.list.folderId).toBe('folder-1');
    expect(plan.list.position).toBe(3);
    expect(plan.list.kind).toBe('movies');
    expect(plan.list.emoji).toBe('🎬');
  });

  it('copies the tags by value, not by reference', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    plan.list.tags.push('otro');
    expect(plan.list.tags).toEqual(['pendiente', 'otro']);
  });

  it('takes the label colours with it', () => {
    // A copy of a list whose labels come out in one colour and that duplicates
    // into another is a list that changed the moment it was duplicated, and
    // nobody asked for it.
    const plan = planDuplication(source({ tagColors: { pendiente: 'green' } }), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.tagColors).toEqual({ pendiente: 'green' });
  });

  it('copies the label colours by value, not by reference', () => {
    // Same reason as the tags above it: a later write to the copy must not reach
    // back into the original's map. The original is held in a variable on
    // purpose — asking `source()` for a second one would prove nothing about the
    // first.
    const original = source({ tagColors: { pendiente: 'green' } });
    const plan = planDuplication(original, items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    plan.list.tagColors.pendiente = 'red';
    expect(plan.list.tagColors).toEqual({ pendiente: 'red' });
    expect(original.tagColors).toEqual({ pendiente: 'green' });
  });

  it('uses the given title and falls back to the original one', () => {
    const withTitle = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
      title: 'Películas 2027',
    });
    const without = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(withTitle.list.title).toBe('Películas 2027');
    expect(without.list.title).toBe('Películas 2026');
    // A title of only spaces is not a title.
    expect(
      planDuplication(source(), items, {
        newListId: 'list-2',
        newItemId: () => 'new-1',
        now: '2026-06-01T00:00:00.000Z',
        title: '   ',
      }).list.title,
    ).toBe('Películas 2026');
  });

  it('records the item count on the copy', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.itemCount).toBe(2);
  });

  it('copies an empty list without complaining', () => {
    const plan = planDuplication(source(), [], {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items).toEqual([]);
    expect(plan.list.itemCount).toBe(0);
  });

  it('starts every copy at version zero, as a new record', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.version).toBe(0);
    expect(plan.items.every((item) => item.version === 0)).toBe(true);
  });
});
