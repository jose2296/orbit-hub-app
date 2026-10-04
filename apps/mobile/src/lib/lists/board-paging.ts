/**
 * Which page a swipe lets go of the board on.
 *
 * **The gesture is the panel's, and so are its two numbers.** `settle` in
 * `components/dashboard/panel-grid.tsx` turns a page with 56 points of travel or
 * 420 points of speed, those were measured on three targets, and this is the same
 * finger doing the same thing — crossing a screen sideways to show what is next —
 * so the thresholds are copied with the same values rather than tuned a second
 * time for a second pager. They are **parameters with those values as their
 * default**, so a caller that has to measure something else can pass something
 * else and the tests have a name to read.
 *
 * **What is *not* copied is the rule for the direction, and the difference is
 * deliberate.** The panel reads `forward = abs(velocity) > 40 ? velocity < 0 :
 * travel < 0`: **the velocity decides whenever the finger is moving faster than
 * 40**, and the travel only speaks when the finger had already slowed down. This
 * one reads the travel first and asks the velocity only when there is no travel at
 * all. Both are defensible and they answer differently for a finger that dragged
 * 140 points to the left and then flicked back to the right at the end: the panel
 * calls that backwards, this calls it forwards, and **this is the one that is right
 * here**, because the finger has been to the left for the whole gesture and the
 * last two frames are the finger changing its mind. The rule is written out below
 * and tested rather than borrowed, which is the whole difference.
 *
 * The comparison is also one notch more generous than the panel's; see the note on
 * the two constants.
 *
 * It is a pure function and it is here rather than in the screen because the
 * screen is where the arithmetic that broke went wrong three times: the division
 * that left the board scrolling with every column on screen, the jump that landed
 * a column 36 points short of its edge, and the floor of the rubber band that was
 * measured in columns against a scroller measured in points. A gesture that decides
 * in a component is a gesture whose thresholds no test can reach, and a threshold
 * nobody can reach is a threshold that gets "improved" by whoever touches the file
 * next.
 */

/**
 * How far a finger has to travel, and how fast, to change column.
 *
 * Both, and either is enough. A short fast flick counts — that is how everybody
 * swipes — and a long slow drag counts too, for a thumb that moved a long way
 * without hurry. **A slow short drag does nothing**, which is somebody pressing
 * on the track and changing their mind, and turning the page on it would be the
 * app guessing: the cards inside the columns are pressable, and one that moved the
 * board when a finger rested on it would be a card that opens a different column
 * depending on where in the card it was pressed.
 *
 * The two are `SWIPE_DISTANCE` and `SWIPE_VELOCITY` of `panel-grid.tsx`, **with
 * the same values and one notch apart in the comparison**: the panel tests
 * `> 56` and `> 420` and this tests `>= 56` and `>= 420`, so a drag of exactly 56
 * points or a flick of exactly 420 turns the page here and not there. `>=` is what
 * the brief asked for and the extra notch is one drag in a thousand, so it stays —
 * **but the two are not the same line of code, and the note at the top of this file
 * may not say they are.** What is shared is the decision and the two numbers.
 */
export const BOARD_SWIPE_DISTANCE = 56;
export const BOARD_SWIPE_VELOCITY = 420;

/**
 * Which page a drag ends on, and never one outside the pager.
 *
 * `offset` is how far the finger has travelled sideways and `velocity` how fast it
 * was going when it let go; **`pages` is how many pages the pager has and `current`
 * which one the board is showing.** The answer is a page to show next, which is why
 * it is clamped rather than merely moved: the two ends of the pager have nothing to
 * show, and a value past them is a `scrollTo` to an offset that has no column at it.
 *
 * **`pages` is `anchorableColumns` and not the number of states**, and that is the
 * whole of what "a pager" means: a wide board's scroller runs out of scroll before
 * it runs out of states, so the last states have no page to be on. The count is
 * about the scroller, and reading it off the states is the mistake that moved a tab
 * without moving the board.
 *
 * **One page at a time, never more.** A drag of 900 points is a finger that went a
 * long way, not a request for three pages: which one it lands on depends on how many
 * there are and where it started, and a board that skipped two on a long drag would
 * leave the finger looking at a column it never touched. So the answer is `current`
 * plus one or minus one, and nothing here reads how far the drag was beyond the
 * question of whether it was far enough at all.
 *
 * **The direction is the finger's, and a finger going left goes to the next page**,
 * because the columns are drawn left to right in the order of the array and
 * dragging the track left pulls the next one in from the right. That is a sign, it
 * is the only sign in this function, and it is the one thing here that cannot be
 * checked by reading the arithmetic: a board that pages the wrong way still answers
 * every question that only asks whether it moved.
 *
 * **A pager with no pages answers zero.** It cannot be reached in the app — the
 * screen draws its empty state instead of the track, and `MAX_BOARD_STATES` is a
 * ceiling and not a floor — but the value is what gets used as an index, and an
 * index of `-1` is a `scrollTo` to a negative offset with a column drawn beside a
 * column that is not there.
 */
