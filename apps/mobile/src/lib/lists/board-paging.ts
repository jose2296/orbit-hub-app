/**
 * Which column a swipe lets go of the board on.
 *
 * **The gesture is the panel's and so are its numbers.** `settle` in
 * `components/dashboard/panel-grid.tsx` turns a page with 56 points of travel or
 * 420 points of speed, those were measured on three targets, and this is the same
 * finger doing the same thing — crossing a screen sideways to show what is next —
 * so the thresholds are copied with the same values rather than tuned a second
 * time for a second pager. They are **parameters with those values as their
 * default**, so a caller that has to measure something else can pass something
 * else and the tests have a name to read.
 *
 * It is a pure function and it is here rather than in the screen because the
 * screen is where the arithmetic that broke went wrong twice: the division that
 * left the board scrolling with every column on screen, and the jump that landed
 * a column 36 points short of its edge. A gesture that decides in a component is a
 * gesture whose thresholds no test can reach, and a threshold nobody can reach is
 * a threshold that gets "improved" by whoever touches the file next.
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
 * The two are `SWIPE_DISTANCE` and `SWIPE_VELOCITY` of `panel-grid.tsx`, with the
 * same values and for the same reasons; see the note at the top of this file.
 */
export const BOARD_SWIPE_DISTANCE = 56;
export const BOARD_SWIPE_VELOCITY = 420;

/**
 * Which column a drag ends on, and never one outside the board.
 *
 * `offset` is how far the finger has travelled sideways and `velocity` how fast it
 * was going when it let go; **`count` is how many columns there are and `current`
 * which one the board is showing.** The answer is a column to show next, which is
 * why it is clamped rather than merely moved: the two ends of the board have
 * nothing to show, and a value past them is a `scrollTo` to an offset that has no
 * column at it.
 *
 * **One column at a time, never more.** A drag of 900 points is a finger that went
 * a long way, not a request for three columns: which column it lands on depends on
 * how many there are and where it started, and a board that skipped two on a long
 * drag would leave the finger looking at a column it never touched. So the answer
 * is `current` plus one or minus one, and nothing here reads how far the drag was
 * beyond the question of whether it was far enough at all.
 *
 * **The direction is the finger's, and a finger going left goes to the next
 * column**, because the columns are drawn left to right in the order of the
 * array and dragging the track left pulls the next one in from the right. That is
 * a sign, it is the only sign in this function, and it is the one thing here that
 * cannot be checked by reading the arithmetic: a board that pages the wrong way
 * still answers every question that only asks whether it moved.
 *
 * **A board with no columns answers zero.** It cannot be reached in the app — the
 * screen draws its empty state instead of the track, and `MAX_BOARD_STATES` is a
 * ceiling and not a floor — but the value is what gets used as an index, and an
 * index of `-1` is a `scrollTo` to a negative offset with a column drawn beside a
 * column that is not there.
 */
export function nextPageFor(
  offset: number,
  velocity: number,
  count: number,
  current: number,
  distance = BOARD_SWIPE_DISTANCE,
  minVelocity = BOARD_SWIPE_VELOCITY,
): number {
  // Before the arithmetic, because with no columns there is no column at every
  // index and `count - 1` is the one bound that is below zero.
  if (count < 1) return 0;

  const passed =
    Math.abs(offset) >= distance || Math.abs(velocity) >= minVelocity;
  /**
   * Which way, out of the two things the finger left behind.
   *
   * The travel first, and the velocity only when there is none: a finger that had
   * already come back before it lifted says with its travel that it changed its
   * mind, and a flick that ends where it started has no travel at all to say it
   * with. A finger stopped in both — no travel, no speed — is not a swipe, and
   * `Math.sign` says zero for it, which leaves the column where it was.
   */
  const step = passed ? -Math.sign(offset || velocity) : 0;

  return Math.max(0, Math.min(count - 1, current + step));
}
