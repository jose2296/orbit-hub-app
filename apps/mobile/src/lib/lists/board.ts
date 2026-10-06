import * as Crypto from "expo-crypto";

import {
  ITEM_ICON_COLORS,
  MAX_BOARD_STATES,
  isKnownStateId,
  stateOf,
} from "@orbit-hub/contracts";
import type {
  BoardState,
  BoardStates,
  ListItem,
  StateColor,
} from "@orbit-hub/contracts";

import { nextOrderFromDrop } from "./drag";

/**
 * What a board is, as pure functions.
 *
 * A board is a list whose tasks carry a `stateId` instead of a `completed`, and
 * the list carries the columns in `states` — **the order of that array is the
 * order of the columns**, which is why it is an array and not an object: moving
 * a column is one write of one field, not one write per column.
 *
 * Everything a board decides is here and nothing is in the screen, for one
 * reason: **a task that belongs to no column is not an error.** It is a card that
 * is not drawn anywhere, in a board that otherwise looks fine, with nothing in a
 * log and nothing on the screen to explain it. Two rows reach that state in
 * ordinary use — one created without a column of its own, whose `stateId` is
 * null and means the first one, and one whose column another device deleted,
 * which arrives from the pull pointing at an id that no longer exists — and both
 * are drawn in the **first** column. `stateOf` in the contract is that rule, and
 * nothing here is allowed to answer differently: every function below that
 * decides which column a row belongs to resolves it through `stateOf` rather
 * than comparing `stateId` against a column id, because that comparison is the
 * one that leaves those rows in no column at all.
 */

/**
 * The id of the longest column name the contract will store, mirrored from
 * `boardStateSchema`.
 *
 * The contract owns the number and this is only the screen's mirror of it, so a
 * title longer than this is **clipped** rather than refused: a clipped name is a
 * shorter name somebody can see, where a refused write is a rename that looks
 * like it never happened.
 *
 * Exported so the panels that ask for a name cap the field at the same number
 * instead of writing their own forty: two forties are two numbers that stop
 * agreeing the day the contract moves.
 */
export const MAX_STATE_TITLE = 40;

/**
 * The id of the column a `stateId` points at, or `null` when the list has none.
 *
 * The one place in this file that decides which column a row belongs to, and it
 * is `stateOf` doing it: `null` and an unknown id both come out as the first
 * column's id, which is the whole rule of this feature. It answers the two
 * questions that shape gets asked here — the column a row is drawn in, and the
 * column a caller is asking about — so asking about `null` asks about the first
 * one rather than about a column called `null`.
 *
 * The `null` that comes back is the other answer: a list with no columns at all,
 * which draws nothing, and which is what keeps `tasksInState(items, [], null)`
 * empty instead of answering every row of a list that is not a board.
 */
function columnIdOf(states: BoardStates, stateId: string | null): string | null {
  return stateOf(states, stateId)?.id ?? null;
}

/**
 * The colour a state is written in, or the one it already had.
 *
 * A palette key or a hex a person chose — anything else is dropped here rather
 * than at the server, because a colour the schema does not know fails the write
 * of the **whole** array, and the states travel as one field. What the picker
 * does not offer only ever arrives from a future build or from a payload
 * somebody edited by hand.
 */
function colorOf(value: string | undefined, current: string): string {
  if (!value) return current;
  if ((ITEM_ICON_COLORS as readonly string[]).includes(value)) return value;
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : current;
}

/**
 * The four columns a board is born with.
 *
 * An array and not an object because **the order is the order of the columns**,
 * and every column the person adds from here on goes to the end. The colours are
 * the icon palette's, in the order the spec asks for: grey to start, blue to go
 * next, amber while it is being worked on and green when it is done.
 *
 * Minted on every call and never cached, because two boards that share column
 * ids are one board wearing two names: renaming a column in either of them would
 * move the other's tasks. That is why the ids come from here and not from a
 * caller that could hand the same four in twice — which is the shape
 * `planDuplication` takes, on purpose, because a duplicated list is asked for a
 * generator and a board created from scratch is not.
 */
