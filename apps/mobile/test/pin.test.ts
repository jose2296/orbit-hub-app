import { describe, expect, it } from 'vitest';

import type { DashboardWidget, List } from '@orbit-hub/contracts';

import { fits, isPinned, withPinnedList, withoutPinnedList } from '../src/lib/dashboard/pin';

/**
 * Pinning a list to the dashboard.
 *
 * A pinned list is a card that says which list it is, not a copy of it, so the
 * two mistakes worth preventing are a second card for a list that already has
 * one and a card that lands on top of another one.
 */
function list(partial: Partial<List> = {}): List {
  return {
    id: 'l1',
    version: 1,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    workspaceId: 'w1',
    folderId: null,
    kind: 'tasks',
    title: 'Compra',
    description: null,
    emoji: null,
    favorite: false,
    tags: [],
    position: 0,
    itemCount: 0,
    orderMode: 'manual',
    ...partial,
  };
}

const tasks: DashboardWidget = {
  id: 'tasks',
  kind: 'tasks',
  x: 0,
  y: 0,
  w: 6,
  h: 4,
  pinned: false,
};

describe('withPinnedList', () => {
  it('adds a card that says which list it is', () => {
    const layout = withPinnedList([tasks], list());
    const card = layout.at(-1);

    expect(card?.id).toBe('list:l1');
    expect(card?.pinned).toBe(true);
    expect(card?.settings?.['listId']).toBe('l1');
  });

  it('does not add a second card for a list that already has one', () => {
    // Pinning twice from two screens is one card, not two that hide each other.
    const once = withPinnedList([tasks], list());
    const twice = withPinnedList(once, list());

    expect(twice).toHaveLength(2);
    expect(twice).toBe(once);
  });

  it('puts the card below the cards that are already there', () => {
    const layout = withPinnedList([tasks], list());
    expect(layout[1]?.y).toBeGreaterThanOrEqual(tasks.y + tasks.h);
  });

  it('leaves the array it is given alone', () => {
    const before = [tasks];
    withPinnedList(before, list());
    expect(before).toEqual([tasks]);
  });
});

describe('withoutPinnedList', () => {
  it('takes out the card of that list and only that one', () => {
    const layout = withPinnedList([tasks], list());
    const other = withPinnedList(layout, list({ id: 'l2', title: 'Vacaciones' }));

    const after = withoutPinnedList(other, 'l1');
    expect(after.map((widget) => widget.id)).toEqual(['tasks', 'list:l2']);
  });

  it('leaves a list that was not pinned alone', () => {
    expect(withoutPinnedList([tasks], 'l1')).toEqual([tasks]);
  });
});

describe('isPinned', () => {
  it('says which lists have a card', () => {
    const layout = withPinnedList([], list());
    expect(isPinned(layout, 'l1')).toBe(true);
    expect(isPinned(layout, 'l2')).toBe(false);
  });

  it('is not fooled by a card that has no list in its settings', () => {
    expect(isPinned([tasks], 'l1')).toBe(false);
  });
});

describe('fits', () => {
  it('says a card that hangs off the right edge does not fit', () => {
    expect(fits({ ...tasks, x: 10, w: 3 }, [])).toBe(false);
  });

  it('says a card on top of another one does not fit', () => {
    expect(fits({ ...tasks, id: 'other', x: 3, w: 6, y: 0, h: 4 }, [tasks])).toBe(false);
  });

  it('says a card beside another one fits', () => {
    expect(fits({ ...tasks, id: 'other', x: 6, w: 6, y: 0, h: 4 }, [tasks])).toBe(true);
  });

  it('does not collide with the card it is', () => {
    // Moving a card to where it already is is not a collision, and treating it
    // as one makes a card refuse to be saved where it is.
    expect(fits({ ...tasks, x: 3, w: 3, y: 0, h: 4 }, [tasks])).toBe(true);
  });
});
