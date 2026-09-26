import type { DashboardWidget } from "@orbit-hub/contracts";

/**
 * Where each card goes on the panel.
 *
 * The panel is a grid of a fixed number of columns and rows, and a card is a
 * number of cells wide and a number of rows tall. Where it *sits* is worked out
 * from the order of the cards and their sizes, and not stored: an absolute
 * position in pixels is a position that only makes sense on the screen it was
 * arranged on, and the same panel is looked at on a phone, on a tablet and on a
 * laptop. Sizes and order travel; the position they add up to is worked out
 * again for the width in front of you.
 *
 * The rules live here and not in the component so they can be checked without a
 * screen, which matters here more than usual: a card that lands on top of
 * another one is a card nobody can reach, and it is a bug that only shows up on
 * the widths where nobody tested.
 */

export const PANEL_COLUMNS = 12;

/** How many rows the panel is tall before it is allowed to grow. */
export const PANEL_ROWS = 24;

/** The smallest a card can be. Below one cell there is nothing to read. */
export const MIN_CELL = 1;

export interface PlacedCard {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Places the cards in order, each one in the first free rectangle of its size
 * that fits, scanning left to right and top to bottom.
 *
 * First fit and not a packing that leaves the fewest gaps: the first free spot
 * is where the card would have gone if it had just been created, so adding a
 * card to a panel that is already arranged does not move everything else.
 */
export function placeCards(
  cards: { id: string; w: number; h: number }[],
  {
    columns = PANEL_COLUMNS,
    rows = PANEL_ROWS,
  }: { columns?: number; rows?: number } = {},
): PlacedCard[] {
  const occupied: boolean[][] = Array.from({ length: rows }, () =>
    new Array<boolean>(columns).fill(false),
  );
  const placed: PlacedCard[] = [];

  for (const card of cards) {
    const w = clampSize(card.w, columns);
    const h = clampSize(card.h, rows);

    const spot = firstFreeSpot(occupied, w, h, columns, rows);
    if (!spot) continue;

    for (let y = spot.y; y < spot.y + h; y += 1) {
      for (let x = spot.x; x < spot.x + w; x += 1) occupied[y]![x] = true;
    }
    placed.push({ id: card.id, x: spot.x, y: spot.y, w, h });
  }

  return placed;
}

/** Whether a card of this size still has somewhere to go among these. */
export function fits(
  id: string,
  w: number,
  h: number,
  cards: { id: string; w: number; h: number }[],
  {
    columns = PANEL_COLUMNS,
    rows = PANEL_ROWS,
  }: { columns?: number; rows?: number } = {},
): boolean {
  // The grid is built with the card left out, because the question is whether it
  // has room in the space the *others* leave, which is the space it had before
  // anyone asked to make it bigger.
  const others = cards.filter((card) => card.id !== id);
  const grid: boolean[][] = Array.from({ length: rows }, () =>
    new Array<boolean>(columns).fill(false),
  );
  for (const spot of placeCards(others, { columns, rows })) {
    for (let y = spot.y; y < spot.y + spot.h; y += 1) {
      for (let x = spot.x; x < spot.x + spot.w; x += 1) grid[y]![x] = true;
    }
  }

  return (
    firstFreeSpot(
      grid,
      clampSize(w, columns),
      clampSize(h, rows),
      columns,
      rows,
    ) !== null
  );
}

function firstFreeSpot(
  occupied: boolean[][],
  w: number,
  h: number,
  columns: number,
  rows: number,
): { x: number; y: number } | null {
  for (let y = 0; y <= rows - h; y += 1) {
    for (let x = 0; x <= columns - w; x += 1) {
      let free = true;
      for (let row = y; row < y + h && free; row += 1) {
        for (let col = x; col < x + w && free; col += 1) {
          if (occupied[row]?.[col]) free = false;
        }
      }
      if (free) return { x, y };
    }
  }
  return null;
}

function clampSize(value: number, max: number): number {
  const whole = Math.floor(Number(value));
  if (!Number.isFinite(whole)) return MIN_CELL;
  return Math.min(Math.max(whole, MIN_CELL), max);
}

/**
 * The cards of a panel, in the order they are shown.
 *
 * The order is the list order, which is the one thing the person arranged, and
 * the position of each card is worked out from it. A card that no longer fits
 * is left out rather than drawn on top of another one, so a card saved from a
 * wider screen can never hide the one next to it.
 */
export function panelCards(layout: DashboardWidget[]): {
  cards: PlacedCard[];
  hidden: string[];
} {
  const sizes = new Map(
    layout.map((widget) => [widget.id, { w: widget.w, h: widget.h }] as const),
  );
  const wanted = layout.map((widget) => ({
    id: widget.id,
    w: sizes.get(widget.id)?.w ?? widget.w,
    h: sizes.get(widget.id)?.h ?? widget.h,
  }));

  const placed = placeCards(wanted);
  const placedIds = new Set(placed.map((card) => card.id));

  return {
    cards: placed,
    hidden: wanted
      .filter((card) => !placedIds.has(card.id))
      .map((card) => card.id),
  };
}

/** The same layout with one card moved, which is what a drag does. */
export function moveCard(
  layout: DashboardWidget[],
  id: string,
  toIndex: number,
): DashboardWidget[] {
  const from = layout.findIndex((widget) => widget.id === id);
  if (from === -1) return layout;
  const to = Math.min(Math.max(toIndex, 0), layout.length - 1);
  if (from === to) return layout;

  const next = [...layout];
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card as DashboardWidget);
  return next;
}

/** The same layout with one card resized, refusing a size with nowhere to go. */
export function resizeCard(
  layout: DashboardWidget[],
  id: string,
  size: { w: number; h: number },
): DashboardWidget[] {
  const wanted = layout.map((widget) =>
    widget.id === id
      ? { id: widget.id, w: size.w, h: size.h }
      : { id: widget.id, w: widget.w, h: widget.h },
  );
  if (!fits(id, size.w, size.h, wanted)) return layout;

  return layout.map((widget) =>
    widget.id === id ? { ...widget, w: size.w, h: size.h } : widget,
  );
}

/** The layout of a card, or a sensible default for a card that has none. */
export function cardSize(widget: DashboardWidget): { w: number; h: number } {
  return {
    w: clampSize(widget.w, PANEL_COLUMNS),
    h: clampSize(widget.h, PANEL_ROWS),
  };
}
