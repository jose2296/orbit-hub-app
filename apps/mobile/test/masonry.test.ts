import { describe, expect, it } from 'vitest';

import { balanceIntoColumns, columnsForWidth } from '../src/lib/layout/masonry';

/**
 * The masonry balancer.
 *
 * Columns are filled shortest-first, which is what keeps the bottom of the
 * layout level. Heights are estimates before anything is measured, so the
 * balancer has to work with no real measurement and still not produce a lopsided
 * first frame. It returns the index of each card, not its height.
 */
describe('balanceIntoColumns', () => {
  it('puts everything in one column when there is only one', () => {
    expect(balanceIntoColumns([1, 2, 3], 1)).toEqual([[0, 1, 2]]);
  });

  it('fills the first column before touching the second', () => {
    // Four equal cards in two columns: two each, first column first.
    expect(balanceIntoColumns([1, 1, 1, 1], 2)).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it('sends the next card to the shorter column', () => {
    // Two tall cards, then a short one that must land beside the first.
    const result = balanceIntoColumns([200, 200, 50], 2);
    expect(result[0]).toEqual([0, 2]);
    expect(result[1]).toEqual([1]);
  });

  it('keeps the columns within a card of each other', () => {
    const heights = [180, 200, 260, 320, 200, 180];
    const result = balanceIntoColumns(heights, 3);
    const totals = result.map((column) =>
      column.reduce((sum, index) => sum + (heights[index] ?? 0), 0),
    );

    // A card is at most 320 tall, so that is the most the tallest column can
    // lead by. Without shortest-first this number would be far larger.
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(320);
  });

  it('never loses or duplicates a card', () => {
    const heights = [100, 250, 80, 400, 120, 90, 310];
    const result = balanceIntoColumns(heights, 3);
    const flat = result.flat().sort((a, b) => a - b);

    expect(flat).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('returns one empty column per column when there is nothing to place', () => {
    expect(balanceIntoColumns([], 3)).toEqual([[], [], []]);
  });

  it('ignores a column count below one', () => {
    expect(balanceIntoColumns([1, 2], 0)).toEqual([[0, 1]]);
  });

  it('does not create more columns than there are cards', () => {
    const result = balanceIntoColumns([1, 2], 5);
    expect(result.filter((column) => column.length > 0).length).toBe(2);
  });
});

describe('columnsForWidth', () => {
  it('uses one column on a phone', () => {
    expect(columnsForWidth(390, 300, 3)).toBe(1);
  });

  it('uses two on a tablet', () => {
    expect(columnsForWidth(800, 300, 3)).toBe(2);
  });

  it('never exceeds the ceiling on a very wide screen', () => {
    expect(columnsForWidth(3000, 300, 3)).toBe(3);
  });

  it('returns one before the width is measured', () => {
    expect(columnsForWidth(0, 300, 3)).toBe(1);
  });
});
