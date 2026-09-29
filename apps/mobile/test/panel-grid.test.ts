import { describe, expect, it } from "vitest";

import { DASHBOARD_PAGES, dashboardWidgetSchema } from "@orbit-hub/contracts";
import type { DashboardWidget } from "@orbit-hub/contracts";

import {
  CARD_SIZES,
  MAX_CARD_COLUMNS,
  MAX_CARD_ROWS,
  MAX_PAGES,
  MIN_CARD_COLUMNS,
  MIN_CARD_ROWS,
  PANEL_COLUMNS,
  PANEL_ROWS,
  arrangeCard,
  cardSize,
  dropSpot,
  fits,
  moveCardTo,
  moveCardToPage,
  oneStepTowards,
  pageCards,
  pageCount,
  pageForNewCard,
  pageOf,
  panelCell,
  panelHeightInPixels,
  panelHeightInRows,
  placeCards,
  resizeCard,
  resizeStartSize,
  sizeFromDrag,
  snapSize,
} from "../src/lib/dashboard/panel";

/**
 * A stored card.
 *
 * `x` and `y` default to the top-left cell, which is what every layout written
 * before the panel had free positions contains: a row of cards that all say
 * "somewhere" and no idea where. Those still have to land somewhere sensible, and
 * they do — a card that asks for a taken cell is placed at the first free one.
 */
function widget(
  id: string,
  w: number,
  h: number,
  page = 0,
  at?: { x: number; y: number },
): DashboardWidget {
  return {
    id,
    kind: "recent_lists",
    x: at?.x ?? 0,
    y: at?.y ?? 0,
    w,
    h,
    page,
    pinned: false,
  };
}

function placeCardsOf(cards: { id: string; w: number; h: number }[]) {
  return placeCards(cards, PANEL_COLUMNS, PANEL_ROWS);
}

/**
 * Six cards of two by two, which is exactly a full screen of four columns and
 * six rows.
 *
 * Two by two and not the smallest size: one by one tiles are twenty-four per
 * screen, which is a correct but unreadable way to say "this screen is full". The
 * question both of them answer is the same.
 */
function fullScreen(page: number): DashboardWidget[] {
  return Array.from({ length: 6 }, (_, i) =>
    widget(`llena${page}-${i}`, 2, 2, page, {
      x: (i % 2) * 2,
      y: Math.floor(i / 2) * 2,
    }),
  );
}

describe("the sizes a card can be", () => {
  /**
   * A closed list, and the list is the point.
   *
   * The panel was twelve columns wide and a card could be any size in it, which
   * meant the corner could stop at three and a half columns: a size nobody chose,
   * drawn slightly differently on every screen, and stored as a number the next
   * device rounds differently. Sixteen sizes is a list, and every one of them is
   * one somebody asked for.
   */
  it("is every size from one by one to four by four", () => {
    expect(CARD_SIZES).toHaveLength(16);
    for (const size of CARD_SIZES) {
      expect(size.w).toBeGreaterThanOrEqual(MIN_CARD_COLUMNS);
      expect(size.w).toBeLessThanOrEqual(MAX_CARD_COLUMNS);
      expect(size.h).toBeGreaterThanOrEqual(MIN_CARD_ROWS);
      expect(size.h).toBeLessThanOrEqual(MAX_CARD_ROWS);
    }
    // Every combination, once: 1x1 … 4x4, all sixteen.
    const seen = CARD_SIZES.map((s) => `${s.w}x${s.h}`).sort();
    const expected: string[] = [];
    for (let w = 1; w <= 4; w += 1) {
      for (let h = 1; h <= 4; h += 1) expected.push(`${w}x${h}`);
    }
    expect(seen).toEqual(expected.sort());
  });

  it("is ordered small to large, and that order is the tie-break", () => {
    // The order is what `snapSize` resolves a tie with, so it has to be a rule and
    // not a typing accident: a list whose order is arbitrary makes two devices
    // round the same drag differently, which is the bug the closed list exists to
    // prevent.
    for (let i = 1; i < CARD_SIZES.length; i += 1) {
      const before = CARD_SIZES[i - 1]!;
      const after = CARD_SIZES[i]!;
      const areaBefore = before.w * before.h;
      const areaAfter = after.w * after.h;
      expect(
        areaAfter > areaBefore || (areaAfter === areaBefore && after.w > before.w),
        `${before.w}x${before.h} esta antes que ${after.w}x${after.h} y no toca`,
      ).toBe(true);
    }
  });

  it("is on a grid of four columns, so a card can be the whole width", () => {
    // A card that cannot fill the width is not a card, it is a card in a frame.
    expect(MAX_CARD_COLUMNS).toBe(PANEL_COLUMNS);
  });

  it("never snaps to a size that is not in the list", () => {
    for (let w = 0; w <= 8; w += 1) {
      for (let h = 0; h <= 8; h += 1) {
        const snapped = snapSize(w, h);
        expect(CARD_SIZES).toContainEqual(snapped);
      }
    }
  });

  it("keeps a size that is already in the list", () => {
    for (const size of CARD_SIZES) {
      expect(snapSize(size.w, size.h)).toEqual(size);
    }
  });

  it("goes to the nearest one, and the smaller one when it is exactly between", () => {
    expect(snapSize(3, 2)).toEqual({ w: 3, h: 2 });
    // Exactly between two sizes, and the smaller one wins — every time, not
    // whichever happened to be typed first.
    expect(snapSize(1.5, 1)).toEqual({ w: 1, h: 1 });
    expect(snapSize(2.5, 2)).toEqual({ w: 2, h: 2 });
    expect(snapSize(3.5, 2)).toEqual({ w: 3, h: 2 });
    expect(snapSize(2.5, 1)).toEqual({ w: 2, h: 1 });
  });

  it("never returns something a small grid cannot hold", () => {
    // A four by four screen only has room for four by four and below, and asking
    // for a size it cannot draw is how a card is stored somewhere it can never be
    // seen.
    expect(snapSize(9, 9, 4, 4)).toEqual({ w: 4, h: 4 });
    expect(snapSize(9, 9, 2, 2)).toEqual({ w: 2, h: 2 });
  });
});

