import { describe, expect, it } from 'vitest';

import { reorderItems } from '../src/lib/lists/reorder';

/**
 * Reordering a list.
 *
 * The arithmetic is the easy part. What matters is that positions always come
 * out contiguous from zero, because the server stores them that way and a gap
 * makes "the item after this one" ambiguous on the next device.
 */
interface Positioned {
  id: string;
  position: number;
  [key: string]: unknown;
}

describe('reorderItems', () => {
  const items: Positioned[] = [
    { id: 'a', position: 0 },
    { id: 'b', position: 1 },
    { id: 'c', position: 2 },
    { id: 'd', position: 3 },
  ];

  it('moves an item up and closes the gap', () => {
    const result = reorderItems(items, 'd', -1);

    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(result.map((item) => item.position)).toEqual([0, 1, 2, 3]);
  });

  it('moves an item down and closes the gap', () => {
    const result = reorderItems(items, 'a', 1);

    expect(result.map((item) => item.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('moves an item several places in one go', () => {
    expect(reorderItems(items, 'a', 2).map((item) => item.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('renumbers a list that arrived with gaps', () => {
    const gapped: Positioned[] = [
      { id: 'a', position: 0 },
      { id: 'b', position: 5 },
      { id: 'c', position: 9 },
    ];

    const result = reorderItems(gapped, 'b', 1);

    expect(result.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(result.map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by position first, whatever order the rows arrived in', () => {
    const shuffled: Positioned[] = [
      { id: 'c', position: 2 },
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
    ];

    expect(reorderItems(shuffled, 'a', 1).map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('leaves the order alone when the move would go off the list', () => {
    expect(reorderItems(items, 'a', -1).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(reorderItems(items, 'd', 1).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves the order alone for an unknown item', () => {
    expect(reorderItems(items, 'zzz', -1).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not mutate the input', () => {
    const snapshot = items.map((item) => ({ ...item }));
    reorderItems(items, 'd', -1);

    expect(items).toEqual(snapshot);
  });

  it('handles an empty list and a single item', () => {
    expect(reorderItems([], 'a', 1)).toEqual([]);
    const single: Positioned[] = [{ id: 'a', position: 0 }];
    expect(reorderItems(single, 'a', 1)).toEqual(single);
  });

  it('keeps the rest of the item intact', () => {
    const withExtras = [
      { id: 'a', position: 0, title: 'A' },
      { id: 'b', position: 1, title: 'B' },
    ];

    const result = reorderItems(withExtras, 'b', -1);

    expect(result[0]).toEqual({ id: 'b', position: 0, title: 'B' });
  });
});
