import { DASHBOARD_PAGES } from "@orbit-hub/contracts";
import type { DashboardWidget } from "@orbit-hub/contracts";

/**
 * The panel as screens of cards.
 *
 * A phone cannot show twenty-four rows of cards, and a panel that leaves the
 * ones that do not fit is a panel where somebody has cards they cannot reach. So
 * the panel has as many screens as the person needs: every card carries the
 * screen it is on, each screen holds what fits on it, and a card that does not
 * fit is *reported* rather than drawn on top of a neighbour.
 *
 * The arithmetic lives here and not in the component, because a card on top of
 * another one is the failure that only shows up on the widths where nobody
 * looked, and it has to be checkable without a screen.
 *
 * Several of these carry the `worklet` directive, and that is not an optimisation
 * to be proud of but a requirement: a corner drag re-places the whole screen
 * sixty times a second, and doing that on the JavaScript side means a round trip
 * per card per frame. A worklet is still an ordinary function, so the same code
 * answers a resize on the interface thread and a layout in a test.
 *
 * THE ORDER OF THE FUNCTIONS BELOW IS NOT FREE, and getting it wrong breaks the
 * web build in a way that reads as a bundler bug. The Reanimated plugin rewrites
 * a worklet into an immediately-invoked factory whose *arguments* are everything
 * the worklet closes over — including the other worklets it calls. The rewrite
 * happens in source order at the top of the module, so a worklet that calls
 * another one declared *below* it is evaluated before that one exists:
 * `Cannot access 'X' before initialization`, in a minified bundle, with no module
 * named in the stack. So a worklet comes after everything it calls. `clampSize`
 * and `firstFreeSpot` are first for that reason and not because they are the most
 * interesting.
 */

/**
 * The fine grid the panel is placed on. Four columns, so halves and quarters.
 *
 * Four and not twelve because a card is now one of a fixed set of sizes and the
 * narrowest one is half the panel. Twelve columns of which a card uses six is the
 * same panel written twice: the person only ever chooses between the sizes below,
 * and a grid with cells nobody can select in is a grid that has to be explained.
 */
export const PANEL_COLUMNS = 4;

/**
 * How many rows a screen is tall.
 *
 * Six, and it is the number that makes a card a fraction rather than a size: the
 * six rows share the height of the board between them, so a card of one row is a
 * sixth of the screen on every device and a card of four is two thirds of it.
 */
export const PANEL_ROWS = 6;

/**
 * The cell, worked out so that the whole board is exactly the space given to it.
 *
 * The arithmetic behind a card being a *fraction of the screen* rather than a
 * number of points: the four columns and the three gaps between them add up to
 * the width, and the six rows and the five gaps between them add up to the height,
 * with nothing left over. No minimum and no maximum, because a minimum is what
 * stops a board from filling a short screen and a maximum is what stops a card
 * from being the size of a poster.
 *
 * This division is why the panel can promise it does not scroll: six rows of
 * *this* cell are exactly as tall as the board, so there is never a remainder to
 * scroll to. It is also why a board 700 tall and a board 400 tall both have six
 * rows, and a card of one row is a sixth of the height of whichever — the only way
 * a card can be the same proportion of the screen on a phone and on a laptop.
 *
 * A board of no height — the first frame, before it has been measured — divides
 * into nothing, and every card comes out zero tall for a frame. So the caller
 * passes a height it has already guessed and the measurement replaces it in the
 * same frame.
 */
export function panelCell(
  board: { width: number; height: number },
  gap: number,
  columns: number = PANEL_COLUMNS,
  rows: number = PANEL_ROWS,
): { width: number; height: number; gap: number } {
  return {
    width: (Math.max(0, board.width) - gap * (columns - 1)) / columns,
    height: (Math.max(0, board.height) - gap * (rows - 1)) / rows,
    gap,
  };
}

/**
 * The smallest and the largest a card can be, in cells.
 *
 * One cell to four. One is not a rounding error: on a grid of four columns and
 * six rows a one-by-one card is a quarter of the width and a sixth of the height,
 * which is an icon rather than a card — the size an icon is on the home screen of
 * a phone, and reachable with two fingers at once. The panel is a deck of things
 * you jump to, and some of those things only need a name on them.
 *
 * Four is the whole panel, which is a card that is the screen. Fine, and it is
 * how a screen is used up.
 */
export const MIN_CARD_COLUMNS = 1;
export const MIN_CARD_ROWS = 1;
export const MAX_CARD_COLUMNS = 4;
export const MAX_CARD_ROWS = 4;