export function defaultStates(): BoardStates {
  return [
    { id: Crypto.randomUUID(), title: "Backlog", color: "neutral" },
    { id: Crypto.randomUUID(), title: "Ready", color: "blue" },
    { id: Crypto.randomUUID(), title: "WIP", color: "amber" },
    { id: Crypto.randomUUID(), title: "Done", color: "green" },
  ];
}

/**
 * A new column, or `null` when there is nothing to add.
 *
 * **The caller appends it**, which is what puts a new column at the end of the
 * board: a column inserted in the middle would move every card under it and
 * nothing in this array says which of them belonged above.
 *
 * `null` means no column was added, for the two reasons that would be a write
 * the contract throws away: the board is already at `MAX_BOARD_STATES`, or the
 * name is empty. The cap is the one the editor turns the button off with; the
 * name is here because the states travel as a single field, so **one unnamed
 * column fails every later save of that board**, and a board whose columns can
 * not be saved is worse than one that did not get its fifth column.
 */
export function newState(states: BoardStates, title: string): BoardState | null {
  if (states.length >= MAX_BOARD_STATES) return null;
  const name = title.trim();
  if (name.length === 0) return null;
  return {
    id: Crypto.randomUUID(),
    title: name.slice(0, MAX_STATE_TITLE),
    color: "neutral",
  };
}

/**
 * The tasks drawn in one column, in the order they are drawn.
 *
 * Ordered by `position` and then by `createdAt`, the same criterion
 * `useListItems` reads them with: two rows that share a position have a tie the
 * contract does not break, and a column that reorders itself between two pulls is
 * a column nobody trusts.
 *
 * **Membership goes through `stateOf`, not through `item.stateId`**, and that is
 * the expensive line of this file. Comparing the raw value works for every row
 * that points at a column that exists and leaves the other two in no column at
 * all: the row with a null `stateId`, which is every task created on a board
 * without a column of its own, and the row whose column another device deleted.
 * The board then renders without them and nothing anywhere fails.
 */
export function tasksInState(
  items: ListItem[],
  states: BoardStates,
  stateId: string | null,
): ListItem[] {
  const asked = columnIdOf(states, stateId);
  if (asked === null) return [];
  return items
    .filter((item) => columnIdOf(states, item.stateId) === asked)
    .sort(
      (a, b) =>
        a.position - b.position || a.createdAt.localeCompare(b.createdAt),
    );
}

/**
 * How many tasks are drawn in one column, **nulls included**.
 *
 * The same rule as `tasksInState` and the same reason it is not written as
 * `tasksInState(...).length`: the number beside a column is asked for every column
 * on every render, and this counts in one pass instead of sorting an array per
 * column in order to throw it away.
 *
 * The nulls matter here more than they matter anywhere else. A column with three
 * tasks that all carry a null `stateId` reads as "Ready 0" without them, and
 * deleting it then leaves those three pointing at a column that is gone, to land
 * in whichever one happens to be first afterwards.
 */
export function countInState(
  items: ListItem[],
  states: BoardStates,
  stateId: string | null,
): number {
  const asked = columnIdOf(states, stateId);
  if (asked === null) return 0;
  let count = 0;
  for (const item of items) {
    if (columnIdOf(states, item.stateId) === asked) count += 1;
  }
  return count;
}

