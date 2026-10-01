import { describe, expect, it } from "vitest";

import { dropIndex, rowShift } from "@/lib/lists/drag-shift";

const ALTO = 90;

describe("rowShift", () => {
  it("does not move anything when there is no drag", () => {
    for (let index = 0; index < 5; index += 1) {
      expect(rowShift({ draggingId: null, id: `r${index}`, index, from: 1, to: 3, rowHeight: ALTO })).toBe(0);
    }
  });

  it("does not move the row that is being dragged", () => {
    // The dragged row follows the finger. If it also stepped aside, the hole
    // would be in the wrong place and the drop would be a row off.
    expect(
      rowShift({ draggingId: "a", id: "a", index: 1, from: 1, to: 4, rowHeight: ALTO }),
    ).toBe(0);
  });

  it("moves nothing when the row has not passed anything", () => {
    expect(
      rowShift({ draggingId: "a", id: "c", index: 4, from: 1, to: 3, rowHeight: ALTO }),
    ).toBe(0);
  });

  it("opens the hole going down, one row at a time", () => {
    // Dragging row 1 to row 4: rows 2, 3 and 4 move up, and nothing else.
    const mueve = (index: number) =>
      rowShift({ draggingId: "a", id: `r${index}`, index, from: 1, to: 4, rowHeight: ALTO });

    expect([0, 1, 2, 3, 4, 5].map(mueve)).toEqual([0, 0, -ALTO, -ALTO, -ALTO, 0]);
  });

  it("opens the hole going up", () => {
    // Dragging row 4 up to row 1: rows 1, 2 and 3 move down, and 1 is the
    // landing place — the row the dragged one is about to take. It moves too,
    // or the hole would be one row above where the row actually lands.
    const mueve = (index: number) =>
      rowShift({ draggingId: "a", id: `r${index}`, index, from: 4, to: 1, rowHeight: ALTO });

    expect([0, 1, 2, 3, 4, 5].map(mueve)).toEqual([0, ALTO, ALTO, ALTO, 0, 0]);
  });

  it("moves exactly one row per row of travel, no more and no less", () => {
    // The hole is one row big and the row that goes in it is one row away, so
    // the number of rows that move is the distance travelled. One off in either
    // direction and the list ends up a row longer or a row shorter than it was.
    const cuantos = (from: number, to: number) =>
      Array.from({ length: 6 }, (_, index) => index).filter(
        (index) =>
          rowShift({ draggingId: "a", id: `r${index}`, index, from, to, rowHeight: ALTO }) !== 0,
      ).length;

    for (const distancia of [1, 2, 3, 4]) {
      expect(cuantos(0, distancia), `bajando ${distancia}`).toBe(distancia);
      expect(cuantos(5, 5 - distancia), `subiendo ${distancia}`).toBe(distancia);
    }
  });

  it("moves the row just past the landing place, and no further", () => {
    // One row down: only the row immediately below moves. Two rows down: two.
    expect(
      rowShift({ draggingId: "a", id: "b", index: 1, from: 0, to: 1, rowHeight: ALTO }),
    ).toBe(-ALTO);
    expect(
      rowShift({ draggingId: "a", id: "c", index: 2, from: 0, to: 1, rowHeight: ALTO }),
    ).toBe(0);
  });

  it("moves nothing when the drag has not gone anywhere", () => {
    expect(
      rowShift({ draggingId: "a", id: "b", index: 1, from: 0, to: 0, rowHeight: ALTO }),
    ).toBe(0);
  });

  it("uses the measured height, so the hole is the height of the row", () => {
    // A row with a label under the name is taller: with a fixed height the hole
    // is the wrong size and the drop lands between rows.
    expect(
      rowShift({ draggingId: "a", id: "b", index: 1, from: 0, to: 1, rowHeight: 97 }),
    ).toBe(-97);
  });
});

describe("dropIndex", () => {
  it("stays put when the finger has not moved a whole row", () => {
    expect(dropIndex({ index: 2, total: 10, translationY: 40, rowHeight: ALTO })).toBe(2);
  });

  it("moves one row per row of travel", () => {
    expect(dropIndex({ index: 2, total: 10, translationY: ALTO, rowHeight: ALTO })).toBe(3);
    expect(dropIndex({ index: 2, total: 10, translationY: ALTO * 2.4, rowHeight: ALTO })).toBe(4);
    expect(dropIndex({ index: 2, total: 10, translationY: -ALTO * 1.2, rowHeight: ALTO })).toBe(1);
  });

  it("does not go past either end", () => {
    // Dragging the top row up has nowhere to go, and a row that wrapped to the
    // bottom would look like the list had done it on its own.
    expect(dropIndex({ index: 0, total: 10, translationY: -900, rowHeight: ALTO })).toBe(0);
    expect(dropIndex({ index: 9, total: 10, translationY: 900, rowHeight: ALTO })).toBe(9);
  });

  it("does not divide by zero when the height has not been measured", () => {
    expect(dropIndex({ index: 1, total: 3, translationY: 40, rowHeight: 0 })).toBe(2);
  });
});

/**
 * The number these two functions want is the **distance between rows**, and the
 * difference is not academic.
 *
 * A sheet of sixty-point rows with four points of space between them has a pitch
 * of sixty-four, and after a thousand points of drag the two numbers disagree by a
 * whole row. The row is over the seventeenth, the hole opened at the sixteenth, and
 * the row is pulled back to where the data says it is — which is the bounce that
 * made the drag look broken.
 *
 * So this is a test of the arithmetic *with the real pitch*, and it is here
 * because the number is measured in the component and the mistake was in the
 * caller: both versions of it pass, and the one that used a bare height is the one
 * that was wrong.
 */
describe("the pitch of a list, and not its height", () => {
  const ALTO = 60;
  const HUECO = 4;
  const PASO = ALTO + HUECO;

  it("agrees with the height for a short drag, which is why the bug hid", () => {
    // Under about two hundred points the two round to the same index, so a drag
    // that does not go far works perfectly and a drag that goes the length of the
    // list does not. That is the worst shape this kind of bug can have.
    expect(dropIndex({ index: 0, total: 20, translationY: 100, rowHeight: PASO })).toBe(
      dropIndex({ index: 0, total: 20, translationY: 100, rowHeight: ALTO }),
    );
  });

  it("is a row out after a long drag, and the hole is not where the row is", () => {
    const conPaso = dropIndex({ index: 0, total: 20, translationY: 1000, rowHeight: PASO });
    const conAltura = dropIndex({ index: 0, total: 20, translationY: 1000, rowHeight: ALTO });
    expect(conPaso).toBe(16);
    expect(conAltura).toBe(17);
  });

  it("makes the rows step aside by the pitch and not by their own height", () => {
    // Two rows four points apart that move four points apart leave a four-point
    // sliver between them while the drag is on: the hole is open and the row does
    // not fit it.
    expect(
      rowShift({ draggingId: "a", id: "b", index: 1, from: 0, to: 1, rowHeight: PASO }),
    ).toBe(-PASO);
  });
});