describe("panelCell", () => {
  const gap = 8;

  /**
   * The panel fills the screen and nothing scrolls.
   *
   * That promise is arithmetic, not a style: the columns and their gaps have to
   * add up to the width and the rows and their gaps have to add up to the height,
   * with nothing left over. If a point is left over, the panel is that much
   * taller than the space it was given, and the page scrolls — which is the one
   * thing the panel promised not to do, and which no other test can see.
   */
  it("adds up to the width and the height, with nothing left over", () => {
    for (const board of [
      { width: 390, height: 700 },
      { width: 724, height: 300 },
      { width: 360, height: 1100 },
    ]) {
      const cell = panelCell(board, gap);
      const across =
        PANEL_COLUMNS * cell.width + (PANEL_COLUMNS - 1) * cell.gap;
      const down = PANEL_ROWS * cell.height + (PANEL_ROWS - 1) * cell.gap;
      expect(across).toBeCloseTo(board.width, 6);
      expect(down).toBeCloseTo(board.height, 6);
    }
  });

  it("makes a card a fraction of the screen and not a number of points", () => {
    const phone = panelCell({ width: 390, height: 800 }, gap);
    const laptop = panelCell({ width: 1200, height: 900 }, gap);

    // A card of two columns is half the width on both, minus the gap. Same
    // arrangement, same proportions, two very different screens — which is the
    // only way an arrangement made on a phone can mean the same thing on a laptop.
    expect(phone.width * 2 + gap).toBeLessThan(390);
    expect(laptop.width * 2 + gap).toBeLessThan(1200);
    expect((390 - gap * 3) / 4 * 2 + gap).toBeCloseTo(phone.width * 2 + gap, 6);

    // And a row is about a sixth of the board on both, rather than a fixed number
    // of points. "About", and not exactly: the gaps between the rows are points
    // and not a fraction of anything, so on a taller screen a row is a slightly
    // larger share of it. That is the one place the promise is approximate, and it
    // is a few points, not a different panel.
    const share = (board: number, cell: { height: number }) => cell.height / board;
    expect(share(800, phone)).toBeCloseTo(1 / PANEL_ROWS, 1);
    expect(share(900, laptop)).toBeCloseTo(1 / PANEL_ROWS, 1);
    expect(share(800, phone) - 1 / PANEL_ROWS).toBeLessThan(0.01);
  });

  it("gives a cell of no size instead of dividing by nothing", () => {
    // The first frame, before the board has been measured. A cell of zero draws
    // a card of nothing, which is a card that looks like it is not there.
    const cell = panelCell({ width: 0, height: 0 }, gap);
    expect(Number.isFinite(cell.width)).toBe(true);
    expect(Number.isFinite(cell.height)).toBe(true);
  });

  it("never has a minimum cell, which is what a fixed height would be", () => {
    // The old cell was `max(56, width * 1.05)`: a floor under it, so on a short
    // screen six rows were taller than the screen and the panel scrolled. This is
    // the number that says the floor is gone.
    const short = panelCell({ width: 390, height: 200 }, gap);
    expect(short.height).toBeLessThan(56);
    expect(short.height).toBeGreaterThan(0);
  });
});