export function nextPageFor(
  offset: number,
  velocity: number,
  pages: number,
  current: number,
  distance = BOARD_SWIPE_DISTANCE,
  minVelocity = BOARD_SWIPE_VELOCITY,
): number {
  /**
   * A worklet, **and that is a requirement rather than an optimisation**: the
   * gesture that calls this runs on the interface thread, and a plain function
   * called from there does not answer — it is a function of the JavaScript thread
   * being called from another one. On the web the two threads are the same and the
   * missing directive is invisible, which is exactly why it has to be written down
   * here rather than found out on a phone: **it is the same reason
   * `lib/dashboard/panel.ts` carries twelve of them.**
   *
   * A worklet is still an ordinary function, so the same code answers on the
   * interface thread and in a test.
   */
  'worklet';

  // Before the arithmetic, because with no pages there is no page at every index
  // and `pages - 1` is the one bound that is below zero.
  if (pages < 1) return 0;

  const passed =
    Math.abs(offset) >= distance || Math.abs(velocity) >= minVelocity;
  /**
   * Which way, out of the two things the finger left behind.
   *
   * The travel first, and the velocity only when there is none: a finger that had
   * already come back before it lifted says with its travel that it changed its
   * mind, and a flick that ends where it started has no travel at all to say it
   * with. A finger stopped in both — no travel, no speed — is not a swipe, and
   * `Math.sign` says zero for it, which leaves the page where it was.
   */
  const step = passed ? -Math.sign(offset || velocity) : 0;

  /**
   * The last page, **and `current` is put inside it before the step is counted.**
   *
   * Not after, and that order is the whole of it. A tab tap can select a column
   * the pager cannot anchor — `columnOffset` says the browser clamps it and calls
   * that correct — and a swipe from there has to come back into the pager
   * somehow. Clipping the answer puts it on the **nearest** page, which with a
   * finger going right is three columns *against* the finger on a five-state board
   * with two pages: measured in the browser at 1440, page 1 for a swipe to the
   * right from the fifth state. Counting the step from the nearest page instead
   * gives page 0, which is where the finger went.
   */
  const last = pages - 1;
  return Math.max(0, Math.min(last, Math.min(last, current) + step));
}

/** How far a track can be dragged each way, both in points. */
export interface TrackRoom {
  /**
   * Room to the right, which is the way **back** towards the first column: it is
   * how far the track has already been scrolled, so it is zero at the first column
   * and the whole maximum at the last one that can reach the left edge.
   */
  roomLeft: number;
  /**
   * Room to the left, which is the way **forward** towards the last column: it is
   * what is left of the maximum, so it is the whole maximum at the first column and
   * zero once the track cannot scroll any further.
   *
   * The two names are the scroll's, not the finger's, and they are the names
   * `panel-grid.tsx` uses for the same two numbers. Dragging **right** moves the
   * track towards its `roomLeft` and dragging **left** towards its `roomRight`,
   * which reads backwards and is right: a positive scroll offset shows earlier
   * columns.
   */
  roomRight: number;
}

/**
 * How wide the row of columns is, **in points and with the gaps between them.**
 *
 * `count * columnWidth + (count - 1) * gap`, and the `- 1` is the term that has to
 * be right: a gap sits *between* two columns and not after each one, so four
 * columns of 368 with gaps of 12 are 1508 points and not 1556. It is the same
 * arithmetic `columnOffset` does the other way round — `index * (width + gap)` — and
 * the two have to agree, because one says where a column starts and the other says
 * where the last one ends.
 */
export function trackContentWidth(
  count: number,
  columnWidth: number,
  gap: number,
): number {
  if (count < 1) return 0;
  return count * columnWidth + (count - 1) * gap;
}

/**
 * How far the track can be scrolled at all, **in points, and never negative.**
 *
 * What the content is wider than the track by. The zero is not cosmetic: a board
 * whose columns all fit has nothing to drag, and a negative floor handed to a
 * rubber band is a band that pushes the wrong way on the first frame.
 */