/**
 * Every size a card can be.
 *
 * A closed list, and the list is the point. A free grid means the corner can stop
 * between two sizes, and a card that stops at 3.4 columns wide is a size nobody
 * chose, drawn slightly differently on every screen, and stored as a number the
 * next device rounds differently. A closed list means the corner always lands
 * somewhere real, and the set of things you can make is small enough to know
 * without looking.
 *
 * Sixteen of them: every combination of one to four across by one to four down.
 *
 * The order is by area and then by width, and it is not decoration — it decides a
 * tie in `snapSize`, so when a drag lands exactly between two sizes the *smaller*
 * one wins and the same drag always gives the same card. Sixteen sizes in an
 * arbitrary order would tie-break differently depending on how the list was
 * typed, which is the exact bug the closed list was introduced to stop.
 */
export const CARD_SIZES: readonly { w: number; h: number }[] = [
  // 1, 2, 2, 3, 3, 4, 4, 4, 6, 6, 8, 8, 9, 12, 12, 16 cells.
  { w: 1, h: 1 },
  { w: 1, h: 2 },
  { w: 2, h: 1 },
  { w: 1, h: 3 },
  { w: 3, h: 1 },
  { w: 1, h: 4 },
  { w: 2, h: 2 },
  { w: 4, h: 1 },
  { w: 2, h: 3 },
  { w: 3, h: 2 },
  { w: 2, h: 4 },
  { w: 4, h: 2 },
  { w: 3, h: 3 },
  { w: 3, h: 4 },
  { w: 4, h: 3 },
  { w: 4, h: 4 },
];

/**
 * The size in `CARD_SIZES` closest to this one.
 *
 * Nearest in both directions at once, so a corner pulled out to the right and down
 * lands on the size that is closest to how far it actually went, and not on the
 * first size that happens to be wide enough. The `columns`/`rows` arguments are
 * there so that a small grid in a test only offers sizes that fit it, and a
 * card is never snapped to something the screen cannot hold.
 */
export function snapSize(
  w: number,
  h: number,
  columns: number = PANEL_COLUMNS,
  rows: number = PANEL_ROWS,
): { w: number; h: number } {
  'worklet';
  const wantedW = Number.isFinite(w) ? w : MIN_CARD_COLUMNS;
  const wantedH = Number.isFinite(h) ? h : MIN_CARD_ROWS;

  let best = { w: MIN_CARD_COLUMNS, h: MIN_CARD_ROWS };
  let bestDistance = Number.MAX_VALUE;
  for (let index = 0; index < CARD_SIZES.length; index += 1) {
    const size = CARD_SIZES[index]!;
    if (size.w > columns || size.h > rows) continue;
    const dw = size.w - wantedW;
    const dh = size.h - wantedH;
    const distance = dw * dw + dh * dh;
    // Strictly less, so the first of two equally close sizes is kept: the
    // catalogue is ordered, and a tie has to resolve the same way every time.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = size;
    }
  }
  return { w: best.w, h: best.h };
}

/**
 * The most screens there can be.
 *
 * The same number as `DASHBOARD_PAGES` in the contract, and it is spelled out here
 * rather than imported on purpose: `placeCards` is a worklet, and a worklet closes
 * over plain data. A value pulled from a Zod schema would work but the import would
 * be evaluated on the interface thread, and this module is loaded by the gesture
 * handler rather than by a screen. The two numbers have to agree, and the test that
 * every screen the panel can produce is one the contract accepts is what keeps them
 * honest.
 */
export const MAX_PAGES = 8;

/** How tall a screen of placed cards is, in rows of the fine grid. */
export function panelHeightInRows(cards: PlacedCard[]): number {
  let deepest = 0;
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]!;
    if (card.y + card.h > deepest) deepest = card.y + card.h;
  }
  return deepest;
}

/**
 * The rows a board actually needs.
 *
 * Six on a board the size of the screen, because six rows of `panelCell` are
 * exactly the board. More than six only happens when a card is placed below the
 * fold, and then the board is taller than the screen and the page scrolls —
 * because cutting a card somebody arranged in half is how it gets lost.
 */
export function panelHeightInPixels(
  cards: PlacedCard[],
  cell: { height: number; gap: number },
): number {
  return panelHeightInRows(cards) * (cell.height + cell.gap) - cell.gap;
}

