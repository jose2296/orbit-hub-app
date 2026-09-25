import { describe, expect, it } from 'vitest';

import { dropTargetIndex, nextOrderFromDrop } from '../src/lib/lists/drag';

/**
 * The arithmetic of a drag.
 *
 * On the UI thread the gesture only knows the translation in pixels, so the
 * index the row would land on has to be derived from that. Getting it wrong
 * means dropping a row somewhere other than where it visually lands, which is
 * the one thing a drag cannot recover from.
 */
describe('dropTargetIndex', () => {
  it('stays put when the finger has not moved far enough to change places', () => {
    expect(dropTargetIndex(2, 10, 64, 4)).toBe(2);
  });

  it('moves one place per row height travelled', () => {
    expect(dropTargetIndex(2, 70, 64, 4)).toBe(3);
    expect(dropTargetIndex(2, -70, 64, 4)).toBe(1);
  });

  it('moves several places when the finger travels far', () => {
    expect(dropTargetIndex(0, 200, 64, 4)).toBe(3);
    expect(dropTargetIndex(4, -200, 64, 4)).toBe(1);
  });

  it('never goes past the ends of the list', () => {
    expect(dropTargetIndex(0, -500, 64, 4)).toBe(0);
    expect(dropTargetIndex(3, 500, 64, 4)).toBe(3);
  });

  it('returns the index itself for an empty or single row list', () => {
    expect(dropTargetIndex(0, 300, 64, 1)).toBe(0);
  });

  it('does not divide by zero when the row height is unknown', () => {
    // Height is measured after layout; before that a zero must not produce NaN
    // and poison the order.
    expect(dropTargetIndex(1, 100, 0, 4)).toBe(1);
  });
});

describe('nextOrderFromDrop', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('moves the dragged row to the target and keeps the rest in order', () => {
    // 'd' to index 1 is a, d, b, c. There is no adjustment for a downwards
    // move: lifting the row out already closed the gap behind it.
    expect(nextOrderFromDrop(order, 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(nextOrderFromDrop(order, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('renumbers the result from zero', () => {
    const result = nextOrderFromDrop(order, 'c', 0);
    expect(result).toEqual(['c', 'a', 'b', 'd']);
  });

  it('leaves the order alone when the target is where it already is', () => {
    expect(nextOrderFromDrop(order, 'b', 1)).toEqual(order);
  });

  it('ignores a target outside the list', () => {
    expect(nextOrderFromDrop(order, 'b', 9)).toEqual(order);
    expect(nextOrderFromDrop(order, 'b', -1)).toEqual(order);
  });

  it('ignores an unknown row', () => {
    expect(nextOrderFromDrop(order, 'zzz', 0)).toEqual(order);
  });
});