/**
 * The `stateId` a move writes, or `null` when the move is not a move.
 *
 * **"Is it already there?" is asked of the resolved column and not of `stateId`,
 * and that is the whole of the function.** A row whose `stateId` is `null` — which
 * is every task created on a board — is drawn in the first column, so choosing the
 * first column moves it nowhere; and a row whose column another device deleted is
 * drawn in the first column too, so choosing it must not enqueue anything either.
 * Both come out of `columnIdOf`, which is `stateOf` under another name, and a
 * comparison against the raw value gets both of them wrong: it writes
 * `states[0].id` onto a task that is already drawn there.
 *
 * The cost of getting it wrong is small and it is not zero. The write is local
 * first, so the tab moves either way, but the outbox carries an update nobody
 * asked for, it survives the session, and it is an operation somebody else has to
 * merge on a device that did not make it.
 *
 * `null` comes back for a `target` that is not one of this board's columns too,
 * and that is the other half of the same care: the server refuses that write with
 * `isKnownStateId` and **says nothing at the screen**, because a rejected
 * operation inside a push that answers 200 is invisible. The sheet only offers ids
 * it was handed, so this is the belt to a rule the drawing already keeps — and it
 * is the same check the server would make for it at the price of a round trip.
 *
 * **`target` is `string` and the type is what keeps `null` out.** `isKnownStateId`
 * answers `true` for a null stateId — that is the invariant, "null means the first
 * state" — so a `string | null` parameter would sail past the guard above on a null
 * and land in the comparison, where `columnIdOf` is never null for a board with
 * columns and the answer is the `null` that means "write nothing". Right by
 * accident, and it reads as if a null target were a move to the first column.
 * **Moving a task to the first column is spelled with that column's id**, which is
 * what the picker hands over; `stateOf` is what resolves the other spelling to it.
 */
export function stateIdToWrite(
  states: BoardStates,
  current: string | null,
  target: string,
): string | null {
  if (!isKnownStateId(states, target)) return null;
  return columnIdOf(states, current) === target ? null : target;
}

/**
 * The `position` to write in each task of one column, renumbered `0..n-1`.
 *
 * **A map and not the rows**, because what the caller wants is what to write:
 * dropping a card writes one `position` per row that moved and nothing else, and
 * this is where it decides which rows those are.
 *
 * **Only this column's rows, and that is what the function is for.** Numbering
 * every task of the list would renumber the other columns as well, so a drag in
 * "Ready" would reorder "Done" too — the same rows, with numbers written to
 * them, in an order nobody asked for.
 *
 * It takes `states` for the same reason `tasksInState` does, and this is not
 * redundancy: the rows it numbers are the ones drawn in the column, which is
 * `tasksInState`'s answer and not `item.stateId`'s. The first column is mostly
 * rows whose `stateId` is null, and without `states` those rows come out of the
 * map missing — a drag in the first column that renumbers nobody and looks like
 * it did nothing.
 */
export function renumberWithinState(
  items: ListItem[],
  states: BoardStates,
  stateId: string | null,
): Map<string, number> {
  const changes = new Map<string, number>();
  tasksInState(items, states, stateId).forEach((item, index) => {
    changes.set(item.id, index);
  });
  return changes;
}

/**
 * The columns in a new order, with the one at `from` moved to `to`.
 *
 * The same arithmetic as `nextOrderFromDrop`, which is already tested for a list
 * of rows, reused rather than written again: a drop is a drop, and the version
 * that was reimplemented here is the version that breaks in one of the two
 * places.
 *
 * **The array it was given comes back when the move goes nowhere**, which is what
 * the caller compares against to decide whether to write the list row at all. A
 * copy would have every drag that went nowhere write the same array to the
 * database.
 */
export function moveState(
  states: BoardStates,
  from: number,
  to: number,
): BoardStates {
  const moved = states[from];
  if (!moved) return states;
  return nextOrderFromDrop(states, moved, to);
}

/**
 * The columns with one of them changed, **and its id left alone**.
 *
 * The id is the invariant this whole feature stands on: tasks point at an id and
 * not at a name, so renaming a column — the most frequent edit in the editor — is
 * a `title` and a `color` and never a new id. Mint one here and every task in
 * that column is an orphan the next pull brings, drawn in the first column with
 * nothing saying why.
 *
 * The array it was given comes back when there is nothing to change: an id that
 * is not in the list, or a name that is empty once trimmed. A column nobody can
 * name is a column nobody can move a task to, and the contract refuses one,
 * which fails the write of the whole array.
 */