describe("placeCards", () => {
  it("puts two cards of the smallest size side by side", () => {
    expect(placeCardsOf([{ id: "a", w: 2, h: 2 }, { id: "b", w: 2, h: 2 }])).toEqual([
      { id: "a", x: 0, y: 0, w: 2, h: 2 },
      { id: "b", x: 2, y: 0, w: 2, h: 2 },
    ]);
  });

  it("puts a full-width card first and leaves the next one under it", () => {
    const placed = placeCardsOf([
      { id: "ancha", w: 4, h: 2 },
      { id: "pequena", w: 2, h: 2 },
    ]);
    expect(placed[0]).toEqual({ id: "ancha", x: 0, y: 0, w: 4, h: 2 });
    // A full-width band blocks the whole row, so the next one goes underneath
    // rather than beside it.
    expect(placed[1]).toMatchObject({ x: 0, y: 2 });
  });

  it("never puts two cards on the same cell", () => {
    // The mistake the whole file exists for: two cards drawn over each other.
    const placed = placeCardsOf([
      { id: "a", w: 3, h: 2 },
      { id: "b", w: 2, h: 3 },
      { id: "c", w: 4, h: 4 },
      { id: "d", w: 2, h: 2 },
    ]);

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const one = placed[i]!;
        const two = placed[j]!;
        const overlap =
          one.x < two.x + two.w &&
          two.x < one.x + one.w &&
          one.y < two.y + two.h &&
          two.y < one.y + one.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it("keeps a size that is not a whole number away", () => {
    const placed = placeCardsOf([
      { id: "a", w: 0, h: -3 },
      { id: "b", w: 99, h: 1 },
    ]);
    expect(placed[0]).toEqual({ id: "a", x: 0, y: 0, w: 1, h: 1 });
    expect(placed[1]?.w).toBe(MAX_CARD_COLUMNS);
  });

  it("leaves out a card that does not fit instead of drawing it on top of one", () => {
    // Six cards of two by two fill a screen exactly. A seventh is reported
    // rather than drawn over one of them, which is the failure the pagination
    // exists to remove.
    const placed = placeCardsOf(
      Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, w: 2, h: 2 })),
    );
    expect(placed).toHaveLength(6);
    expect(placed.map((card) => card.id)).not.toContain("c6");
  });

  it("tiles a screen with the smallest size there is", () => {
    // One by one is a real size, not a rounding error, so a screen can hold
    // twenty-four of them — which is the whole point of allowing it.
    const placed = placeCardsOf(
      Array.from({ length: 24 }, (_, i) => ({ id: `i${i}`, w: 1, h: 1 })),
    );
    expect(placed).toHaveLength(24);
    // Four across and six down, no gaps and nothing on top of anything.
    expect(placed.filter((card) => card.y === 0)).toHaveLength(4);
    expect(placed.filter((card) => card.x === 0 && card.y === 5)).toHaveLength(1);
  });

  describe("a card that says where it wants to be", () => {
    /**
     * The thing the whole panel was rebuilt for.
     *
     * Before, the position a card had stored was thrown away and the cards were
     * packed in the order they happened to be in, so a person could drag a card
     * to the bottom-right and watch it come back to the top-left: there was
     * nowhere in the panel to say "bottom-right".
     */
    it("keeps its place when it is free", () => {
      const placed = placeCards(
        [
          { id: "a", w: 2, h: 2, x: 2, y: 4 },
          { id: "b", w: 2, h: 2, x: 0, y: 0 },
        ],
        PANEL_COLUMNS,
        PANEL_ROWS,
      );
      expect(placed.find((card) => card.id === "a")).toMatchObject({ x: 2, y: 4 });
      expect(placed.find((card) => card.id === "b")).toMatchObject({ x: 0, y: 0 });
    });

    it("respects the order they were arranged in, not the order of the array", () => {
      // The array order decides only who wins a contested cell. The arrangement
      // the person made is in the positions, and that is what is honoured.
      const placed = placeCards(
        [
          { id: "abajo", w: 2, h: 2, x: 0, y: 4 },
          { id: "arriba", w: 2, h: 2, x: 0, y: 0 },
        ],
        PANEL_COLUMNS,
        PANEL_ROWS,
      );
      expect(placed.find((card) => card.id === "abajo")?.y).toBe(4);
      expect(placed.find((card) => card.id === "arriba")?.y).toBe(0);
    });

    it("is displaced along the row when something grows over it", () => {
      // Reading order, and not the nearest free cell. Nearest would send this one
      // a row down — one step instead of two — and a neighbour that drops a row
      // when you grow a card next to it looks like some other card being moved.
      const placed = placeCards(
        [
          { id: "ocupa", w: 2, h: 2, x: 0, y: 0 },
          { id: "pide", w: 2, h: 2, x: 0, y: 0 },
        ],
        PANEL_COLUMNS,
        PANEL_ROWS,
      );
      expect(placed.find((card) => card.id === "pide")).toMatchObject({
        x: 2,
        y: 0,
      });
    });

    it("drops to the next row when the whole row is taken", () => {
      const placed = placeCards(
        [
          { id: "banda", w: 4, h: 2, x: 0, y: 0 },
          { id: "pide", w: 2, h: 2, x: 0, y: 0 },
        ],
        PANEL_COLUMNS,
        PANEL_ROWS,
      );
      expect(placed.find((card) => card.id === "pide")).toMatchObject({
        x: 0,
        y: 2,
      });
    });

    it("is held exactly where it is asked for, and the others move", () => {
      // `holdId` is what a drag and a resize use. The held card is not searched
      // for: it lands under the finger and the neighbours make room, instead of
      // the card sliding sideways to the nearest gap.
      const placed = placeCards(
        [
          { id: "soltada", w: 2, h: 2, x: 2, y: 0 },
          { id: "enmano", w: 2, h: 2, x: 0, y: 0 },
        ],
        PANEL_COLUMNS,
        PANEL_ROWS,
        "enmano",
      );
      expect(placed.find((card) => card.id === "enmano")).toMatchObject({
        x: 0,
        y: 0,
      });
      expect(placed.find((card) => card.id === "soltada")).toMatchObject({
        x: 2,
        y: 0,
      });
    });

    it("never lands outside the screen, whatever cell it asked for", () => {
      const placed = placeCards(
        [{ id: "a", w: 2, h: 2, x: 99, y: 99 }],
        PANEL_COLUMNS,
        PANEL_ROWS,
      );
      expect(placed[0]?.x).toBeLessThanOrEqual(PANEL_COLUMNS - 2);
      expect(placed[0]?.y).toBeLessThanOrEqual(PANEL_ROWS - 2);
    });
  });
});

