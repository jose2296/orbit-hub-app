import * as Crypto from "expo-crypto";

import {
  ITEM_ICON_COLORS,
  MAX_BOARD_STATES,
  stateOf,
} from "@orbit-hub/contracts";
import type {
  BoardState,
  BoardStates,
  ItemIconColor,
  ListItem,
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
 */
const MAX_STATE_TITLE = 40;

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
 * The picker offers the twelve of `ITEM_ICON_COLORS`, so this only ever arrives
 * from a future build or from a payload somebody edited by hand. A colour the
 * schema does not know fails the write of the **whole** array, because the states
 * travel as one field, so it is dropped here rather than at the server.
 */
function colorOf(
  value: ItemIconColor | undefined,
  current: ItemIconColor,
): ItemIconColor {
  if (!value) return current;
  return (ITEM_ICON_COLORS as readonly string[]).includes(value)
    ? value
    : current;
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
  patch: { title?: string; color?: ItemIconColor },
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