export function editState(
  states: BoardStates,
  stateId: string,
  patch: { title?: string; color?: StateColor },
): BoardStates {
  const index = states.findIndex((state) => state.id === stateId);
  const current = states[index];
  if (!current) return states;

  const title =
    patch.title === undefined
      ? current.title
      : patch.title.trim().slice(0, MAX_STATE_TITLE);
  if (title.length === 0) return states;

  const color = colorOf(patch.color, current.color);
  if (title === current.title && color === current.color) return states;

  const next = [...states];
  // By value for the edited one only: the columns that did not change are the very
  // objects the caller had, so nothing can rename them by accident.
  next[index] = { id: current.id, title, color };
  return next;
}

/**
 * The columns without one of them.
 *
 * **It does not move the tasks, and that is not an omission.** It is handed an
 * array of states and the tasks are rows of another table, so the only honest
 * thing it can do is take a column out of that array. Whoever deletes a column
 * moves its tasks first, with the destination written by hand, and takes the
 * column out after; the reason the order is that one is written in
 * `docs/superpowers/specs/2026-10-03-tablero-de-estados-design.md`: tasks left
 * pointing at a deleted column land in whichever column is first afterwards, and
 * nobody chose that.
 *
 * It also does not stop the **last** column from being removed. `canDeleteState`
 * is what asks that and it asks with an index, so the two functions answer two
 * different questions and this one does not carry the answer to the other: a
 * caller that deletes by id without asking can empty a board. The editor is the
 * one that asks, before it draws the button.
 */
export function removeState(states: BoardStates, stateId: string): BoardStates {
  const index = states.findIndex((state) => state.id === stateId);
  if (index === -1) return states;
  return states.filter((_, at) => at !== index);
}

/**
 * Whether the column at `index` can be deleted, and by the length before the
 * index.
 *
 * **The last column cannot go**, and the reason is the whole board: a list with
 * no states is a list with no columns, `stateOf` answers null for every task in
 * it, and every task of that board is drawn nowhere with nothing saying why. So
 * the answer is `false` with the reason written next to the button, not a button
 * that is simply not there.
 *
 * The index is checked as well, and for an ordinary reason: an index that is not
 * in the array is not a column anybody can delete.
 */
export function canDeleteState(states: BoardStates, index: number): boolean {
  return states.length > 1 && index >= 0 && index < states.length;
}

/** What deleting a column that has tasks in it means, worked out before any of it. */
export interface DeleteStatePlan {
  /**
   * The rows to write, **and the `stateId` to write on each one already spelled
   * out.**
   *
   * There is no `null` in this type and that is the point of the whole function: a
   * move written as `null` is a move that will be re-resolved against the array
   * that exists at the time somebody reads the board, and the array is about to
   * lose the column these tasks are in.
   */
  moves: { item: ListItem; stateId: string }[];
  /** The array without the column, **and nothing has been written yet.** */
  states: BoardStates;
}

