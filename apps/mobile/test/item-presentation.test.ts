import { describe, expect, it } from 'vitest';

import type { ListItem, ListOrderMode } from '@orbit-hub/contracts';

import {
  canReorder,
  filterItems,
  isItemIcon,
  orderItems,
  tagsByFrequency,
} from '../src/lib/lists/item-presentation';

/**
 * Reading a list.
 *
 * The order and the filters are two different things and the mistake is mixing
 * them: choosing an order to look at something must never renumber it, and a
 * filter that hides things the moment it opens is one nobody trusts.
 */

function item(partial: Partial<ListItem> & { id: string }): ListItem {
  return {
    listId: 'l1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    title: 'Tarea',
    position: 0,
    completed: false,
    favorite: false,
    priority: 'none',
    icon: null,
    tags: [],
    externalId: null,
    metadata: null,
    notes: null,
    ...partial,
  };
}

const rows = [
  item({ id: 'c', title: 'pan', position: 2, createdAt: '2026-03-01T00:00:00.000Z', priority: 'high' }),
  item({ id: 'a', title: 'Tomate', position: 0, createdAt: '2026-01-01T00:00:00.000Z', priority: 'low', tags: ['Mercadona'] }),
  item({ id: 'b', title: 'Água', position: 1, createdAt: '2026-02-01T00:00:00.000Z', priority: 'high', tags: ['Carrefour'] }),
];

describe('orderItems', () => {
  it('keeps the order the person gave under manual', () => {
    expect(orderItems(rows, 'manual').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by name and puts an accented one where it belongs', () => {
    // "Água" is not after "pan" in Spanish, and a plain byte comparison puts it
    // there, which is why a collator is used instead of < and >.
    expect(orderItems(rows, 'alphabetical').map((i) => i.title)).toEqual(['Água', 'pan', 'Tomate']);
  });

  it('reverses the name order on request', () => {
    expect(orderItems(rows, 'alphabetical_desc').map((i) => i.title)).toEqual(['Tomate', 'pan', 'Água']);
  });

  it('sorts by when it was added, both ways', () => {
    expect(orderItems(rows, 'created_asc').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(orderItems(rows, 'created_desc').map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('puts the urgent things first, and keeps the rest in order', () => {
    // 'high' before 'low' is the only thing this order changes, and two items
    // with the same priority keep the order the person gave them.
    const result = orderItems(rows, 'priority');
    expect(result[0]?.priority).toBe('high');
    expect(result[result.length - 1]?.priority).toBe('low');
  });

  it('never renumbers anything', () => {
    // This is the whole point: the manual order is kept so choosing an order to
    // look at is not a way of losing it.
    for (const mode of ['alphabetical', 'created_desc', 'priority'] as ListOrderMode[]) {
      for (const row of orderItems(rows, mode)) {
        expect(rows.find((original) => original.id === row.id)?.position).toBe(row.position);
      }
    }
  });

  it('does not touch the array it is given', () => {
    const original = [...rows];
    orderItems(rows, 'alphabetical');
    expect(rows).toEqual(original);
  });

  it('breaks a tie by the manual order, so the result is stable', () => {
    const same = [item({ id: 'x', title: 'a', position: 5 }), item({ id: 'y', title: 'a', position: 1 })];
    expect(orderItems(same, 'alphabetical').map((i) => i.id)).toEqual(['y', 'x']);
  });
});

describe('canReorder', () => {
  it('is true only for the manual order', () => {
    // A row moved while the list is alphabetical lands somewhere the order did
    // not ask for, and the next re-sort puts it back: it looks like the drag
    // did nothing.
    expect(canReorder('manual')).toBe(true);
    for (const mode of ['alphabetical', 'alphabetical_desc', 'created_asc', 'created_desc', 'updated_desc', 'priority'] as ListOrderMode[]) {
      expect(canReorder(mode)).toBe(false);
    }
  });
});

describe('filterItems', () => {
  it('shows everything with no filter', () => {
    expect(filterItems(rows, {})).toHaveLength(3);
  });

  it('keeps the rows that carry any of the chosen labels', () => {
    // Any, not all: someone who picked Mercadona and "urgente" wants both, not
    // the intersection.
    const result = filterItems(rows, { tags: ['Mercadona', 'Carrefour'] });
    expect(result.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('leaves out a row with none of them', () => {
    expect(filterItems(rows, { tags: ['Mercadona'] }).map((i) => i.id)).toEqual(['a']);
  });

  it('filters by what is left to do and by what is done', () => {
    const mixed = [item({ id: 'p' }), item({ id: 'd', completed: true })];
    expect(filterItems(mixed, { completed: 'pending' }).map((i) => i.id)).toEqual(['p']);
    expect(filterItems(mixed, { completed: 'done' }).map((i) => i.id)).toEqual(['d']);
  });

  it('combines a label with what is left to do', () => {
    const mixed = [
      item({ id: 'a', tags: ['Mercadona'] }),
      item({ id: 'b', tags: ['Mercadona'], completed: true }),
    ];
    expect(filterItems(mixed, { tags: ['Mercadona'], completed: 'pending' }).map((i) => i.id)).toEqual(['a']);
  });

  it('searches by text without caring about case', () => {
    expect(filterItems(rows, { text: 'TOM' }).map((i) => i.id)).toEqual(['a']);
  });

  it('ignores a search that is only spaces', () => {
    expect(filterItems(rows, { text: '   ' })).toHaveLength(3);
  });
});

describe('tagsByFrequency', () => {
  it('offers the most used label first', () => {
    const items = [
      item({ id: '1', tags: ['Mercadona', 'perejil'] }),
      item({ id: '2', tags: ['Mercadona'] }),
      item({ id: '3', tags: ['Mercadona'] }),
    ];
    expect(tagsByFrequency(items)).toEqual([
      { tag: 'Mercadona', count: 3 },
      { tag: 'perejil', count: 1 },
    ]);
  });

  it('offers nothing for a list with no labels', () => {
    expect(tagsByFrequency([item({ id: '1' })])).toEqual([]);
  });

  it('counts a label once per item even if it is repeated', () => {
    expect(tagsByFrequency([item({ id: '1', tags: ['Mercadona', 'Mercadona'] })])).toEqual([
      { tag: 'Mercadona', count: 1 },
    ]);
  });
});

describe('isItemIcon', () => {
  it('knows the icons it can draw', () => {
    expect(isItemIcon('basket')).toBe(true);
  });

  it('says no to a key it does not have, rather than drawing nothing', () => {
    // A row with an icon the app does not know would show a blank space where
    // the picture is, which looks like a broken row.
    expect(isItemIcon('unicorn')).toBe(false);
    expect(isItemIcon(null)).toBe(false);
    expect(isItemIcon(undefined)).toBe(false);
  });
});