export function maxTrackScroll(trackWidth: number, contentWidth: number): number {
  return Math.max(0, contentWidth - trackWidth);
}

/**
 * How far the track can be dragged from **where it is**, in points.
 *
 * **This is the floor the rubber band is measured against, and it has to be points
 * because the scroller it describes is measured in points.** It used to be a count
 * of columns times the scroller's maximum scroll, which is the same number only
 * when one column is visible — the one width where the mistake cannot be seen:
 * with one column, `columns of room × maximum scroll` *is* the room in points.
 *
 * With more than one visible column the two accounts part company by exactly the
 * width of the columns that are already on screen. Five states with four visible in
 * a track of 1120: the scroller has 283 points to give, and the count in columns
 * promised `4 × 283 =` **1132**, which is `849` — the width of the three columns
 * already beside the one being left — more than the scroller can ever do.
 *
 * **And the floor follows the scroller rather than the column**, because the two
 * are not the same thing: from the second column of that board the track is already
 * at its maximum, so there is **nothing** to give forward however many columns are
 * still off screen. Reading the floor off the column is what made a swipe from
 * there advance the tab with the board standing still.
 *
 * `scrollLeft` is clipped into the range first, and the two halves always add up to
 * `maxScroll`: the division by `EDGE_RESISTANCE` is applied to the cushion and not
 * to the floor, and that only stays true while the floor is one number split in
 * two.
 */
export function trackRoomAt(scrollLeft: number, maxScroll: number): TrackRoom {
  const max = Math.max(0, maxScroll);
  const at = Math.max(0, Math.min(max, scrollLeft));
  return { roomLeft: at, roomRight: max - at };
}

/**
 * How many columns the track can be **anchored on**, which is not how many states
 * the board has.
 *
 * A wide track shows several columns at once and runs out of scroll long before it
 * runs out of states: with five states and four of them visible in a track of 1120
 * the scroller has 283 points to give, which is exactly **one** column step, so
 * only the first two columns can ever sit flush against the left edge.
 * `columnOffset` already says that the rest cannot and calls it correct — and it
 * *is* correct for a tab tap, which is a request to go and look at a state. It is
 * not correct for a swipe, which promises the finger a column that moves.
 *
 * **So this is what `nextPageFor` counts pages with**, which is the same
 * distinction `panel-grid.tsx` makes between `screens` and the number of widgets:
 * a pager has as many pages as it can scroll to. With the states passed instead, a
 * swipe from the last column the track can reach asked for a page with no scroll
 * behind it — measured in the browser with five states at 1440, where `scrollLeft`
 * stayed at its maximum of 283, the active tab went to the third state and not one
 * of the five column edges moved.
 *
 * Counted in **whole steps**, so a track that stops ten points short of a column
 * does not claim that column, and never more than `count`, so a track that can
 * scroll a long way does not invent columns. A `step` of zero is the width before
 * it has been measured: nothing is drawn then, and nothing may be ruled out on the
 * strength of a zero.
 */
export function anchorableColumns(
  count: number,
  maxScroll: number,
  step: number,
): number {
  if (count < 1) return 0;
  if (step <= 0) return count;
  const pasos = Math.max(0, Math.floor(Math.max(0, maxScroll) / step));
  return Math.min(count, pasos + 1);
}

/**
 * The travel that counts as a **whole page of parallax** for the tab strip.
 *
 * **The larger of a column's step and the strip's own width, and the reason is
 * that the parallax has to stay behind the board.** The strip travels
 * `progress * stripWidth * 0.35`, so with a column's step as the unit the ratio of
 * the strip's travel to the board's is `0.35 * stripWidth / step`: 0.34 on a phone,
 * where the strip and the column are both 368, and **1.39 on a wide track**, where
 * the strip is 1120 wide and the step is 283. Measured in the browser at 1440 with
 * five states: a 275-point drag moved the columns 275 and the pills 381 — the strip
 * running away from the board it exists to show where the board is going, and with
 * the strip's width as the page the same drag moves the pills **96.25**, which is
 * exactly a third of 275.
 *
 * With the larger of the two, the factor keeps meaning what it says — a third of
 * the board's travel, or a third of the strip's width, whichever binds first — and
 * the two layers never swap places. Zero for both is the state before the strip has
 * been measured, and a parallax of nothing is the right answer there.
 */
export function parallaxPage(step: number, stripWidth: number): number {
  return Math.max(step, stripWidth);
}