describe("pageCards", () => {
  it("says which card did not fit", () => {
    const { cards, hidden } = pageCards([...fullScreen(0), widget("grande", 2, 2)]);
    expect(cards).toHaveLength(6);
    expect(hidden).toEqual(["grande"]);
  });

  it("places everything when there is room", () => {
    const { cards, hidden } = pageCards([widget("a", 2, 2), widget("b", 2, 2)]);
    expect(hidden).toEqual([]);
    expect(cards).toHaveLength(2);
  });

  it("draws a card where it was arranged, and not where the array says", () => {
    const { cards } = pageCards([
      widget("a", 2, 2, 0, { x: 2, y: 4 }),
      widget("b", 2, 2, 0, { x: 0, y: 0 }),
    ]);
    expect(cards.find((card) => card.id === "a")).toMatchObject({ x: 2, y: 4 });
    expect(cards.find((card) => card.id === "b")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("the contract and the panel agree", () => {
  it("produces a card the contract would accept", () => {
    // `MAX_PAGES` is spelled out in the panel module because the placement is a
    // worklet and cannot close over a Zod schema. These two numbers drifting
    // apart is how a card ends up on a screen the server would refuse, so the
    // agreement is checked rather than assumed.
    expect(MAX_PAGES).toBe(DASHBOARD_PAGES);

    // And every size the panel can draw has to survive the schema, which is what
    // a person pressing "done" writes.
    for (const size of CARD_SIZES) {
      const card = dashboardWidgetSchema.safeParse({
        id: "list:l1",
        kind: "recent_lists",
        x: PANEL_COLUMNS - size.w,
        y: PANEL_ROWS - size.h,
        w: size.w,
        h: size.h,
        page: MAX_PAGES - 1,
        pinned: true,
      });
      expect(card.success, `${size.w}x${size.h} no lo acepta el contrato`).toBe(true);
    }
  });

  it("reads a layout written before pages existed as one screen of cards", () => {
    // Every person who used this before today has a stored layout with no `page`
    // on it. If the schema rejected those, opening the app would empty the panel
    // of everything they had pinned.
    const stored = [
      {
        id: "list:l1",
        kind: "recent_lists",
        x: 0,
        y: 0,
        w: 3,
        h: 1,
        pinned: true,
      },
    ];
    const parsed = stored.map((row) => dashboardWidgetSchema.parse(row));

    expect(parsed[0]?.page).toBe(0);
    expect(pageCards(parsed).hidden).toEqual([]);
  });
});

describe("pageOf", () => {
  it("reads a card written before there were screens as the first one", () => {
    const old = { ...widget("a", 2, 2) } as DashboardWidget;
    delete (old as { page?: number }).page;
    expect(pageOf(old)).toBe(0);
  });

  it("clamps a screen that does not exist to one that does", () => {
    expect(pageOf(widget("a", 2, 2, 900))).toBe(MAX_PAGES - 1);
    expect(pageOf(widget("a", 2, 2, -4))).toBe(0);
  });
});

describe("pageCount", () => {
  it("is one screen for a panel with nothing on the second", () => {
    expect(pageCount([widget("a", 2, 2)])).toBe(1);
  });

  it("counts up to the last screen that has something on it", () => {
    expect(pageCount([widget("a", 2, 2, 0), widget("b", 2, 2, 3)])).toBe(4);
  });

  it("is one screen for an empty panel, because there is always a first", () => {
    expect(pageCount([])).toBe(1);
  });
});

describe("pageForNewCard", () => {
  it("puts a card on the first screen that has room", () => {
    expect(pageForNewCard([], { w: 2, h: 2 })).toBe(0);
    expect(pageForNewCard(fullScreen(0), { w: 2, h: 2 })).toBe(1);
  });

  it("does not invent a screen when every one of them is full", () => {
    // A panel of full-width bands has room nowhere. Putting the card on a brand
    // new screen would be a change nobody asked for, and a screen that is mostly
    // empty.
    const full = Array.from({ length: MAX_PAGES }, (_, page) => fullScreen(page)).flat();
    expect(pageForNewCard(full, { w: 2, h: 2 })).toBe(MAX_PAGES - 1);
  });

  it("puts the card on the screen the person is looking at", () => {
    // The rule that changed. Both screens here have room, so the old answer —
    // the first with room — and this one disagree, and the difference is the whole
    // of it: pinning something while looking at the second screen and finding it
    // on the first is the app answering a different question than the one asked.
    const dosConHueco = [
      widget("una", 2, 2, 0, { x: 0, y: 0 }),
      widget("dos", 2, 2, 1, { x: 0, y: 0 }),
    ];
    expect(pageForNewCard(dosConHueco, { w: 2, h: 2 }, 1)).toBe(1);
    // And with no screen named, the old answer stands: the first with room.
    expect(pageForNewCard(dosConHueco, { w: 2, h: 2 })).toBe(0);
  });

  it("ignores a screen that is full, rather than landing the card on top of something", () => {
    // Looking at a screen with no room. The search continues as it did, so the
    // card goes somewhere it fits instead of on top of something.
    const primeraLlena = [widget("suelta", 2, 2, 0, { x: 0, y: 0 })];
    expect(pageForNewCard(primeraLlena, { w: 2, h: 2 }, 0)).toBe(0);
    const todoLleno = [...fullScreen(0), ...fullScreen(1)];
    expect(pageForNewCard(todoLleno, { w: 2, h: 2 }, 0)).toBe(2);
  });

  it("ignores a screen that does not exist", () => {
    // A caller that has not caught up with a panel that lost a screen. Clamping
    // the number would put the card on a screen the person cannot reach, and the
    // alternative — returning the number as given — would name a screen that does
    // not exist and the card would never be drawn.
    const conHueco = [
      widget("una", 2, 2, 0, { x: 0, y: 0 }),
      widget("dos", 2, 2, 1, { x: 0, y: 0 }),
    ];
    expect(pageForNewCard(conHueco, { w: 2, h: 2 }, 5)).toBe(0);
    expect(pageForNewCard(conHueco, { w: 2, h: 2 }, -1)).toBe(0);
    expect(pageForNewCard(conHueco, { w: 2, h: 2 }, 1.5)).toBe(0);
  });
});

describe("fits", () => {
  it("says a card of this size still has somewhere to go", () => {
    const cards = [{ id: "a", w: 2, h: 2, x: 0, y: 0 }];
    expect(fits(cards, "b", 2, 2)).toBe(true);
  });

  it("says a full screen has no room, and asks about a card that is not there", () => {
    // The bug this covers: `fits` only replaced a card that already existed, so
    // asking about one that does not exist yet answered about the screen
    // *without* it — a screen with more room than there is, and a pin that
    // silently lands on top of something.
    const full = fullScreen(0).map((w) => ({ id: w.id, w: w.w, h: w.h, x: w.x, y: w.y }));
    expect(fits(full, "nueva", 2, 2)).toBe(false);
  });

  it("agrees with what the screen would actually draw", () => {
    // Asked by running the same placement and looking for the card at the end, so
    // "does it fit" and "what will it look like" cannot come to disagree.
    const cards = [
      { id: "a", w: 2, h: 2, x: 0, y: 0 },
      { id: "b", w: 2, h: 2, x: 2, y: 0 },
    ];
    const fitsAtCorner = fits(cards, "a", MAX_CARD_COLUMNS, MAX_CARD_ROWS, 0, 0);
    const drawn = placeCards(
      [
        { id: "a", w: MAX_CARD_COLUMNS, h: MAX_CARD_ROWS, x: 0, y: 0 },
        ...cards.slice(1),
      ],
      PANEL_COLUMNS,
      PANEL_ROWS,
    ).some((card) => card.id === "a");
    expect(fitsAtCorner).toBe(drawn);
  });
});

describe("arrangeCard", () => {
  it("puts a card where it was dropped and moves the one in the way", () => {
    const layout = [
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
      widget("b", 2, 2, 0, { x: 2, y: 0 }),
    ];
    const after = moveCardTo(layout, "a", { x: 2, y: 0 });

    expect(after.find((w) => w.id === "a")).toMatchObject({ x: 2, y: 0 });
    // `b` was in the way, and it went to the first free place along the row —
    // back to where `a` came from — rather than being drawn underneath.
    expect(after.find((w) => w.id === "b")).toMatchObject({ x: 0, y: 0 });
  });

  it("leaves the neighbours alone when the card lands on free cells", () => {
    const layout = [
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
      widget("b", 2, 2, 0, { x: 2, y: 0 }),
    ];
    const after = moveCardTo(layout, "a", { x: 0, y: 4 });
    expect(after.find((w) => w.id === "b")).toBe(layout[1]);
  });

  it("moves a card to the far corner of the screen", () => {
    // The thing that could not be done before: there was nowhere to say
    // "bottom-right", so a drag could only ever change the order.
    const layout = [widget("a", 2, 2, 0, { x: 0, y: 0 })];
    expect(moveCardTo(layout, "a", { x: 2, y: 4 })[0]).toMatchObject({
      x: 2,
      y: 4,
    });
  });

  it("does not move a card that is not there", () => {
    const layout = [widget("a", 2, 2)];
    expect(moveCardTo(layout, "fantasma", { x: 2, y: 4 })).toBe(layout);
  });

  it("keeps a position inside the screen", () => {
    const layout = [widget("a", 2, 2, 0, { x: 0, y: 0 })];
    expect(moveCardTo(layout, "a", { x: 99, y: 99 })[0]).toMatchObject({
      x: PANEL_COLUMNS - 2,
      y: PANEL_ROWS - 2,
    });
  });

  it("does not touch the cards of another screen", () => {
    const layout = [
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
      widget("b", 2, 2, 0, { x: 2, y: 0 }),
      widget("lejos", 2, 2, 1, { x: 0, y: 0 }),
    ];
    const after = moveCardTo(layout, "a", { x: 2, y: 0 });
    expect(after.find((w) => w.id === "lejos")).toBe(layout[2]);
  });

  it("is the same answer whether it is given a size, a place, or both", () => {
    // One function for a drag and a resize, so the two cannot disagree.
    const layout = [widget("a", 2, 2, 0, { x: 0, y: 0 })];
    const bySize = arrangeCard(layout, "a", { w: 2, h: 2 });
    const byPlace = arrangeCard(layout, "a", { x: 0, y: 0 });
    expect(bySize[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
    expect(byPlace[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
  });
});

describe("moveCardToPage", () => {
  it("puts the card on the other screen in the first place that fits", () => {
    const layout = [
      widget("a", 2, 2, 0),
      widget("b", 2, 2, 0),
      // The right half of the second screen, so the new card goes to the left.
      widget("c", 2, 2, 1, { x: 2, y: 0 }),
    ];
    expect(moveCardToPage(layout, "a", 1).find((w) => w.id === "a")).toMatchObject({
      page: 1,
      x: 0,
      y: 0,
    });
  });

  it("does not carry the position over from the screen it came from", () => {
    // The position belonged to the other screen. Carrying it would drop the card
    // on top of whatever is at those cells over there.
    const layout = [
      widget("a", 2, 2, 0, { x: 2, y: 4 }),
      widget("c", 2, 2, 1, { x: 2, y: 4 }),
    ];
    expect(moveCardToPage(layout, "a", 1).find((w) => w.id === "a")).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it("leaves the card alone when it is already on that screen", () => {
    const layout = [widget("a", 2, 2, 1)];
    expect(moveCardToPage(layout, "a", 1)).toBe(layout);
  });

  it("clamps a screen that does not exist", () => {
    const layout = [widget("a", 2, 2, 0)];
    expect(moveCardToPage(layout, "a", 99).find((w) => w.id === "a")?.page).toBe(
      MAX_PAGES - 1,
    );
  });
});

describe("resizeCard", () => {
  it("makes a card bigger when there is room", () => {
    const layout = [
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
      widget("b", 2, 2, 0, { x: 2, y: 0 }),
    ];
    expect(resizeCard(layout, "a", { w: 3, h: 2 })[0]).toMatchObject({ w: 3, h: 2 });
  });

  it("keeps the card where it is and pushes the neighbour to the next row", () => {
    // A resize is a corner being pulled: the card does not move, it grows, and
    // whatever is under the new cells goes somewhere else. The old version
    // refused the resize, which is a corner that does nothing when pulled.
    const layout = [
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
      widget("b", 2, 2, 0, { x: 2, y: 0 }),
    ];
    const after = resizeCard(layout, "a", { w: 4, h: 2 });

    expect(after.find((w) => w.id === "a")).toMatchObject({ x: 0, y: 0, w: 4, h: 2 });
    expect(after.find((w) => w.id === "b")).toMatchObject({ x: 0, y: 2 });
  });

  it("never grows past the limit of a single card", () => {
    // The drag has no ceiling of its own — the finger can leave the screen — so
    // the clamp is in the arithmetic and not only in the corner.
    const layout = [widget("a", 2, 2, 0, { x: 0, y: 0 })];
    const grown = resizeCard(layout, "a", { w: 99, h: 99 });
    expect(grown[0]).toMatchObject({ w: MAX_CARD_COLUMNS, h: MAX_CARD_ROWS });
  });

  it("keeps the rest of the panel untouched when nothing had to move", () => {
    const layout = [
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
      widget("b", 2, 2, 0, { x: 2, y: 0 }),
    ];
    const after = resizeCard(layout, "a", { w: 2, h: 3 });
    expect(after[1]).toBe(layout[1]);
  });

  it("ignores a card that is on another screen when asking about room", () => {
    const layout = [
      widget("otra", 4, 4, 1, { x: 0, y: 0 }),
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
    ];
    expect(resizeCard(layout, "a", { w: 4, h: 4 })[1]).toMatchObject({
      w: 4,
      h: 4,
    });
  });

  it("writes down where the neighbours ended up, not just the card being grown", () => {
    // The invariant the module rests on. If the neighbour's new position were not
    // stored, it would be drawn one way and the next resize would move it again.
    const layout = [
      widget("a", 2, 2, 0, { x: 0, y: 0 }),
      widget("b", 2, 2, 0, { x: 2, y: 0 }),
    ];
    const after = resizeCard(layout, "a", { w: 4, h: 2 });

    expect(after.find((w) => w.id === "b")).toMatchObject({ x: 0, y: 2 });
    // Stored and drawn agree, which is the point.
    const drawn = pageCards(after).cards;
    expect(drawn.find((card) => card.id === "b")).toMatchObject({ x: 0, y: 2 });
  });
});

describe("sizeFromDrag", () => {
  const cell = { width: 40, height: 44, gap: 8 };

  it("keeps the size when the corner has not moved", () => {
    expect(sizeFromDrag({ w: 2, h: 2 }, 0, 0, cell)).toEqual({ w: 2, h: 2 });
  });

  /**
   * The whole point of the change.
   *
   * A corner that can stop anywhere is a corner you cannot aim: the card lands at
   * three and a half columns, which is not a size anybody chose and not a size the
   * next device can draw the same way.
   */
  it("only ever answers with a size from the list", () => {
    for (let dx = -400; dx <= 400; dx += 7) {
      for (let dy = -400; dy <= 400; dy += 7) {
        const size = sizeFromDrag({ w: 2, h: 2 }, dx, dy, cell);
        expect(CARD_SIZES, `${dx},${dy} dio ${size.w}x${size.h}`).toContainEqual(size);
      }
    }
  });

  it("grows a size per step dragged past the boundary", () => {
    // A step is the cell plus the gap before the next one, not the cell alone.
    // Sizing on the cell alone makes the first step cost a whole extra gap of
    // travel, and the card feels like it is fighting the finger.
    const stepX = cell.width + cell.gap;
    const stepY = cell.height + cell.gap;
    expect(sizeFromDrag({ w: 2, h: 2 }, stepX, 0, cell)).toEqual({ w: 3, h: 2 });
    expect(sizeFromDrag({ w: 2, h: 2 }, stepX * 2, 0, cell)).toEqual({ w: 4, h: 2 });
    expect(sizeFromDrag({ w: 2, h: 2 }, 0, stepY, cell)).toEqual({ w: 2, h: 3 });
  });

  it("does not step until the finger is past halfway to the next size", () => {
    // A little under half a cell of travel is not a step, and a little over it is.
    // `floor` here would make the card wait for a whole extra cell and feel stuck.
    // The margins are 0.45 and 0.55 rather than 0.49 and 0.51 because the travel
    // is whole points: on a forty-eight point step, 0.49 rounds to exactly the
    // half that `Math.round` sends up, and the test would be measuring its own
    // rounding.
    const stepX = cell.width + cell.gap;
    expect(sizeFromDrag({ w: 1, h: 1 }, Math.round(stepX * 0.45), 0, cell)).toEqual({ w: 1, h: 1 });
    expect(sizeFromDrag({ w: 1, h: 1 }, Math.round(stepX * 0.55), 0, cell)).toEqual({ w: 2, h: 1 });
  });

  it("shrinks a card when the corner is pulled back, and no further", () => {
    const stepX = cell.width + cell.gap;
    expect(sizeFromDrag({ w: 3, h: 2 }, -stepX, 0, cell)).toEqual({ w: 2, h: 2 });
    // All the way in, the card is the smallest one there is and not smaller. A
    // negative cell is a card that cannot be drawn.
    expect(sizeFromDrag({ w: 2, h: 2 }, -9999, -9999, cell)).toEqual({ w: 1, h: 1 });
  });

  it("never goes above four by four however far the corner is pulled", () => {
    expect(sizeFromDrag({ w: 2, h: 2 }, 9999, 9999, cell)).toEqual({
      w: MAX_CARD_COLUMNS,
      h: MAX_CARD_ROWS,
    });
  });

  it("does not divide by zero before the panel has been measured", () => {
    // The first frame, before the layout has come back. A card there must not
    // become NaN and vanish.
    expect(sizeFromDrag({ w: 2, h: 2 }, 40, 44, { width: 0, height: 0, gap: 0 })).toEqual({
      w: 2,
      h: 2,
    });
  });
});

describe("oneStepTowards", () => {
  /**
   * The reported bug, as a test.
   *
   * A fast finger asks for four sizes in one frame, and the ones it passes over
   * are computed, drawn and replaced inside that frame — measured at thirty-five
   * milliseconds and zero. So the drawn size may only move one cell per frame,
   * and this is the claim that a size can never be jumped over on the way to a
   * bigger one.
   */
  it("never moves more than a cell in a frame, however big the jump asked for", () => {
    let size = { w: 1, h: 1 };
    for (const want of [{ w: 4, h: 4 }, { w: 1, h: 1 }, { w: 4, h: 1 }, { w: 1, h: 4 }]) {
      const next = oneStepTowards(size, want);
      expect(Math.abs(next.w - size.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(next.h - size.h)).toBeLessThanOrEqual(1);
      size = next;
    }
  });

  it("arrives at the size asked for, a size at a time", () => {
    // Which is the point of the cap: the finger is still asking for four by four
    // and the card walks to it through the sizes in between rather than over them.
    const seen: string[] = [];
    let size = { w: 1, h: 1 };
    const want = { w: 4, h: 4 };
    for (let i = 0; i < 20; i += 1) {
      const next = oneStepTowards(size, want);
      if (next.w === size.w && next.h === size.h) break;
      const label = `${next.w}x${next.h}`;
      if (seen[seen.length - 1] !== label) seen.push(label);
      size = next;
    }
    expect(size).toEqual(want);
    expect(seen).toEqual(["2x2", "3x3", "4x4"]);
  });

  it("does not move a cell when the size has not changed", () => {
    expect(oneStepTowards({ w: 2, h: 3 }, { w: 2, h: 3 })).toEqual({ w: 2, h: 3 });
  });

  it("stays inside the sizes the panel can draw", () => {
    // A card of no columns is a card that cannot be drawn, and a card of five is
    // a card off the board. The clamp is in here rather than in the caller
    // because this is the last thing to touch the number.
    expect(oneStepTowards({ w: 1, h: 1 }, { w: 0, h: 0 })).toEqual({ w: 1, h: 1 });
    expect(oneStepTowards({ w: 4, h: 4 }, { w: 9, h: 9 })).toEqual({
      w: MAX_CARD_COLUMNS,
      h: MAX_CARD_ROWS,
    });
  });

  it("moves one cell per axis, not to the nearest size", () => {
    // Three rows sideways is not something a finger did, and a card that leaps
    // three rows for a sideways movement has a height nobody chose.
    expect(oneStepTowards({ w: 1, h: 1 }, { w: 2, h: 4 })).toEqual({ w: 2, h: 2 });
  });
});

describe("resizeStartSize", () => {
  /**
   * The reported bug, in the one place it can be checked without a finger.
   *
   * A drag adds the distance travelled to the size it started from. If the start
   * follows the size the drag is producing, the two compound and the card runs
   * away: measured, a hundred and ninety-eight points of drag took a one column
   * card to four columns, changing size three times in the thirty-three
   * milliseconds it took the finger to cover ten.
   */
  it("does not follow the size the drag is producing", () => {
    const held = { w: 1, h: 1 };
    // Every frame of that runaway: the card grew, and the start stayed put.
    for (const size of [
      { w: 2, h: 1 },
      { w: 3, h: 1 },
      { w: 4, h: 1 },
    ]) {
      expect(resizeStartSize(held, size, true)).toEqual(held);
    }
  });

  it("takes the card's size when no drag is on it", () => {
    // Otherwise a card that was resized once and then pushed around by its
    // neighbours would measure the next corner drag from a size that is old news.
    expect(resizeStartSize({ w: 1, h: 1 }, { w: 3, h: 2 }, false)).toEqual({ w: 3, h: 2 });
  });

  it("is what makes a drag pass through the sizes instead of over them", () => {
    // The whole thing end to end, in the arithmetic: a finger travelling in even
    // steps, the start frozen where the finger found it, and the cap on the frame.
    //
    // Asserted against the travel and not only against the order, because the cap
    // on its own produces the same order. The cap would have walked a runaway card
    // through one, two, three and four in the wrong frames — all four seen, all
    // four too late. What tells them apart is where the finger is when it gets
    // there: two hundred points of travel is a little past the second boundary, so
    // the answer is two columns wide, and a base that followed the drag answers
    // four.
    const c = { width: 167, height: 48, gap: 8 };
    const stepX = c.width + c.gap;
    const start = { w: 1, h: 1 };
    const widthAt = (travelled: number) => {
      let drawn = start;
      for (let dx = 0; dx <= travelled; dx += 10) {
        drawn = oneStepTowards(
          drawn,
          sizeFromDrag(resizeStartSize(start, drawn, true), dx, 0, c),
        );
      }
      return drawn;
    };

    expect(widthAt(Math.round(stepX * 0.5))).toEqual({ w: 1, h: 1 });
    expect(widthAt(Math.round(stepX * 1.5))).toEqual({ w: 2, h: 1 });
    expect(widthAt(200)).toEqual({ w: 2, h: 1 });
    expect(widthAt(Math.round(stepX * 2.5))).toEqual({ w: 3, h: 1 });
    expect(widthAt(Math.round(stepX * 3.5))).toEqual({ w: 4, h: 1 });
  });
});

describe("dropSpot", () => {
  const cell = { width: 40, height: 44, gap: 8 };
  const stepX = 48;
  const stepY = 52;
  /** The centre of a card of this size sitting at these cells. */
  const centreOf = (x: number, y: number, w = 2, h = 2) => ({
    x: x * stepX + (w * stepX) / 2,
    y: y * stepY + (h * stepY) / 2,
  });

  it("lands on the cell the card is over", () => {
    const others = [{ id: "a", x: 0, y: 0, w: 2, h: 2 }];
    expect(dropSpot(others, { w: 2, h: 2 }, centreOf(2, 2), cell)).toEqual({
      x: 2,
      y: 2,
    });
  });

  it("is measured by the card's centre and not by the finger", () => {
    // A card is held by its middle. If the answer came from the raw finger
    // position, the cell would change as the hand drifted inside the card it is
    // holding, and the card would shuffle about under a hand that had not moved
    // it. So: anywhere within the middle of a cell gives that cell.
    const empty: { id: string; x: number; y: number; w: number; h: number }[] = [];
    const middle = centreOf(0, 0);
    const nudged = { x: middle.x + stepX * 0.4, y: middle.y + stepY * 0.4 };

    expect(dropSpot(empty, { w: 2, h: 2 }, middle, cell)).toEqual({ x: 0, y: 0 });
    expect(dropSpot(empty, { w: 2, h: 2 }, nudged, cell)).toEqual({ x: 0, y: 0 });

    // And past the halfway mark of the next cell down, it does move on. Not to
    // the right: a four column grid of cards two wide has only three places
    // across, and asking for a fourth is not a cell.
    const nextCell = { x: middle.x, y: middle.y + stepY * 0.6 };
    expect(dropSpot(empty, { w: 2, h: 2 }, nextCell, cell)).toEqual({ x: 0, y: 1 });
  });

  it("goes to the nearest free cell when the one under the finger is taken", () => {
    // Pointed at the left half, which `a` holds. Just below it is two rows away
    // and free, so that is where it lands — the closest the grid allows, rather
    // than the first free cell on the screen.
    const others = [{ id: "a", x: 0, y: 0, w: 2, h: 2 }];
    expect(dropSpot(others, { w: 2, h: 2 }, centreOf(0, 0), cell)).toEqual({
      x: 2,
      y: 0,
    });
  });

  it("never leaves the screen", () => {
    const others: { id: string; x: number; y: number; w: number; h: number }[] = [];
    const spot = dropSpot(others, { w: 2, h: 2 }, { x: 9999, y: 9999 }, cell);
    expect(spot.x).toBeLessThanOrEqual(PANEL_COLUMNS - 2);
    expect(spot.y).toBeLessThanOrEqual(PANEL_ROWS - 2);
  });

  it("is the top-left before the panel has been measured", () => {
    // Before there is a cell there is no place to prefer, and the answer must not
    // be a NaN that draws nothing.
    expect(
      dropSpot([], { w: 2, h: 2 }, { x: 10, y: 10 }, { width: 0, height: 0, gap: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("never measures against the card being dragged", () => {
    // `others` is the screen *without* it. With the dragged card left in, the card
    // would always be sitting on itself and would slide to the next cell as the
    // finger crossed its own, which reads as the card dodging the hand.
    const empty: { id: string; x: number; y: number; w: number; h: number }[] = [];
    expect(dropSpot(empty, { w: 2, h: 2 }, centreOf(2, 2), cell)).toEqual({
      x: 2,
      y: 2,
    });
  });
});

describe("panelHeightInRows", () => {
  /**
   * The height of the grid container.
   *
   * This exists because of a bug that made the whole panel unusable and that no
   * other test could see. The cards are `position: absolute`, so they do not
   * count towards the height of the container holding them: it was zero tall, the
   * cards spilled out of it, and the "add a list" button that comes next in the
   * document was painted over them. The resize corner and the unpin button were
   * under that button, so `elementFromPoint` returned it and a tap there did
   * something else entirely. The panel looked approximately right and could not
   * be touched.
   */
  it("is as deep as the deepest card", () => {
    const placed = placeCardsOf([
      { id: "a", w: 2, h: 2 },
      { id: "b", w: 2, h: 2 },
    ]);
    expect(panelHeightInRows(placed)).toBe(2);
  });

  it("counts the card that hangs over the others", () => {
    const placed = placeCardsOf([
      { id: "a", w: 4, h: 2 },
      { id: "b", w: 2, h: 2 },
    ]);
    expect(panelHeightInRows(placed)).toBe(4);
  });

  it("is zero for a screen with nothing on it", () => {
    expect(panelHeightInRows([])).toBe(0);
  });

  it("turns into pixels without counting a gap that is not there", () => {
    // The last gap is not counted: there is nothing after the deepest card, and
    // counting it leaves a strip of empty page under every card.
    const cell = { height: 50, gap: 8 };
    expect(panelHeightInPixels([{ id: "a", x: 0, y: 0, w: 2, h: 2 }], cell)).toBe(108);
    expect(panelHeightInPixels([{ id: "a", x: 0, y: 0, w: 2, h: 3 }], cell)).toBe(166);
  });
});

describe("cardSize", () => {
  it("keeps a 1x1 card as a 1x1 card", () => {
    // The smallest size is a real one now, so a card saved at one cell is not
    // "repaired" into something bigger on the way in.
    expect(cardSize(widget("a", 1, 1))).toEqual({
      w: MIN_CARD_COLUMNS,
      h: MIN_CARD_ROWS,
    });
  });

  it("clamps a card saved from a bigger screen to a real size", () => {
    expect(cardSize(widget("a", 99, 99))).toEqual({
      w: MAX_CARD_COLUMNS,
      h: MAX_CARD_ROWS,
    });
  });
});