/**
 * What deleting `stateId` means while `destinationId` is where its tasks go, and
 * `null` when that is not a thing that can be done.
 *
 * **It is a plan and not a write, and the order of the two halves is the answer
 * to the question this feature exists to get right.** `moves` comes first and
 * `states` second, and the caller awaits the first before it hands the second
 * anywhere: a task left pointing at a deleted column is drawn in whichever column
 * is first afterwards, `stateOf` resolves the unknown id to the first one and
 * nothing anywhere fails — the task appears in a column nobody chose. The order is
 * written in
 * `docs/superpowers/specs/2026-10-03-tablero-de-estados-design.md` and it is the
 * reason the two halves are two fields of one value and not two functions.
 *
 * **Every row drawn in the column is in `moves`, including the ones whose
 * `stateId` is null, and every one of them carries the destination written out.**
 * That is the case the plan calls review focus 3 and it is the one that fails
 * silently: a task with a null `stateId` is drawn in the first column, so
 * deleting that column and leaving the task as it was would make it "the first
 * one" of the new array — a different column, chosen by an ordering rather than
 * by a person.
 *
 * **No row here is ever skipped for already being somewhere.** `stateIdToWrite`
 * is not what decides, and **it is worth being exact about why, because the
 * obvious version of the claim is false.** Given the guards below,
 * `stateIdToWrite` provably cannot answer null for any of these rows — the ones in
 * `moves` all resolve to the column being deleted, and the destination is a
 * different one — so routing the destination through it changes nothing a test
 * could see: mutating the function that way leaves all 56 of the tests in
 * `test/board.test.ts` green. **What stops it is the type.** `moves` is
 * `{ stateId: string }[]` and `stateIdToWrite` answers `string | null`, so the
 * mutation does not compile (`TS2322`, `Type 'null' is not assignable to type
 * 'string'`), which is the same argument `stateIdToWrite` makes about itself.
 * The rule is therefore enforced by a signature and not by a test, and the test
 * that does bite is the other one: replacing `tasksInState` with a raw
 * `item.stateId === stateId` filter — the ordinary mistake — drops the nulls and
 * fails two of them.
 *
 * `null` for the three ways this cannot be done, and each of them is a silent
 * failure if it were allowed through:
 *
 * - the column is not in this board's array, so there is nothing to delete;
 * - the destination is not one of this board's columns, and the server refuses
 *   that write (`isKnownStateId`) inside a push that answers 200;
 * - **the destination is the column being deleted**, which is what a null or
 *   unknown `destinationId` looks like once `stateOf` has had it: null and an
 *   unknown id both resolve to the **first** column, so removing the first column
 *   with either of them would leave its tasks pointing at a column that is gone —
 *   exactly the failure this function exists to make impossible.
 *
 * **Both ids are checked by membership and not resolved through `stateOf`**, and
 * that is the difference between this and every other function in this file. Every
 * other one asks "where is this row drawn", and the answer to that is never null
 * and never unknown. This one asks "may this be written", which is
 * `isKnownStateId`'s question and not its inverse — and resolving first would
 * turn an id nobody can name into "the first column", so a delete asked for with
 * a stale id would quietly take out the board's first column instead of refusing.
 *
 * **A column with nothing in it does come through here**, with an empty `moves`.
 * That is not an accident: the editor asks `count === 0` first and deletes without
 * asking anything, so this is not the path an empty column takes — and a plan that
 * only ever had rows in it could not be tested against the row it forgot.
 */
export function deleteStatePlan(
  states: BoardStates,
  items: ListItem[],
  stateId: string,
  destinationId: string,
): DeleteStatePlan | null {
  // Membership and not `stateOf`: see the note above.
  if (!states.some((state) => state.id === stateId)) return null;
  if (!states.some((state) => state.id === destinationId)) return null;
  if (destinationId === stateId) return null;

  const moves = tasksInState(items, states, stateId).map((item) => ({
    item,
    // Written out, never resolved: see the note above on the null `stateId`.
    stateId: destinationId,
  }));
  return { moves, states: removeState(states, stateId) };
}

/* --------------------------------------------- como se reparte y se salta -- */

/**
 * The narrowest a column is drawn, **and it is 230 rather than 320.**
 *
 * The wide number came first and was wrong, measured in a browser: in a track of
 * 1120 —a 1440-point window with the drawer open— it fits three columns of 320
 * and leaves a board of eight half out of sight. At 230 the same track fits four,
 * and **four columns of a board at once is what makes it readable at a glance**:
 * comparing columns is the whole point of a board, and comparing them needs more
 * than one in the same look. A card with a title, an icon and two labels is
 * comfortable at 230, and a title has two lines to be comfortable in.
 *
 * A fifth column would need about 1200 points of track, which no measurement in
 * the plan covers.
 */
export const BOARD_COLUMN_MIN_WIDTH = 230;

/**
 * Below this width a board shows one state full screen.
 *
 * **720 is `READING_WIDTH`, and that is not a coincidence.** Every screen of the
 * app caps its content at that width so a line of text is not a line that runs
 * from the left edge of a laptop to the right one; a board is `width="full"` and
 * does not cap itself, because its columns are measured against what there is. The
 * number is where "a screen's worth of columns" and "a screen's worth of reading"
 * meet, and it is `READING_WIDTH` and not a number of columns because the answer
 * changes with what the window is: **a phone-width window is one state full-screen,
 * and a tablet-width one is a board.**
 */
export const BOARD_SINGLE_COLUMN_BELOW = 720;

