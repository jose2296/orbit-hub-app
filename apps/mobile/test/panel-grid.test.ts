import { describe, expect, it } from 'vitest';

import type { DashboardWidget } from '@orbit-hub/contracts';

import {
  PANEL_COLUMNS,
  moveCard,
  panelCards,
  placeCards,
  resizeCard,
} from '../src/lib/dashboard/grid';

/**
 * Where each card goes on the panel.
 *
 * The bug this stops: a card that lands on top of another one. It only shows up
 * on the widths where nobody tested, and a card nobody can reach is a card
 * nobody has.
 */
function widget(id: string, w: number, h: number): DashboardWidget {
  return {
    id,
    kind: 'recent_lists',
    x: 0,
    y: 0,
    w,
    h,
    pinned: false,
  };
}

describe('placeCards', () => {
  it('puts two cards of one cell side by side', () => {
    expect(placeCards([{ id: 'a', w: 1, h: 1 }, { id: 'b', w: 1, h: 1 }])).toEqual([
      { id: 'a', x: 0, y: 0, w: 1, h: 1 },
      { id: 'b', x: 1, y: 0, w: 1, h: 1 },
    ]);
  });

  it('puts a wide card first and leaves the next one after it', () => {
    const placed = placeCards([
      { id: 'ancha', w: 6, h: 2 },
      { id: 'pequena', w: 3, h: 2 },
    ]);
    expect(placed[0]).toEqual({ id: 'ancha', x: 0, y: 0, w: 6, h: 2 });
    expect(placed[1]?.x).toBe(6);
    expect(placed[1]?.y).toBe(0);
  });

  it('never puts two cards on the same cell', () => {
    // The mistake the whole file exists for: two cards drawn over each other.
    const placed = placeCards([
      { id: 'a', w: 3, h: 3 },
      { id: 'b', w: 4, h: 2 },
      { id: 'c', w: 2, h: 5 },
      { id: 'd', w: 6, h: 1 },
    ]);

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const one = placed[i]!;
        const two = placed[j]!;
        const overlap =
          one.x < two.x + two.w && two.x < one.x + one.w && one.y < two.y + two.h && two.y < one.y + one.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('leaves out a card that does not fit instead of drawing it on top of one', () => {
    // A card saved on a wide screen and opened on a phone is the case: it has to
    // be absent, not on top of something.
    // Three cards of half the panel each, and a fourth that has nowhere to go.
    const placed = placeCards([
      { id: 'uno', w: 12, h: 8 },
      { id: 'dos', w: 12, h: 8 },
      { id: 'tres', w: 12, h: 8 },
      { id: 'cuatro', w: 12, h: 8 },
    ]);
    expect(placed).toHaveLength(3);
    expect(placed.map((card) => card.id)).not.toContain('cuatro');
  });

  it('keeps a size that is not a whole number away', () => {
    // A size of 0 or a negative one would draw a card nobody can see or a card
    // that eats the whole panel.
    const placed = placeCards([{ id: 'a', w: 0, h: -3 }, { id: 'b', w: 99, h: 1 }]);
    expect(placed[0]).toEqual({ id: 'a', x: 0, y: 0, w: 1, h: 1 });
    expect(placed[1]?.w).toBe(PANEL_COLUMNS);
  });
});

describe('panelCards', () => {
  it('says which card did not fit', () => {
    const full = Array.from({ length: 3 }, (_, i) => widget(`llena${i}`, 12, 8));
    const { cards, hidden } = panelCards([...full, widget('grande', 12, 8)]);
    expect(cards).toHaveLength(3);
    expect(hidden).toEqual(['grande']);
  });

  it('places everything when there is room', () => {
    const { cards, hidden } = panelCards([widget('a', 4, 2), widget('b', 4, 2)]);
    expect(hidden).toEqual([]);
    expect(cards).toHaveLength(2);
  });
});

describe('moveCard', () => {
  it('moves a card to where it was dropped', () => {
    const layout = [widget('a', 1, 1), widget('b', 1, 1), widget('c', 1, 1)];
    expect(moveCard(layout, 'a', 2).map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps the order when the card was dropped where it already was', () => {
    const layout = [widget('a', 1, 1), widget('b', 1, 1)];
    expect(moveCard(layout, 'a', 0).map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('does not move a card that is not there', () => {
    const layout = [widget('a', 1, 1)];
    expect(moveCard(layout, 'fantasma', 0).map((w) => w.id)).toEqual(['a']);
  });

  it('does not move a card past the ends', () => {
    const layout = [widget('a', 1, 1), widget('b', 1, 1)];
    expect(moveCard(layout, 'a', 99).map((w) => w.id)).toEqual(['b', 'a']);
    expect(moveCard(layout, 'b', -5).map((w) => w.id)).toEqual(['b', 'a']);
  });
});

describe('resizeCard', () => {
  it('makes a card bigger when there is room', () => {
    const layout = [widget('a', 2, 1), widget('b', 2, 1)];
    expect(resizeCard(layout, 'a', { w: 4, h: 1 })[0]).toMatchObject({ w: 4, h: 1 });
  });

  it('refuses a size that does not fit instead of drawing it on top of one', () => {
    // Two cards of half the panel each, and one of them asked to take all of
    // it: there is no room, so it snaps back rather than covering its neighbour.
    // This is the case the handle produces on a small phone.
    const layout = [widget('a', 12, 12), widget('b', 12, 12)];
    const after = resizeCard(layout, 'a', { w: 12, h: 24 });
    expect(after[0]).toMatchObject({ w: 12, h: 12 });
  });

  it('lets a card take the space under its neighbour', () => {
    // The same two cards, asked for a size that does fit: the answer is yes, and
    // a resize that always refused would be a resize that never does anything.
    const layout = [widget('a', 6, 2), widget('b', 6, 2)];
    expect(resizeCard(layout, 'a', { w: 12, h: 12 })[0]).toMatchObject({ w: 12, h: 12 });
  });

  it('keeps the rest of the panel untouched', () => {
    const layout = [widget('a', 2, 1), widget('b', 2, 1)];
    const after = resizeCard(layout, 'a', { w: 4, h: 1 });
    expect(after[1]).toBe(layout[1]);
  });
});
