import { describe, expect, it } from 'vitest';

import {
  BOARD_SWIPE_DISTANCE,
  BOARD_SWIPE_VELOCITY,
  nextPageFor,
} from '../src/lib/lists/board-paging';

/**
 * Which column a swipe lands on, as a pure function.
 *
 * The numbers in here are the ones `panel-grid.tsx` decides its page turns with —
 * 56 points of travel or 420 of speed — and they are not re-measured because the
 * gesture is the same gesture: a finger crossing a screen sideways to change what
 * the screen is showing. The panel's pager works on three targets and these are
 * its measured numbers, so a second copy with its own figures would be two
 * answers to one question.
 */

describe('a donde cae la pagina', () => {
  it('un arrastre corto y lento no cambia de pagina', () => {
    // If a short touch moved the page, touching a card near the edge would take
    // you to another column and nobody would know why.
    expect(nextPageFor(-20, -60, 4, 1)).toBe(1);
  });

  it('un arrastre largo o rapido avanza una sola vez', () => {
    expect(nextPageFor(-140, 0, 4, 1)).toBe(2);
    expect(nextPageFor(-20, -600, 4, 1)).toBe(2);
    // And never more than one, however long the drag.
    expect(nextPageFor(-900, -2000, 4, 1)).toBe(2);
  });

  it('no se sale por los extremos', () => {
    expect(nextPageFor(-900, 0, 4, 3)).toBe(3);
    expect(nextPageFor(900, 0, 4, 0)).toBe(0);
  });
});

describe('la direccion del arrastre', () => {
  /**
   * The direction is the finger's, and a finger going **left** is the one that
   * goes to the next column: the columns are drawn left to right in the order of
   * the array, so dragging the track left pulls the next column in from the right.
   *
   * Written down because the sign is the one thing in this function that is not
   * visible in its own arithmetic, and getting it backwards is a board that pages
   * the wrong way while every test that only asks "did it move?" still passes.
   */
  it('arrastrar a la izquierda avanza y a la derecha retrocede', () => {
    expect(nextPageFor(-140, 0, 4, 1)).toBe(2);
    expect(nextPageFor(140, 0, 4, 2)).toBe(1);
  });

  it('un movimiento sin travel decide con la velocidad', () => {
    // A flick that ends up where it started is still a flick, and a finger that
    // has come to a stop is not: the second one is somebody pressing and letting
    // go, and the travel of zero is what says so.
    expect(nextPageFor(0, -600, 4, 1)).toBe(2);
    expect(nextPageFor(0, 600, 4, 1)).toBe(0);
    expect(nextPageFor(0, 0, 4, 1)).toBe(1);
  });
});

describe('los umbrales', () => {
  it('los dos son los del panel y se leen del modulo', () => {
    // Both, and either is enough — the panel's rule, not a new one. 56 is a third
    // of the column a finger has to cross on a phone and 420 is a flick.
    expect(BOARD_SWIPE_DISTANCE).toBe(56);
    expect(BOARD_SWIPE_VELOCITY).toBe(420);
  });

  it('el exacto cuenta, y uno menos no', () => {
    expect(nextPageFor(-BOARD_SWIPE_DISTANCE, 0, 4, 1)).toBe(2);
    expect(nextPageFor(-(BOARD_SWIPE_DISTANCE - 1), 0, 4, 1)).toBe(1);
    expect(nextPageFor(0, -BOARD_SWIPE_VELOCITY, 4, 1)).toBe(2);
    expect(nextPageFor(0, -(BOARD_SWIPE_VELOCITY - 1), 4, 1)).toBe(1);
  });

  it('los dos numeros son parametros, y por eso se pueden medir otros', () => {
    expect(nextPageFor(-20, -60, 4, 1, 10, 420)).toBe(2);
    expect(nextPageFor(-20, -60, 4, 1, 56, 30)).toBe(2);
  });
});

describe('un tablero que no tiene a donde ir', () => {
  it('una sola columna se queda donde esta, y da igual el arrastre', () => {
    expect(nextPageFor(-900, -2000, 1, 0)).toBe(0);
    expect(nextPageFor(900, 2000, 1, 0)).toBe(0);
  });

  /**
   * Zero columns answers **zero and never a negative number**, and the reason is
   * the caller: this value is used as an index, and an index of `-1` scrolls a
   * track to a negative offset and leaves a board showing a column that is not
   * there. A board with no columns cannot be swiped at all — the screen draws the
   * empty state instead of the track — so nothing gets here in the app; the number
   * is still pinned because it is the answer that cannot be wrong, and the clamp
   * that also produces it is arithmetic rather than a promise.
   */
  it('cero columnas no sale del rango', () => {
    expect(nextPageFor(-900, -2000, 0, 0)).toBe(0);
    expect(nextPageFor(900, 2000, 0, 0)).toBe(0);
    expect(nextPageFor(0, 0, 0, 0)).toBe(0);
  });

  it('un numero de columnas negativo tampoco', () => {
    expect(nextPageFor(-900, 0, -2, 0)).toBe(0);
  });

  it('una columna actual fuera del rango vuelve al rango', () => {
    // What a caller that passes the count of a board it has not finished reading
    // gets: the answer is inside the columns, not outside them.
    expect(nextPageFor(-900, 0, 4, 9)).toBe(3);
    expect(nextPageFor(900, 0, 4, -4)).toBe(0);
  });
});