/** How wide a column is, and how many of them that width is. */
export interface BoardColumnLayout {
  /**
   * The width of every column, in points, **zero while the board has not been
   * measured**: the box that measures it renders whatever this says, and a screen
   * that waits for a positive number before drawing the box never gets one.
   */
  columnWidth: number;
  /** How many columns the width was divided by. */
  columns: number;
  /** Whether the width is narrow enough that one state takes the whole track. */
  singleColumn: boolean;
}

/**
 * How a track of `width` points is divided between the columns of a board.
 *
 * **This is arithmetic and it is here rather than in the screen because it is the
 * arithmetic that broke.** Dividing the width by the number of columns and adding
 * the gap afterwards is the obvious way to write it and it does not add up: four
 * columns of 280 and three gaps of 12 ask for 1156 of a 1120-point track, and the
 * board scrolls 36 points **with every column already on screen**. The gap is
 * therefore part of what a column costs: the count fits `(width + gap)` over
 * `MIN + gap`, and each column is what is left once the gaps of the ones before it
 * are taken out.
 *
 * `Math.max` with the minimum stays as the floor. With the division above it
 * cannot be reached — a count that fits at 230 also fits once the gap is
 * discounted — and if it ever were, the board would scroll, which is what a column
 * narrower than it can be read is worth.
 *
 * `gap` is a parameter and not a constant because it is the theme's spacing and the
 * theme is not reachable from here.
 */
export function columnLayout(width: number, gap: number): BoardColumnLayout {
  if (width <= 0) {
    return { columnWidth: 0, columns: 1, singleColumn: true };
  }
  if (width < BOARD_SINGLE_COLUMN_BELOW) {
    // One state takes the whole track and the gap is nobody's business: there is
    // only one column, so there is no gap before it or after it.
    return { columnWidth: width, columns: 1, singleColumn: true };
  }

  const columns = Math.max(
    1,
    Math.floor((width + gap) / (BOARD_COLUMN_MIN_WIDTH + gap)),
  );
  const columnWidth = Math.max(
    BOARD_COLUMN_MIN_WIDTH,
    (width - gap * (columns - 1)) / columns,
  );
  return { columnWidth, columns, singleColumn: false };
}

/**
 * Where the left edge of column `index` is, as an offset into the track.
 *
 * **`index * columnWidth` is wrong, and it is wrong by a growing amount**: the
 * column `i` starts at `i * (columnWidth + gap)`, because the gap sits between
 * every two columns. The jump from a tab therefore lands `i * gap` points short —
 * 36 points on the fourth column — and the chosen column arrives with a strip of
 * the previous one beside it. On the web it is invisible, because
 * `scroll-snap-type: x mandatory` moves the scroll to the nearest anchor and the
 * anchor is right; on native `pagingEnabled` pages by multiples of the scroller's
 * width, and `index * columnWidth` *is* a page there without being a column edge.
 * So the number the scroller is given has to be the number that was measured.
 *
 * No clamping: the last column of a board whose columns do not all fit cannot sit
 * flush against the left edge, and the browser clamps the scroll to what there is.
 * That is correct and it is the same on both targets.
 *
 * **What this guarantees is the geometry and not that it works on native.** A
 * screen reader of this comment will hear "the scroller is given the number that was
 * measured" and take it for "so it is right everywhere", and it is not: `1140` — the
 * fourth column of a 368-point track — **is not a multiple of the scroller's width**
 * either. If native `pagingEnabled` re-corrects a programmatic `scrollTo` to a
 * page boundary the way it re-corrects a flick, then `1140` is as exposed as the `813`
 * this replaced, and the only thing that has changed is that `1140` is where the
 * column's edge really is and `813` was 36 points short of it. **That has not been
 * measured**: there is no simulator or device on this machine, and the browser
 * normalises both versions to the same anchor, which is why a browser measurement
 * cannot tell them apart. The gesture of Task 9 decides this on every target; this
 * function is what it has to be right about.
 */
export function columnOffset(
  index: number,
  columnWidth: number,
  gap: number,
): number {
  return index * (columnWidth + gap);
}
