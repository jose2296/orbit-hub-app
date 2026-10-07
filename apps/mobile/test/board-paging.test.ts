import { describe, expect, it } from 'vitest';

import {
  BOARD_SCROLL_REST_SLACK,
  BOARD_SWIPE_DISTANCE,
  BOARD_SWIPE_VELOCITY,
  anchorableColumns,
  columnForScrollEnd,
  maxTrackScroll,
  nextPageFor,
  parallaxPage,
  scrollTargetFor,
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

  /**
   * **The literal entry that was wrong, with both numbers spelled out.**
   *
   * A track of 728 with four columns and a gap of 12 gives a column of
   * `246.66666666666666`, and a content of four of them plus three gaps gives a
   * maximum scroll of `246.66666666666663` — the same number written two ways. The
   * quotient is `0.9999999999999999` where the algebra says exactly `1`, so
   * `floor` answered **1** and there was only one page on a board with two.
   *
   * The consequence was not a number that looked odd: with the pager one page
   * short, `nextPageFor` clamped the answer to the current page, the re-base asked
   * for `offsets[0]`, the scroller was told to go where it already was, and **the
   * swipe did nothing with the next column, which was on screen and could be
   * reached**. Sweeping widths from 300 to 1800 with two to twelve states, that was
   * 1208 of 7801 on a wide track.
   */
  it('el mismo numero escrito de dos maneras no pierde una pagina', () => {
    expect(246.66666666666663 / 246.66666666666666).toBeCloseTo(1, 15);
    // Below one in the last bits, and `floor` of it is zero.
    expect(246.66666666666663 / 246.66666666666666).toBeLessThan(1);
    expect(Math.floor(246.66666666666663 / 246.66666666666666)).toBe(0);

    expect(anchorableColumns(4, 246.66666666666663, 246.66666666666666)).toBe(2);

    /**
     * **And four more of the same shape, with both numbers written out.**
     *
     * The first number of each row is what `columnLayout` gives for that track with
     * a gap of 12 — 1199 is five columns of `230.2`, 1792 is seven of
     * `245.71428571428572` — **and the second is that same double multiplied by
     * three, which is the whole of why the quotient lands under 3.** Doubling a
     * double is exact, so one, two and four steps divide back exactly on all 1801
     * tracks from 300 to 1800; three is the first whole count that rounds, and it
     * rounds down on **43** of them, which are four of:
     *
     * | pista | paso de `columnLayout` | `3 × paso` | cociente |
     * | --- | --- | --- | --- |
     * | 1199 | `230.2` | `690.5999999999999` | `2.99999999999999956` |
     * | 1204 | `231.2` | `693.5999999999999` | `2.99999999999999956` |
     * | 1209 | `232.2` | `696.5999999999999` | `2.99999999999999956` |
     * | 1792 | `245.71428571428572` | `737.1428571428571` | `2.99999999999999956` |
     *
     * **It is not a board's own scroll, and the difference is the gap.** What the
     * screen hands this function is a `maxScroll` — the content less the track — and
     * a step of `columnOffset(1, …)`, which is `paso + 12` and not `paso`. **No
     * board has a `maxScroll` bit-equal to `3 × paso`: 0 of 34523**, sweeping track
     * widths 300 to 1800 with two to twenty-four states, so the second number above
     * is the arithmetic and not a measurement and must not be read as one. A board
     * that loses this page writes both numbers the way the screen writes them —
     * track 722 with seven states is three columns of `232.66666666666666`, a
     * `maxScroll` of `978.6666666666665`, a step of `244.66666666666666` and a
     * quotient of `3.9999999999999996`, and **205 of the 1208 wide-track boards of
     * the sweep on `anchorableColumns` lose exactly this one step.** Same boundary,
     * same last bits.
     *
     * `floor` of any of the four rows is 2, so without the margin the pager answers
     * **3** where it should answer **4**, and all four die on their own with the
     * margin taken away — though in this suite the literal entry above dies first,
     * at line 391, and the loop is never reached.
     */
    for (const [paso, tresPasos] of [
      [230.2, 690.5999999999999],
      [231.2, 693.5999999999999],
      [232.2, 696.5999999999999],
      [245.71428571428572, 737.1428571428571],
    ] as [number, number][]) {
      expect(tresPasos / paso, `el cociente de ${paso}`).toBeLessThan(3);
      expect(Math.floor(tresPasos / paso), `el suelo de ${paso}`).toBe(2);
      expect(
        anchorableColumns(8, tresPasos, paso),
        `un paso de ${paso} y un recorrido de ${tresPasos}`,
      ).toBe(4);
    }
  });

  /**
   * **And the tolerance may not swallow a real gap**, which is the half of it that
   * has to be written down or the margin becomes a way of losing columns on purpose.
   *
   * A track that stops half a point short of a column is `3.5e-3` of a step away —
   * three and a half million times further out than the margin — and it is still not
   * that column. Half a point is not a number anybody chose for this test: it is
   * what a rounding of a measured width can plausibly be.
   */
  it('el margen no se come un hueco de verdad', () => {
    expect(anchorableColumns(6, 283 - 0.5, 283)).toBe(1);
    expect(anchorableColumns(6, 283 - 0.01, 283)).toBe(1);
    // And just above a whole step it takes it, which is the other side of the same
    // boundary: a margin that only ever rounds down would not be a rounding.
    expect(anchorableColumns(6, 283 + 0.01, 283)).toBe(2);
    expect(anchorableColumns(6, 283 * 3 - 0.5, 283)).toBe(3);
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

/**
 * A drag that never travelled far enough to count changes nothing.
 *
 * **And the case that needs it is a board where the pager is shorter than the
 * states**, because that is the only place where the clamp and the step can
 * disagree: with `current` inside the pager, `Math.min(last, current)` is `current`
 * and `+ 0` changes nothing whatever. With five states and two pages, `current` of 4
 * is outside, the clamp answers 1, and a gesture that moved the board four points
 * took the tab from the fifth state to the second.
 *
 * Measured in the browser at 1440 before this: a 20-point drag — which is past the
 * 14 of `activeOffsetX` and so activates the gesture, and far short of the 56 that
 * counts — with the fifth state selected, and the tab moved to the second while
 * `scrollLeft` did not move at all.
 */
describe('un arrastre que no cuenta no mueve nada', () => {
  it('dentro del paginador, ni el mas corto cambia la pagina', () => {
    expect(nextPageFor(0, 0, 4, 2)).toBe(2);
    expect(nextPageFor(20, 0, 4, 2)).toBe(2);
    expect(nextPageFor(-20, 0, 4, 2)).toBe(2);
    expect(nextPageFor(0, 100, 4, 2)).toBe(2);
  });

  it('fuera del paginador tampoco, y ese es el que lo necesita', () => {
    // Cinco estados, dos paginas, el quinto estado elegido con una pestana.
    expect(anchorableColumns(5, 283, 283)).toBe(2);
    // Por debajo del umbral de distancia y sin velocidad.
    expect(nextPageFor(-20, 0, 2, 4)).toBe(4);
    expect(nextPageFor(20, 0, 2, 4)).toBe(4);
    expect(nextPageFor(0, 0, 2, 4)).toBe(4);
    // Y por debajo del umbral de velocidad, que es el otro brazo del "o".
    expect(nextPageFor(0, 419, 2, 4)).toBe(4);
    expect(nextPageFor(0, -419, 2, 4)).toBe(4);
    // Justo en el umbral ya cuenta, y entra al paginador por el lado del dedo.
    expect(nextPageFor(-56, 0, 2, 4)).toBe(1);
    expect(nextPageFor(56, 0, 2, 4)).toBe(0);
  });

  /**
   * **The one that has no answer: a page is an index, and a caller that has not read
   * the board yet passes a negative one.** A drag of nothing returns it as it came,
   * because the drag did nothing, and the index it returns is the index it was
   * given. That is deliberate and it is written down: the caller here is a screen
   * that holds `actual`, and `actual` starts at 0.
   */
  it('una columna negativa que no se mueve se devuelve tal cual', () => {
    expect(nextPageFor(0, 0, 4, -4)).toBe(-4);
    // Y una que si se mueve vuelve al rango, porque ya es un paso y un paso se
    // recorta al paginador.
    expect(nextPageFor(-900, 0, 4, -4)).toBe(0);
  });
});

/**
 * Where the scroller is actually put, which is not always where the column asked for.
 *
 * **The invariant this exists to protect is the re-base's**, and it is one line:
 * `settle` charges the transform a displacement of `objetivo - scrollPrevio`, which
 * is only true if the scroller moves by exactly that. **The browser clips the
 * scroll** when `objetivo` is past the end and the scroller then moves by **less**
 * than the transform was charged, and nothing gives the difference back.
 */
describe('donde acaba el scroller, que no es donde pedia la columna', () => {
  /**
   * **The literal case, with every number written out.**
   *
   * 1440 wide, five states, four columns of 271 in a track of 1120: `offsets`
   * `[0, 283, 566, 849, 1132]` and `maxScroll` 283. `anchorableColumns(5, 283, 283)`
   * is **2**, so only the first two columns are pages — and the fifth state's tab
   * puts the scroller at its maximum of 283.
   *
   * A 20-point drag from there — which does not count, so `nextPageFor` answers the
   * fifth state itself — and its offset of **1132** is three columns past what the
   * scroller has. Clipped it is **283**, which is where the scroller already is, so
   * the re-base is **0** and the track springs home from the six points the finger
   * left. Unclipped the transform is charged **849** it will never get back.
   *
   * Measured in the browser before the clip: `trackX` at **848** on the first frame
   * and zero **285 ms** later, on a gesture that had to do nothing.
   */
  it('cinco estados a lo ancho: la quinta columna se recorta a 283', () => {
    const offsets = [0, 283, 566, 849, 1132];
    const maxScroll = 283;
    expect(anchorableColumns(5, maxScroll, 283)).toBe(2);
    // La quinta columna elegida con una pestana: la respuesta es ella misma.
    const next = nextPageFor(-20, 0, 2, 4);
    expect(next).toBe(4);
    // El indice se lee con `??` por `noUncheckedIndexedAccess`, y aqui lo que
    // se lee es el numero del caso y no su ausencia.
    const destino = offsets[next] ?? -1;
    expect(destino).toBe(1132);

    // Y el scroller, en su maximo, se queda ahi.
    expect(scrollTargetFor(destino, 283, maxScroll)).toBe(283);
    // El rebasing con el recorte es cero; sin el recorte serian 849 puntos.
    expect(destino - 283).toBe(849);
  });

  it('una columna alcanzable no se toca, que es lo que se quiere decir con recortarla', () => {
    const offsets = [0, 380, 760, 1140, 1520];
    const maxScroll = 1520;
    for (const next of [0, 1, 2, 3]) {
      const destino = offsets[next] ?? -1;
      expect(scrollTargetFor(destino, destino, maxScroll)).toBe(destino);
    }
    // Y con el scroller en otro sitio, que es lo que pasa al interrumpir un scroll.
    expect(scrollTargetFor(offsets[2], 380, maxScroll)).toBe(760);
    expect(scrollTargetFor(offsets[0], 1520, maxScroll)).toBe(0);
  });

  it('por debajo de cero es cero, porque un scroll negativo no es una posicion', () => {
    expect(scrollTargetFor(-40, 100, 283)).toBe(0);
    // Y con el scroller ya en cero y un destino negativo, sigue en cero.
    expect(scrollTargetFor(-1, 0, 283)).toBe(0);
  });

  it('un destino desconocido es donde esta el scroller, que es no ir a ningun sitio', () => {
    // Las columnas todavia no medidas dan `undefined` en el array de offsets.
    expect(scrollTargetFor(undefined, 283, 283)).toBe(283);
    expect(scrollTargetFor(undefined, 0, 283)).toBe(0);
  });

  it('un destino que no es un numero es donde esta el scroller tambien', () => {
    // Una anchura sin medir es `NaN`, y `Math.min` con `NaN` devuelve `NaN`, que
    // un `scrollTo` se come como si fuera cero sin decir nada.
    expect(scrollTargetFor(Number.NaN, 283, 283)).toBe(283);
    expect(scrollTargetFor(Number.POSITIVE_INFINITY, 283, 283)).toBe(283);
    expect(scrollTargetFor(Number.NEGATIVE_INFINITY, 283, 283)).toBe(283);
  });

  it('un recorrido maximo sin medir es cero, y no un NaN que se cuela en el scroll', () => {
    expect(scrollTargetFor(380, 0, Number.NaN)).toBe(0);
    expect(scrollTargetFor(380, 283, Number.NaN)).toBe(283);
    // Y un maximo negativo es cero, no un scroll hacia atras.
    expect(scrollTargetFor(380, 283, -50)).toBe(283);
  });

  /**
   * **And it is not `Math.min` alone**, which is the version that looks right and
   * is not: it leaves a negative offset alone, and the whole of the below-zero case
   * is that a negative scroll is not a position.
   */
  it('recorta por los dos lados y no solo por arriba', () => {
    expect(scrollTargetFor(-100, 0, 1520)).toBe(0);
    expect(scrollTargetFor(99999, 0, 1520)).toBe(1520);
    expect(scrollTargetFor(760, 0, 1520)).toBe(760);
  });

  /**
   * **And the scroller's own position is clipped, which is the half that was
   * missing.**
   *
   * `scrollPrevio` is what the re-base subtracts, and `irA` wrote the offset a tab
   * asked for into it before asking for the scroll. **react-native-web does
   * `node.scroll({left})`, which clips to the maximum, and a scroll that changes
   * nothing fires no event** — so with the track already at its end, `onScroll`
   * never came to correct it and `scrollPrevio` stayed ahead of the scroller for as
   * long as that tab was selected.
   *
   * Measured in the browser at 1440 x 900 with five states and one long column on
   * the left: a track of **1120** of content **1403**, so `maxScroll` is **283** and
   * `offsets` is `[0, 283, 566, 849, 1132]`. The gesture that reaches the broken
   * state is three steps **in this order** — drag the track left until `scrollLeft`
   * is **283**, its real end; tap the fifth state's tab, the one at **1132**, which
   * the scroller cannot anchor; drag twenty points, far below the 56 that counts.
   *
   * **The order is the whole of it**, because the tap's `scrollTo` of **1132** is
   * clipped by the browser from **283** to **283**: it changes nothing, it fires no
   * event, and `onScroll` never puts `scrollPrevio` back. Five repetitions each:
   *
   * | | clipped | not clipped |
   * | --- | --- | --- |
   * | `scrollPrevio` after the tab tap | **283** | **1132** |
   * | scroll events the tab tap fired | **0** | **0** |
   * | re-base at the settling | **0** | **−849** |
   *
   * The same three steps from the **first** column are the control, and they are
   * why five repetitions of the earlier protocols saw nothing with the bug alive:
   * there the scroll really goes from **0** to **283**, which fires **12 to 15**
   * events, and they correct `scrollPrevio` before the finger arrives.
   *
   * **Not measured: the length of the spring in either run.**
   * `lib/lists/board-paging.ts` says so next to the line, and says what the formula
   * would give instead. Nothing here ran on native.
   */
  it('la posicion del scroller tambien se recorta, que es la otra mitad del rebase', () => {
    // Cuarenta puntos mas alla de su maximo. **No es un valor que la pantalla
    // pueda dejar escrito**: `irA` escribe un desplazamiento de la tabla —0, 283,
    // 566, 849, 1132— y nunca 323; este esta aqui por ser "mas alla del final" y
    // nada mas, y el que si se queda escrito es el de la linea de 1132.
    expect(scrollTargetFor(undefined, 323, 283)).toBe(283);
    // Y un offset que no es un numero tambien: un destino no medido se lee como
    // "no se va a ninguna parte", y "no se va a ninguna parte" tiene que ser una
    // posicion en la que el scroller pueda estar.
    expect(scrollTargetFor(Number.NaN, 323, 283)).toBe(283);
    expect(scrollTargetFor(Number.NaN, 1132, 283)).toBe(283);
    // Y por debajo de cero: un scroller movido con el dedo puede informar de una
    // posicion negativa al volver, y un scroll negativo no es una posicion.
    expect(scrollTargetFor(undefined, -12, 283)).toBe(0);
    expect(scrollTargetFor(Number.NaN, -12, 283)).toBe(0);
    // Con la pista sin medir el final del rango es el scroller, asi que recortarse a
    // si mismo solo le quita el negativo.
    expect(scrollTargetFor(undefined, -12, Number.NaN)).toBe(0);
    expect(scrollTargetFor(undefined, 283, Number.NaN)).toBe(283);
    // Y con las dos mitades recortadas, el re-base a un destino alcanzable vale cero:
    // 283 - 283 = 0, que es lo que el scroller se va a mover de verdad.
    const adelantado = scrollTargetFor(1132, 1132, 283);
    expect(scrollTargetFor(283, adelantado, 283) - adelantado).toBe(0);
  });
});

/**
 * Que columna dice la pestana cuando el scroller se para solo.
 *
 * El gesto mueve la pestana con el tablero (`settle`/`asentarEn`), pero un scroll
 * que el gesto no condujo —la rueda, un arrastre que empezo en diagonal— mueve el
 * scroller sin mover la pestana. Esta funcion es el camino de vuelta, y estos
 * tests son los que impiden que "simplifique" el recorte del final: sin el, cada
 * parada en el maximo arrastraria la pestana a la ultima columna anclable,
 * corrigiendo una eleccion que la persona hizo con un toque que no movio nada.
 */
describe('la columna donde se para el scroller', () => {
  // Estrecho: una columna por pagina, offsets [0, 398, 796], maximo 796.
  const offsets = [0, 398, 796];
  const maximo = 796;

  it('quedarse donde se estaba no mueve la pestana', () => {
    expect(columnForScrollEnd(0, offsets, maximo, 0)).toBeNull();
    expect(columnForScrollEnd(398, offsets, maximo, 1)).toBeNull();
    // Y el punto de snap vale como el mismo sitio: un punto arriba o abajo es
    // redondeo, no un viaje.
    expect(columnForScrollEnd(BOARD_SCROLL_REST_SLACK, offsets, maximo, 0)).toBeNull();
    expect(columnForScrollEnd(398 - BOARD_SCROLL_REST_SLACK, offsets, maximo, 1)).toBeNull();
  });

  it('parar en otra pagina mueve la pestana a esa columna', () => {
    expect(columnForScrollEnd(398, offsets, maximo, 0)).toBe(1);
    expect(columnForScrollEnd(796, offsets, maximo, 0)).toBe(2);
    expect(columnForScrollEnd(0, offsets, maximo, 2)).toBe(0);
    // A medio camino entre dos, la mas cercana: el snap ya decidio por nosotros
    // y aqui solo se lee donde quedo.
    expect(columnForScrollEnd(600, offsets, maximo, 0)).toBe(2);
  });

  it('al final, la pestana se queda en la columna que el scroller no alcanza', () => {
    // Ancho: cinco columnas con offsets [0, 283, 566, 849, 1132] y maximo 283.
    // La pestana en la quinta (indice 4) con el scroller en su maximo es una
    // eleccion por toque, y parar ahi no la mueve.
    const anchos = [0, 283, 566, 849, 1132];
    expect(columnForScrollEnd(283, anchos, 283, 4)).toBeNull();
    // Irse de verdad si: el scroller en 0 ya no ensena la quinta.
    expect(columnForScrollEnd(0, anchos, 283, 4)).toBe(0);
    // Y volver al maximo desde la primera nombra la ultima anclable, que es lo
    // que el scroller puede ensenar.
    expect(columnForScrollEnd(283, anchos, 283, 0)).toBe(1);
  });

  it('sin columnas o sin pestana valida se re-ancla a lo que se ve', () => {
    expect(columnForScrollEnd(398, offsets, maximo, 9)).toBe(1);
    expect(columnForScrollEnd(0, [], 0, 0)).toBe(0);
    // Un scroller que informa basura no mueve la pestana a la basura: NaN se lee
    // como cero, que es donde el scroller esta cuando nadie lo ha movido.
    expect(columnForScrollEnd(Number.NaN, offsets, maximo, 0)).toBeNull();
  });
});