export interface PlacedCard {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A card as it is asked for, before it is put anywhere. */
export interface WantedCard {
  id: string;
  w: number;
  h: number;
  /**
   * Where it says it wants to be, in cells.
   *
   * Optional, and the two being optional together is the point: a card that has
   * never been arranged has no position and goes wherever it fits, while a card
   * that has been put somewhere keeps that place until the person moves it.
   */
  x?: number;
  y?: number;
}

/**
 * A grid coordinate, held inside the screen and never negative.
 *
 * The first worklet of the file, and the one everything else is built on. See the
 * note at the top about the order: the Reanimated rewrite evaluates each worklet's
 * closure as it goes, so this has to be defined before the functions that call it.
 * The ones below it are private for the same reason and not for tidiness —
 * nothing outside this file should be able to skip the rules they encode, which
 * are the whole of "respects the grid".
 */
function clampCell(value: number, max: number): number {
  'worklet';
  const whole = Math.floor(Number(value));
  if (!Number.isFinite(whole)) return 0;
  return Math.min(Math.max(whole, 0), Math.max(max, 0));
}

/** Whether a rectangle of this size has a run of free cells for all of it. */
function rectIsFree(
  occupied: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  'worklet';
  for (let row = y; row < y + h; row += 1) {
    const cells = occupied[row];
    if (!cells) continue;
    for (let col = x; col < x + w; col += 1) {
      if (cells[col]) return false;
    }
  }
  return true;
}

/** Marks a rectangle of the grid as taken. */
function takeRect(
  occupied: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  'worklet';
  for (let row = y; row < y + h; row += 1) {
    const cells = occupied[row];
    if (!cells) continue;
    for (let col = x; col < x + w; col += 1) {
      cells[col] = true;
    }
  }
}

function emptyGrid(columns: number, rows: number): boolean[][] {
  'worklet';
  const occupied: boolean[][] = [];
  for (let index = 0; index < rows; index += 1) {
    occupied.push(new Array<boolean>(columns).fill(false));
  }
  return occupied;
}

/**
 * The first rectangle of this size that fits, scanning top to bottom and left to
 * right.
 *
 * What a card that has never been arranged gets. It has no position to be near,
 * and first fit is the answer that keeps adding a card to an arranged screen from
 * moving everything: the new card goes where a newly created card goes, and the
 * ones already there stay where they are.
 */
function firstFreeSpot(
  occupied: boolean[][],
  w: number,
  h: number,
  columns: number,
  rows: number,
): { x: number; y: number } | null {
  'worklet';
  for (let y = 0; y <= rows - h; y += 1) {
    for (let x = 0; x <= columns - w; x += 1) {
      if (rectIsFree(occupied, x, y, w, h)) return { x, y };
    }
  }
  return null;
}

/**
 * The free rectangle of this size closest to the one being asked for.
 *
 * This is for the *finger*, not for the cards. A card being dragged is a wish:
 * you point at a cell, and if something is in it the card goes to the closest cell
 * that is not, so what you get is as near to where you pointed as the grid
 * allows. Nearest rather than first fit, because first fit would send a card
 * dragged towards the bottom-right of a crowded screen all the way back to the
 * top-left gap, and "put this over there" quietly becoming "and now it is
 * somewhere else" is the thing that makes a grid feel like it is not listening.
 *
 * Ties go to the earlier cell in scan order, so one finger position always gives
 * one answer and the card does not flicker between two cells.
 */
function nearestFreeSpot(
  occupied: boolean[][],
  w: number,
  h: number,
  columns: number,
  rows: number,
  nearX: number,
  nearY: number,
): { x: number; y: number } | null {
  'worklet';
  let best: { x: number; y: number } | null = null;
  let bestDistance = Number.MAX_VALUE;

  for (let y = 0; y <= rows - h; y += 1) {
    for (let x = 0; x <= columns - w; x += 1) {
      if (!rectIsFree(occupied, x, y, w, h)) continue;
      const dx = x - nearX;
      const dy = y - nearY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Places the cards, each one where it says it wants to be.
 *
 * This is the change that makes the panel a deck of cards rather than a list
 * drawn in a grid: before, the position a card had stored was thrown away and the
 * cards were packed in the order they happened to be in, so a person could drag a
 * card to the bottom-right and watch it come back to the top-left, because there
 * was nowhere in the panel to say "bottom-right".
 *
 * Now the stored position is the request, the nearest free rectangle is the
 * answer, and a card that was never arranged still goes to the first place it
 * fits. Positions are cells and never pixels, so the same arrangement is the same
 * panel on a phone and on a laptop — the arrangement belongs to the person and
 * not to the screen they made it on.
 */
export function placeCards(
  cards: WantedCard[],
  columns: number = PANEL_COLUMNS,
  rows: number = PANEL_ROWS,
  holdId: string | null = null,
): PlacedCard[] {
  'worklet';
  const occupied = emptyGrid(columns, rows);
  const placed: PlacedCard[] = [];

  // The held card is placed first and is not searched for: it goes where it was
  // asked for and everybody else moves. That is the difference between dragging a
  // card onto a part of the grid that is full — where it lands under your finger
  // and the neighbours get out of the way — and having it slide sideways to the
  // nearest gap instead.
  const held = holdId === null ? null : cards.find((card) => card.id === holdId);
  if (held) {
    const { w, h } = snapSize(held.w, held.h, columns, rows);
    const x = clampCell(held.x ?? 0, columns - w);
    const y = clampCell(held.y ?? 0, rows - h);
    takeRect(occupied, x, y, w, h);
    placed.push({ id: held.id, x, y, w, h });
  }

  for (let card = 0; card < cards.length; card += 1) {
    const wanted = cards[card]!;
    if (held && wanted.id === held.id) continue;
    const { w, h } = snapSize(wanted.w, wanted.h, columns, rows);
    const wants =
      wanted.x !== undefined && wanted.y !== undefined
        ? {
            x: clampCell(wanted.x, columns - w),
            y: clampCell(wanted.y, rows - h),
          }
        : null;

    // Kept where it says if that place is free, and displaced in reading order if
    // it is not. Displaced and not "nearest": a card that was pushed aside by
    // something growing over it should go to the next place along, and the next
    // place along is reading order. Nearest would drop it a row down — one step
    // away instead of three — and a neighbour that leaps downwards when you grow
    // a card looks like a different card being moved.
    const spot =
      wants && rectIsFree(occupied, wants.x, wants.y, w, h)
        ? wants
        : firstFreeSpot(occupied, w, h, columns, rows);
    if (!spot) continue;

    takeRect(occupied, spot.x, spot.y, w, h);
    placed.push({ id: wanted.id, x: spot.x, y: spot.y, w, h });
  }

  return placed;
}

/**
 * Whether a card of this size still has somewhere to go among these.
 *
 * Asked by running the same placement the screen will run and looking for the
 * card at the end, and not by a second opinion about free space. A second opinion
 * is how "does it fit" and "what will it look like" come to disagree, and the
 * disagreement is a card that was allowed to grow and then did not.
 */
export function fits(
  cards: WantedCard[],
  id: string,
  w: number,
  h: number,
  x?: number,
  y?: number,
  columns: number = PANEL_COLUMNS,
  rows: number = PANEL_ROWS,
): boolean {
  // Replaced if it is already there and added if it is not, because both are
  // asked: "does this card have room to grow" and "does a card that does not
  // exist yet have room". Only replacing is the bug where asking about a new card
  // silently answers about the screen without it, which is a screen with more
  // room than there is.
  const change = { id, w, h, ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) };
  const wanted = cards.some((card) => card.id === id)
    ? cards.map((card) => (card.id === id ? change : card))
    : [...cards, change];
  return placeCards(wanted, columns, rows).some((card) => card.id === id);
}

/** The screen a card says it is on, clamped to one that exists. */
export function pageOf(widget: DashboardWidget): number {
  const page = Math.trunc(Number(widget.page));
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(page, 0), DASHBOARD_PAGES - 1);
}

/**
 * The cards of one screen, placed, and the ones left over.
 *
 * `hidden` is the important half. A card the person pinned has to be somewhere:
 * if it does not fit where it is it is reported, so the panel can move it to
 * another screen itself, rather than drawn on top of a neighbour where nobody can
 * reach either of them.
 */
export function pageCards(widgets: DashboardWidget[]): {
  cards: PlacedCard[];
  hidden: string[];
} {
  const placed = placeCards(widgets.map(cellsOf));
  const placedIds = new Set(placed.map((card) => card.id));

  return {
    cards: placed,
    hidden: widgets
      .filter((widget) => !placedIds.has(widget.id))
      .map((widget) => widget.id),
  };
}

/** A stored card as the placement asks for it: its size and where it sits. */
export function cellsOf(widget: DashboardWidget): WantedCard {
  return { id: widget.id, w: widget.w, h: widget.h, x: widget.x, y: widget.y };
}

/**
 * How many screens the panel has, never fewer than one.
 *
 * The second argument is the count the panel **claims**, which is not the same
 * thing as the number of screens with a card on them. It was derived — the
 * highest screen a card sat on, plus one — so a screen nobody had put anything on
 * yet did not exist, and a button that added one added a screen that was gone
 * again by the next save. Somebody pressing it twice and finding one screen would
 * conclude the app had lost their click, which is a fair conclusion and a wrong
 * one.
 *
 * The claim wins when it is bigger, which is the only direction that can differ:
 * a panel whose cards all moved to the first screen still has the screens it was
 * given, because they are somewhere the person can put things.
 */
export function pageCount(
  layout: DashboardWidget[],
  claimed = 1,
): number {
  const last = layout.reduce(
    (most, widget) => Math.max(most, pageOf(widget)),
    0,
  );
  const derived = last + 1;
  const pedido = Math.trunc(Number(claimed));
  return Math.min(Math.max(derived, Number.isFinite(pedido) ? pedido : 1), DASHBOARD_PAGES);
}

/**
 * The screen a new card goes on.
 *
 * The one the person is looking at, when it has room. That is the rule and it is
 * the whole change: adding a card while looking at the third screen and finding
 * it on the first is not a surprise, it is the app having answered a different
 * question than the one that was asked.
 *
 * The page you are on comes first, then the same search as before — the first
 * with room, and past that the last there is. A screen that is full is a screen
 * that cannot take another card, and quietly landing it somewhere else anyway
 * would be a card that vanishes. The fallback is unchanged for that reason.
 */
export function pageForNewCard(
  layout: DashboardWidget[],
  size: { w: number; h: number },
  preferred?: number,
): number {
  const screens = pageCount(layout);

  const roomOn = (page: number): boolean => {
    const onPage = layout.filter((widget) => pageOf(widget) === page);
    return fits(onPage.map(cellsOf), "__new__", size.w, size.h);
  };

  // Only a page that exists. A preferred page beyond the last one is a caller
  // that has not caught up, and clamping it to the end would put the card on a
  // screen the person cannot reach.
  if (
    preferred !== undefined &&
    Number.isInteger(preferred) &&
    preferred >= 0 &&
    preferred < screens &&
    roomOn(preferred)
  ) {
    return preferred;
  }

  for (let page = 0; page < screens; page += 1) {
    if (roomOn(page)) return page;
  }
  // Every screen that exists is full. A new one, because the alternative is a
  // card pinned to a panel that cannot show it — which is how a list somebody
  // just pinned ends up invisible, with nothing said anywhere.
  if (screens < MAX_PAGES) return screens;
  // And no screens left, which is a panel of full-width bands across all eight.
  // The last one rather than nowhere: the card goes somewhere the person can
  // find, and the alternative is a pin that silently does not exist.
  return screens - 1;
}

/**
 * The screen a card is put on when it is moved to another one.
 *
 * Into the first place that fits on the screen it is going to, which with stored
 * positions is the same question the rest of the module asks. "At the end of it"
 * was the old answer and it was only right back when positions did not exist.
 */
export function moveCardToPage(
  layout: DashboardWidget[],
  id: string,
  page: number,
): DashboardWidget[] {
  const target = Math.min(Math.max(Math.trunc(page), 0), DASHBOARD_PAGES - 1);
  const card = layout.find((widget) => widget.id === id);
  if (!card || pageOf(card) === target) return layout;

  const onTarget = layout.filter(
    (widget) => pageOf(widget) === target && widget.id !== id,
  );
  const moved = { ...card, page: target };
  // The position is dropped on purpose: it belonged to the screen it came from,
  // and carrying it over would drop the card on top of whatever is at those cells
  // on the new one. With no position it is placed like a card pinned for the first
  // time, in the first place that fits.
  const placed = placeCards([
    { id: moved.id, w: moved.w, h: moved.h },
    ...onTarget.map(cellsOf),
  ]);
  const spot = placed.find((row) => row.id === id);
  if (!spot) return layout;

  return layout.map((widget) =>
    widget.id === id
      ? { ...moved, x: spot.x, y: spot.y, w: spot.w, h: spot.h }
      : widget,
  );
}

/**
 * The layout with one card changed, and the rest of its screen moved out of the way.
 *
 * One function for a drag and a resize, because they are the same operation: one
 * card wants a different size or a different place, and everything else on that
 * screen gets out of the way. Written twice they would disagree, and a drag that
 * behaves differently from a resize is two things to learn instead of one.
 *
 * The changed card is **held**: it is put exactly where it was asked for and
 * everything else on that screen moves out of the way. Without that, whether a
 * card follows your finger or teleports away depends on which free rectangle
 * happens to be closest, which is not the same thing as the one you pointed at.
 *
 * Everything the placement decided is written back, not only the card that moved.
 * That is the invariant the whole module rests on: **the stored position is where
 * the card is drawn**. Without it the neighbours would be placed one way and
 * drawn another, and the next resize would move them all over again.
 *
 * The other cards may end up with nowhere to go. That is not refused here: a card
 * the person is holding wins, the neighbour that has nowhere left is dropped from
 * this screen's placement, and the panel already knows how to report a card that
 * does not fit and offer it the next one. Refusing the resize instead would leave
 * a corner that does nothing when pulled, which is worse than a card moving.
 */
export function arrangeCard(
  layout: DashboardWidget[],
  id: string,
  change: { w?: number; h?: number; x?: number; y?: number },
): DashboardWidget[] {
  const card = layout.find((widget) => widget.id === id);
  if (!card) return layout;

  const onPage = layout.filter((widget) => pageOf(widget) === pageOf(card));
  const current = cardSize(card);
  const size = snapSize(
    change.w ?? current.w,
    change.h ?? current.h,
  );
  // No position asked for means it stays where it is, which is what a resize is:
  // the corner moves, the card does not.
  const held = {
    id,
    w: size.w,
    h: size.h,
    x: change.x ?? clampCell(card.x, PANEL_COLUMNS - size.w),
    y: change.y ?? clampCell(card.y, PANEL_ROWS - size.h),
  };

  const placed = placeCards(
    [held, ...onPage.filter((widget) => widget.id !== id).map(cellsOf)],
    PANEL_COLUMNS,
    PANEL_ROWS,
    id,
  );
  const spot = placed.find((row) => row.id === id);
  if (!spot) return layout;

  const byId = new Map(placed.map((row) => [row.id, row]));
  return layout.map((widget) => {
    const row = byId.get(widget.id);
    // Cards of another screen are not in the placement and are left alone.
    if (!row) return widget;
    if (
      widget.x === row.x &&
      widget.y === row.y &&
      widget.w === row.w &&
      widget.h === row.h
    ) {
      return widget;
    }
    return { ...widget, x: row.x, y: row.y, w: row.w, h: row.h };
  });
}

/** The same layout with one card grown or shrunk. */
export function resizeCard(
  layout: DashboardWidget[],
  id: string,
  size: { w: number; h: number },
): DashboardWidget[] {
  return arrangeCard(layout, id, { w: size.w, h: size.h });
}

/** The same layout with one card put somewhere else on its screen. */
export function moveCardTo(
  layout: DashboardWidget[],
  id: string,
  spot: { x: number; y: number },
): DashboardWidget[] {
  return arrangeCard(layout, id, spot);
}

/* ---------------------------------------------------------------- carrying a card -- */

/**
 * Which way a card that is being carried is being pushed, if far enough to count.
 *
 * A card is carried from one screen to another by being held and pushed to one
 * side, the way an icon is dragged off the edge of a home screen. The push is
 * measured in points and *not* in cells: it is how far the hand has travelled,
 * not where the card would land, and the two are different questions — the cell
 * says where it goes and this says whether the person meant to go there at all.
 *
 * Zero is the answer for a push that has not reached the mark, and it is a real
 * answer rather than a missing one: a card that is being carried sideways inside
 * its own screen is being placed, and a panel that turned the screen because a
 * thumb drifted is a panel nobody can arrange in.
 */
export function carryDirection(push: number, mark: number): -1 | 0 | 1 {
  if (push >= mark) return 1;
  if (push <= -mark) return -1;
  return 0;
}

/**
 * The screen a push carries a card to, or `null` when the panel ends that way.
 *
 * `null` and not the page it is already on, because "there is nowhere to go" and
 * "go where you are" are different answers and the caller has to be able to tell
 * them apart: the first one leaves the hand where it is, the second one would
 * spend the push on a page turn that does not happen.
 *
 * The panel's own edges, and not `DASHBOARD_PAGES`: carrying is a move between
 * screens that exist, and a screen nobody has been to is a screen with nothing
 * on it, which is somewhere to put a card and not somewhere to take one from.
 */
export function carryTarget(
  page: number,
  dir: -1 | 1,
  screens: number,
): number | null {
  const target = page + dir;
  if (target < 0 || target > screens - 1) return null;
  return target;
}

/**
 * Whether a screen has room for a card that is being carried to it.
 *
 * Asked *before* the panel turns, and it is the only reason the turn can be
 * refused. `moveCardToPage` never says no: the card it is placing goes into the
 * placement before the cards already on that screen, so a full screen would give
 * up its first cell and shuffle the rest around it. That is the right answer for a
 * card being dragged onto a full part of the grid — the card under the finger wins
 * and its neighbours get out of the way — and it is the wrong one here, because a
 * carry is nobody pointing at a cell: the hand is at the edge of the panel asking
 * a different question, and the panel would answer it by rearranging a screen
 * somebody had already arranged.
 *
 * So the answer is asked first, the way `pageForNewCard` asks it before pinning
 * something onto a screen: a screen that is full is somewhere to put a card once
 * there is room, and not somewhere to take one to.
 */
export function carryFits(
  layout: DashboardWidget[],
  id: string,
  page: number,
): boolean {
  const card = layout.find((widget) => widget.id === id);
  if (!card) return false;
  const there = layout.filter((widget) => pageOf(widget) === page && widget.id !== id);
  return fits(there.map(cellsOf), id, card.w, card.h);
}

/**
 * The layout after a card has been carried to another screen and let go.
 *
 * Two rules in one place because a card that is carried is subject to both and
 * the order matters. **The screen first**: a card that arrives carrying its
 * position lands on top of whatever is at those cells of the screen it is
 * arriving at, which is why `moveCardToPage` drops the position and places it
 * where there is room. **Then the cell**: the drop cell is where the hand let
 * go of it, and applying it to a card that has just been placed somewhere would
 * throw the placement away and move its new neighbours a second time.
 *
 * `from` is the layout as it was when the card was **picked up**, not as it is
 * when the hand lets go. The screens it travelled through only ever had its own
 * page changed, so they are already in that array; reading the live draft
 * instead would take the placement of the screen it is standing on and apply it
 * to the one it is going to.
 *
 * And the same array comes back when the carry went nowhere, which is how the
 * panel knows there is nothing to write: a hand that picked a card up and put it
 * down again has not arranged anything, and an operation in the outbox for that
 * is a write nobody asked for.
 */
export function carryCard(
  from: DashboardWidget[],
  id: string,
  page: number,
  spot: { x: number; y: number } | null,
): DashboardWidget[] {
  const moved = moveCardToPage(from, id, page);
  if (!spot) return moved;
  return moveCardTo(moved, id, spot);
}

/** The layout of a card, or a sensible default for a card that has none. */
export function cardSize(widget: DashboardWidget): { w: number; h: number } {
  return snapSize(widget.w, widget.h);
}

/* ------------------------------------------------------- the drag arithmetic -- */

/**
 * The size a card ends at when the corner is dragged `dx`, `dy` pixels away.
 *
 * The gesture gives pixels, the panel stores cells, and the answer is one of the
 * sizes in `CARD_SIZES` — never something in between. That is the difference
 * between a corner you can aim and a corner that leaves a card at three and a
 * half columns wide: the first has a handful of outcomes you can learn, the
 * second has a continuous range you can never quite hit twice.
 *
 * A step is the cell *and* the gap before the next one. Sizing on the cell alone
 * makes the first step cost a whole extra gap of travel, and the card feels like
 * it is fighting the finger.
 *
 * `round` and not `floor`, so the size changes as soon as the finger is past
 * halfway to the next one rather than only once it is a whole cell past it.
 */
export function sizeFromDrag(
  start: { w: number; h: number },
  dx: number,
  dy: number,
  cell: { width: number; height: number; gap: number },
): { w: number; h: number } {
  'worklet';
  const stepX = cell.width + cell.gap;
  const stepY = cell.height + cell.gap;

  // Before the panel has been measured there is no step to measure against, and
  // dividing by it would make the card NaN and vanish. It keeps the size it has.
  if (stepX <= 0 || stepY <= 0) return snapSize(start.w, start.h);

  const cellsW = (start.w * stepX + dx) / stepX;
  const cellsH = (start.h * stepY + dy) / stepY;
  return snapSize(Math.round(cellsW), Math.round(cellsH));
}

/**
 * The size a card is actually drawn at this frame, given the one it wants.
 *
 * The finger decides a *position* and the position decides a *size*, which means
 * a fast finger can ask for several sizes in one frame and the ones in between are
 * drawn and replaced without ever being seen. A control whose intermediate values
 * cannot be seen is a control that cannot be used to pick one — which is the whole
 * reason the sizes are a closed list in the first place. So the drawn size moves
 * at most one cell per axis per frame and catches up over the next ones: a finger
 * going fast stops producing a bigger jump and starts producing the same sizes in
 * the same order, one after another.
 *
 * This is a belt and not the braces, and it is here because the braces failed: the
 * real reason a drag went from one size to four was `resizeStartSize` below, and
 * this only bounds the damage when a finger really does cross three boundaries
 * between two frames. What a cap cannot do is fix a card that has run away — the
 * cap would have walked it through the sizes, all four of them, far too late.
 *
 * Clamping each axis and not choosing the nearest of the sizes: a diagonal step
 * from one column to three rows is not a thing the finger did, and a card that
 * leaps three rows for a sideways movement is a card whose height is not the
 * person's to decide.
 */
export function oneStepTowards(
  from: { w: number; h: number },
  to: { w: number; h: number },
): { w: number; h: number } {
  'worklet';
  const w = from.w + Math.sign(to.w - from.w);
  const h = from.h + Math.sign(to.h - from.h);
  return { w: Math.min(Math.max(w, 1), MAX_CARD_COLUMNS), h: Math.min(Math.max(h, 1), MAX_CARD_ROWS) };
}

/**
 * The size the next frame of a corner drag measures the finger's travel from.
 *
 * `size` is the card's current size, `held` is the size this drag is working
 * towards, and the rule is the whole bug report: **while the finger is on the
 * corner, the start size does not move.**
 *
 * A drag computes the size as the start size plus the distance the finger has
 * travelled, so the start has to stay where the finger found it. Syncing it to the
 * card's current size — which a resize changes, on purpose, sixty times a second
 * — moves the origin to where the finger has already got to, and the two compound.
 * Measured: a drag of a hundred and ninety-eight points turned a one column card
 * into a four column one, changing size three times in the thirty-three
 * milliseconds it took the finger to cover ten points, when one change of column
 * needs a hundred and thirty-two. Nobody holding that corner saw two columns or
 * three. They saw one and then four, and four is not a size anybody chose.
 *
 * It is a function and not a line in the component because this is the kind of
 * rule that has to be checkable without a finger: a `useEffect` that resyncs a
 * shared value on every prop change looks like bookkeeping, and only the measured
 * behaviour says otherwise.
 */
export function resizeStartSize(
  held: { w: number; h: number },
  size: { w: number; h: number },
  resizing: boolean,
): { w: number; h: number } {
  return resizing ? held : size;
}

/**
 * Where a card being dragged would land, as a cell of the grid.
 *
 * This is the heart of "put it where you want": the cell under the card's centre,
 * rounded to the grid, and if something is already there, the nearest place that
 * is not. Not an index into a list of cards — that model cannot express "the
 * bottom-right corner", which is most of what somebody means when they drag a
 * card somewhere.
 *
 * The card's **centre** and not the finger: a card is held by its middle, and a
 * card that jumped so that its corner followed the finger would be placed
 * somewhere the person was never pointing. The finger is where it was grabbed,
 * which is not where the card is.
 *
 * `others` is the screen without the card being dragged, so the thing being
 * dragged is never in the way of itself. When the nearest free cell is the one
 * the card is already over, the drag has not moved, and nothing opens: which is
 * the honest answer for a finger that has not gone anywhere.
 */
export function dropSpot(
  others: PlacedCard[],
  size: { w: number; h: number },
  center: { x: number; y: number },
  cell: { width: number; height: number; gap: number },
  columns: number = PANEL_COLUMNS,
  rows: number = PANEL_ROWS,
): { x: number; y: number } {
  'worklet';
  const limit = snapSize(size.w, size.h);
  const stepX = cell.width + cell.gap;
  const stepY = cell.height + cell.gap;
  // Before the panel has been measured there are no cells to speak of. Top-left
  // is where a card goes when nobody has said otherwise, and it is also the only
  // answer that does not depend on a measurement that does not exist yet.
  if (stepX <= 0 || stepY <= 0) return { x: 0, y: 0 };

  const occupied = emptyGrid(columns, rows);
  for (let index = 0; index < others.length; index += 1) {
    const other = others[index]!;
    takeRect(occupied, other.x, other.y, other.w, other.h);
  }

  // The cell the card is over, from its centre, so that the card lands *on* the
  // spot being pointed at rather than beside it.
  const nearX = clampCell(
    Math.round((center.x - (limit.w * stepX) / 2) / stepX),
    columns - limit.w,
  );
  const nearY = clampCell(
    Math.round((center.y - (limit.h * stepY) / 2) / stepY),
    rows - limit.h,
  );

  return (
    nearestFreeSpot(occupied, limit.w, limit.h, columns, rows, nearX, nearY) ?? {
      x: nearX,
      y: nearY,
    }
  );
}

