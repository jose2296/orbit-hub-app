import { describe, expect, it } from 'vitest';

import {
  BOARD_SWIPE_DISTANCE,
  BOARD_SWIPE_VELOCITY,
  anchorableColumns,
  maxTrackScroll,
  nextPageFor,
  parallaxPage,
  trackContentWidth,
  trackRoomAt,
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

  /**
   * When the travel and the speed disagree, the travel wins here — and **that is
   * not the panel's rule**, so it is written out rather than attributed.
   *
   * `panel-grid.tsx:1434` reads `forward = abs(velocity) > 40 ? velocity < 0 :
   * travel < 0`: there **the velocity decides** whenever the finger is moving
   * faster than 40, and the travel only speaks once it has slowed down. This rule
   * is the other way round, and it is this one that is right for a board: the case
   * is a drag to the left whose last two fingers flick back to the right, the
   * finger has been to the left for the whole gesture, and paging backwards from
   * that would move the column away from where the finger has been.
   *
   * Both answers are defensible and only one of them is right here, which is
   * exactly why the difference is a test and not a footnote.
   */
  it('el travel manda sobre una velocidad que dice lo contrario', () => {
    expect(nextPageFor(-140, 600, 4, 1)).toBe(2);
    expect(nextPageFor(140, -600, 4, 2)).toBe(1);
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

  /**
   * A column the pager cannot anchor — which a tab tap can select on a wide board,
   * because `columnOffset` says the browser will clamp it and calls that correct —
   * comes back into the pager **before** it counts a step, and not after.
   *
   * Measured in the browser with five states at 1440, whose pager has two pages:
   * with the last state selected and a finger going **right**, clipping the answer
   * gave page 1 — the nearest page, but three columns *against* the finger. Taking
   * the step from the nearest page gives page 0, which is where the finger went.
   */
  it('una columna fuera del pager vuelve a el antes de contar el paso', () => {
    expect(nextPageFor(900, 0, 2, 4)).toBe(0);
    expect(nextPageFor(-900, 0, 2, 4)).toBe(1);
    // And with one page there is nowhere to step to, in either direction.
    expect(nextPageFor(900, 0, 1, 4)).toBe(0);
    expect(nextPageFor(-900, 0, 1, 4)).toBe(0);
  });
});

/**
 * How wide the row of columns is, and therefore how far the track can be dragged.
 *
 * **All of it in points, and that is the whole of what these three are for.** The
 * gesture asks where the ends of the board are, and it used to answer in columns
 * while the thing it was describing — a scroller — answers in points. The two are
 * the same count only when one column is visible, which is the one width where the
 * bug is invisible: with a single column `count - 1 - actual` columns of room times
 * the scroller's own maximum scroll *is* the room in points, and every measurement
 * taken at a 400-point window agreed with the broken version.
 */
describe('el ancho de la fila de columnas', () => {
  /**
   * One gap **between** two columns and not one after each, which is the term the
   * width arithmetic already learned once: `columnOffset` is `index * (width + gap)`
   * for the same reason, and the sum here is what the two of them have to agree on.
   */
  it('los huecos van entre columnas, no despues de cada una', () => {
    expect(trackContentWidth(1, 368, 12)).toBe(368);
    expect(trackContentWidth(2, 100, 10)).toBe(210);
    expect(trackContentWidth(4, 368, 12)).toBe(1508);
    expect(trackContentWidth(0, 368, 12)).toBe(0);
  });

  it('el desplazamiento maximo es lo que sobra, y nunca negativo', () => {
    // 4 x 368 + 3 x 12 = 1508 de contenido en una pista de 368.
    expect(maxTrackScroll(368, 1508)).toBe(1140);
    // Everything fits: there is nothing to drag and the answer is zero, not a
    // negative number that a rubber band would compare against.
    expect(maxTrackScroll(1120, 1120)).toBe(0);
    expect(maxTrackScroll(1120, 900)).toBe(0);
    expect(maxTrackScroll(1120, 0)).toBe(0);
  });
});

describe('el suelo de la banda elastica', () => {
  /**
   * **The literal case, and the one the broken version got wrong.** Five states,
   * four of them visible: `columnLayout(1120, 12)` gives four columns of 271, so
   * the content is `5 x 271 + 4 x 12 = 1403` in a track of 1120 and the scroller
   * has **283** points to give. The room to advance from the first column is
   * therefore 283.
   *
   * The broken version multiplied the *number of columns still off screen* by the
   * scroller's maximum scroll, which is four columns times 283 = **1132**: four
   * times too much, and the difference is exactly `1120 - 271 = 849`, the width of
   * the three columns that were already on screen beside the one being left.
   *
   * Measured in the browser before the fix, with this exact configuration:
   * `clientWidth` 1120, `scrollWidth` 1403, `scrollLeft - scrollWidth` giving a
   * maximum of 283, and a 300-point swipe from the second column moving the tab to
   * the third **with the board not moving at all**.
   */
  it('cinco estados y cuatro a la vista: el suelo es 283 y no 1132', () => {
    const maxScroll = maxTrackScroll(1120, trackContentWidth(5, 271, 12));
    expect(trackContentWidth(5, 271, 12)).toBe(1403);
    expect(maxScroll).toBe(283);

    const enLaPrimera = trackRoomAt(0, maxScroll);
    expect(enLaPrimera.roomLeft).toBe(0);
    expect(enLaPrimera.roomRight).toBe(283);
    // And explicitly not the count in columns, which is what produced 1132.
    expect(enLaPrimera.roomRight).not.toBe((5 - 1 - 0) * maxScroll);
  });

  /**
   * The room is read **from where the track is**, not from which column that is,
   * and that is the second half of the same bug: a floor that does not move with
   * the scroller is a floor that is right in one place and wrong in every other.
   *
   * Checked at three points of the same 283, and with the two halves adding up to
   * the whole at each — because the division by `EDGE_RESISTANCE` applies to the
   * *cushion* and not to the floor, and the only way that stays true is for the
   * two rooms to be two halves of one number rather than two independent guesses.
   */
  it('el suelo se mueve con la pista, y las dos mitades suman el maximo', () => {
    const maxScroll = 283;
    for (const at of [0, 1, 141, 282, 283]) {
      const room = trackRoomAt(at, maxScroll);
      expect(room.roomLeft).toBe(at);
      expect(room.roomRight).toBe(maxScroll - at);
      expect(room.roomLeft + room.roomRight).toBe(maxScroll);
    }
  });

  /**
   * The last column of that board has nothing to its right **and the second has
   * nothing at all to give forward**: at `scrollLeft` 283 the scroller is at its
   * maximum, so a swipe there cannot move the board however much room a count in
   * columns promised it.
   */
  it('al final de la pista no hay sitio hacia delante, por pequeno que sea', () => {
    const maxScroll = maxTrackScroll(1120, trackContentWidth(5, 271, 12));
    expect(trackRoomAt(maxScroll, maxScroll).roomRight).toBe(0);
    expect(trackRoomAt(maxScroll - 1, maxScroll).roomRight).toBe(1);
  });

  /**
   * A board of one column, and a board whose columns all fit, both have a floor of
   * zero in both directions — which is the whole answer for a track that cannot be
   * dragged: everything a finger does is resisted, so there is nothing to find out
   * by dragging.
   */
  it('una columna, o un tablero que cabe entero, no tienen suelo', () => {
    const uno = maxTrackScroll(368, trackContentWidth(1, 368, 12));
    expect(uno).toBe(0);
    expect(trackRoomAt(0, uno)).toEqual({ roomLeft: 0, roomRight: 0 });

    // Four states in 1120 is four columns of 271: everything fits.
    const cabe = maxTrackScroll(1120, trackContentWidth(4, 271, 12));
    expect(cabe).toBe(0);
  });

  /**
   * A scroller that reports a position outside its own range — which is what a
   * smooth scroll reports one frame after being asked to stop somewhere else, and
   * what a track that has not been measured reports at all — still gets two halves
   * of one number rather than one half that is negative and one that is bigger than
   * the whole.
   */
  it('una posicion fuera del rango se recorta antes de repartirse', () => {
    expect(trackRoomAt(-40, 283)).toEqual({ roomLeft: 0, roomRight: 283 });
    expect(trackRoomAt(900, 283)).toEqual({ roomLeft: 283, roomRight: 0 });
    for (const at of [-40, -1, 0, 283, 284, 900]) {
      const room = trackRoomAt(at, 283);
      expect(room.roomLeft + room.roomRight).toBe(283);
    }
  });

  /**
   * And the narrow case, where the broken version happened to be right, kept as a
   * test so that the fix cannot pass by being right there: four states one at a
   * time in a track of 368 give 1140 of scroll, which is `3 x 380` columns *and*
   * the scroller's own maximum. The two accounts agree here and only here.
   */
  it('con una columna a la vista los dos numeros coinciden, y siguen coincidiendo', () => {
    const maxScroll = maxTrackScroll(368, trackContentWidth(4, 368, 12));
    expect(maxScroll).toBe(1140);
    expect(trackRoomAt(0, maxScroll).roomRight).toBe((4 - 1 - 0) * (368 + 12));
    expect(trackRoomAt(380, maxScroll).roomLeft).toBe(380);
    expect(trackRoomAt(380, maxScroll).roomRight).toBe(760);
  });
});

/**
 * How many columns the track can be *anchored on*, which is not how many states
 * the list has.
 *
 * A wide track shows several columns at once and runs out of scroll long before it
 * runs out of states, so the last states of a board can never sit flush against
 * the left edge — which `columnOffset` already says in its own comment, and which
 * is correct for a tab tap and wrong for a swipe.
 *
 * **This is the third reading of a scroller that came off a column instead**, and
 * the same one as the floor: `count` here used to be the number of states, so a
 * swipe from the last column the scroller can reach asked for a page it has no
 * scroll for. Measured in the browser before the fix, five states and four visible:
 * the tab went to the third and the board did not move at all.
 */
describe('cuantas columnas se pueden anclar', () => {
  it('cinco estados y cuatro a la vista: solo dos se pueden anclar', () => {
    // maxScroll 283 and a column step of 283: the first column and the second.
    expect(anchorableColumns(5, 283, 283)).toBe(2);
    // The third would need 566 of scroll out of 283.
    expect(nextPageFor(-300, 0, anchorableColumns(5, 283, 283), 1)).toBe(1);
    // And the first one can still go forward.
    expect(nextPageFor(-300, 0, anchorableColumns(5, 283, 283), 0)).toBe(1);
    // And back.
    expect(nextPageFor(300, 0, anchorableColumns(5, 283, 283), 1)).toBe(0);
  });

  it('con una columna a la vista no cambia nada: los cuatro se anclan', () => {
    // maxScroll 1140 in steps of 380 is exactly three steps, so all four columns.
    expect(anchorableColumns(4, 1140, 380)).toBe(4);
    // Four pages means the last one is the fourth, and from there a forward swipe
    // stays where it is — the same answer the board gives when it has one column.
    expect(nextPageFor(-900, 0, anchorableColumns(4, 1140, 380), 3)).toBe(3);
    expect(nextPageFor(-900, 0, anchorableColumns(4, 1140, 380), 1)).toBe(2);
    expect(nextPageFor(900, 0, anchorableColumns(4, 1140, 380), 0)).toBe(0);
  });

  it('nunca mas que los estados que hay', () => {
    // A track that can scroll a long way does not invent columns.
    expect(anchorableColumns(3, 1140, 380)).toBe(3);
    expect(anchorableColumns(1, 1140, 380)).toBe(1);
  });

  it('un tablero que cabe entero tiene una sola columna anclable', () => {
    expect(anchorableColumns(4, 0, 283)).toBe(1);
    expect(anchorableColumns(5, 0, 283)).toBe(1);
    // And a swipe on it goes nowhere, which is why the gesture is not enabled.
    expect(nextPageFor(-900, 0, anchorableColumns(4, 0, 283), 0)).toBe(0);
  });

  /**
   * A track that stops ten points short of the next column has not got that
   * column: the count is by whole steps and not by points, or a track whose
   * maximum scroll lands between two columns would claim it can anchor the second
   * one while the browser refuses to go there.
   */
  it('cuenta pasos enteros, no puntos sueltos', () => {
    expect(anchorableColumns(6, 282, 283)).toBe(1);
    expect(anchorableColumns(6, 283, 283)).toBe(2);
    expect(anchorableColumns(6, 566, 283)).toBe(3);
  });

  it('sin paso medido no se descarta ninguna columna', () => {
    // The width is zero until it has been measured, and a track in that state is
    // not drawn, so nothing may be ruled out on the strength of a zero.
    expect(anchorableColumns(5, 0, 0)).toBe(5);
    expect(anchorableColumns(5, 283, 0)).toBe(5);
    expect(anchorableColumns(0, 283, 283)).toBe(0);
  });
});

/**
 * The travel that counts as a whole page of parallax for the tab strip.
 *
 * **The parallax has to stay behind the board, and with a column's step as the
 * unit it does not.** The strip moves `progress * stripWidth * 0.35`, so against a
 * step of one column the ratio of strip travel to board travel is
 * `0.35 * stripWidth / step` — which is 0.34 on a phone, where the strip and the
 * column are both 368, and **1.39 on a wide track**, where the strip is 1120 wide
 * and the step is 283. Measured there: a 275-point drag moved the columns 275 and
 * the pills 381.
 *
 * So the page is the **larger** of the two, which keeps the factor meaning what it
 * says — a third of the board's travel, or a third of the strip's width, whichever
 * binds first — and never lets the strip outrun the board it is supposed to be
 * showing where is going.
 */
describe('la pagina del paralaje', () => {
  it('en un ancho estrecho manda el paso de columna', () => {
    expect(parallaxPage(380, 368)).toBe(380);
  });

  it('en un ancho ancho manda el ancho de la tira', () => {
    const page = parallaxPage(283, 1120);
    expect(page).toBe(1120);
    // 275 puntos de pista dan 275/1120 = 0.2455, y 0.2455 * 1120 * 0.35 = 96.25,
    // que es **exactamente el 35% de los 275**: la tira va por detras y no por
    // delante, que es lo que pasaba con el paso de columna como unidad.
    expect(Math.min(1, 275 / page) * 1120 * 0.35).toBe(96.25);
  });

  it('con las dos medidas a cero no hay pagina y no hay paralaje', () => {
    expect(parallaxPage(0, 0)).toBe(0);
  });
});
