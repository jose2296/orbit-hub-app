import { describe, expect, it } from "vitest";

import { DEFAULT_LAYOUT, normaliseLayout } from "../src/lib/dashboard/layout";

/**
 * Reading a panel that arrived from another device.
 *
 * The panel is a list of cards with a size in grid cells, and it comes out of
 * the cache written by an older build, out of a payload a client sent with
 * nothing it did not know, and out of nothing at all. None of those is a reason
 * to leave a person's panel blank: what cannot be read is left out and the rest
 * stays.
 */
describe("normaliseLayout", () => {
  it("returns an empty panel for rubbish input", () => {
    expect(normaliseLayout(null)).toEqual([]);
    expect(normaliseLayout("nope")).toEqual([]);
    expect(normaliseLayout(42)).toEqual([]);
  });

  it("drops cards that fail validation", () => {
    const result = normaliseLayout([
      { id: "ok", kind: "recent_lists", x: 0, y: 0, w: 6, h: 4, pinned: false },
      { id: "roto", kind: "not-a-kind", x: 0, y: 0, w: 6, h: 4, pinned: false },
      { kind: "recent_lists", x: 0, y: 0, w: 6, h: 4, pinned: false },
    ]);

    expect(result.map((widget) => widget.id)).toEqual(["ok"]);
  });

  it("reads a card that has no pinned flag, because it was written before one", () => {
    const [card] = normaliseLayout([
      { id: "a", kind: "recent_lists", x: 0, y: 0, w: 6, h: 4 },
    ]);
    expect(card?.pinned).toBe(false);
  });

  it("drops two cards with the same identifier", () => {
    // The identifier is what says which card it is and what a drag moves, and
    // two cards that answer to the same one are two cards that move together.
    const result = normaliseLayout([
      { id: "a", kind: "recent_lists", x: 0, y: 0, w: 6, h: 4, pinned: false },
      { id: "a", kind: "recent_lists", x: 0, y: 0, w: 3, h: 2, pinned: false },
    ]);
    expect(result).toHaveLength(1);
  });

  it("does not change the panel it is given", () => {
    const input = [
      { id: "a", kind: "recent_lists", x: 0, y: 0, w: 6, h: 4, pinned: false },
    ];
    const before = JSON.stringify(input);
    normaliseLayout(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("the panel of a new person", () => {
  it('starts empty, because a card that says "recent lists" is about the app', () => {
    // It used to start with four widgets of its own, which made the panel a page
    // about the app instead of about the person's day.
    expect(DEFAULT_LAYOUT).toEqual([]);
  });
});
