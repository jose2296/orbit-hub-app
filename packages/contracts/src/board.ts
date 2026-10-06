import { z } from 'zod';

import { ITEM_ICON_COLORS } from './item-icons.js';

/**
 * How many states a board may hold. The cap lives here, as a name, because both
 * ends of the app need it: the schema below refuses a 25th state and the state
 * editor switches its "+ Add" off with a message that says why.
 *
 * The order of those two matters. A limit the app can only find out by failing
 * is a state that appears and then disappears, which is worse than never
 * offering it. The number itself is a chosen one; what is not chosen is that it
 * is written down in a single place, so the button and the schema cannot
 * disagree about where the edge is.
 */
export const MAX_BOARD_STATES = 24;

/**
 * One column of a board.
 *
 * A state belongs to the **list** and not to the task, because a board is one
 * workflow that everybody looking at that list shares: columns stored per task
 * would give every row its own private set of columns.
 */
export const boardStateSchema = z.object({
  /**
   * Opaque, stable, and never shown to a person.
   *
   * A task points at this id rather than at the title, because renaming a column
   * is the most frequent edit in the editor: a title stored on the task would
   * leave every task in that column pointing at a state whose name no longer
   * exists. The id is minted in the client with `crypto.randomUUID()` and the
   * server never rewrites it, the same as every other id that arrives in a push.
   *
   * 36 is the width of that uuid in the `varchar(36)` column behind it. The floor
   * of 1 is what turns an empty string into a rejected id instead of an id that
   * matches no state and silently swallows every task that claims it.
   */
  id: z.string().min(1).max(36),
  /**
   * What a person reads on the column header, so it is trimmed and it has a
   * floor: a column nobody can name is a column nobody can move a task to.
   *
   * Two states may carry the same title — the id is what tells them apart, and
   * the colour is what the eye tells apart — so this is not a key and the
   * contract does not pretend it is.
   *
   * 40 is the budget a list label already has, because it is the same job: a
   * short word read in a tab strip or a header, not a sentence.
   */
  title: z.string().trim().min(1).max(40),
  /**
   * A palette key or a hex colour, **and the hex is the person's own choice.**
   *
   * The twelve keys are the icon palette and not a palette of its own, because
   * two palettes are two lists that drift apart. The hex beside them is what a
   * person picks when none of the twelve is theirs: `#rrggbb`, six digits with
   * the hash, lowercase or not — anything else is refused, because a colour the
   * app cannot parse is a state the app cannot paint, which reads as a bug in
   * the board.
   *
   * **What this does not promise is legibility.** The twelve were chosen so
   * that a word on them reads in both themes; a free hex was chosen by a person
   * who saw it on one screen, and on the other theme it may not read. That is
   * the price of "the colour I want", and it is paid knowingly: the row keeps
   * its name in the theme's text colour, so the column is never *only* its
   * colour.
   */
  color: z.union([z.enum(ITEM_ICON_COLORS), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]),
});
export type BoardState = z.infer<typeof boardStateSchema>;

/**
 * A state colour as the screens carry it: a palette key or a hex value.
 *
 * `z.infer` of the union above collapses to `string`, which says nothing — this
 * name says where the string may come from. It is *not* `ItemIconColor`: icons
 * still only take the twelve, and a hex on an icon is a value the icon picker
 * never offered.
 */
export type StateColor = z.infer<typeof boardStateSchema>["color"];

/**
 * The states of a list, and **the order of the array is the order of the
 * columns**.
 *
 * There is no `position` per state on purpose: reordering the columns is then
 * one array write instead of one write per state, and reordering them is not a
 * rare thing to do.
 *
 * The empty array is legal and means "there is no board in this list". Only the
 * board screens read it, so every other kind of list carries `[]` and never has
 * to invent a state.
 */
export const boardStatesSchema = z.array(boardStateSchema).max(MAX_BOARD_STATES);
export type BoardStates = z.infer<typeof boardStatesSchema>;

/**
 * The id of the first state, which is where a task with no state of its own
 * lands. `null` when the list has no states at all.
 *
 * The `null` returned for an empty list is not "unset" — it says there is no
 * board to be in. Everywhere else, "no state on the task" means the first state,
 * and that is what lets creating a task on a board be the same code that creates
 * a task on any other list: the new row carries a null id and the edit sheet
 * never has to know that states exist.
 */
export function firstStateId(states: BoardStates): string | null {
  return states[0]?.id ?? null;
}

/**
 * The state a task is drawn in.
 *
 * A null `stateId` **and** a `stateId` that is not in the list both resolve to
 * the first state. They are not the same situation — the first is ordinary and
 * the second arrives from another device that deleted the state — but they are
 * drawn the same way, and the row has nothing on it that tells them apart
 * honestly.
 *
 * So the fallback is the point of this function, and it is why it has a body
 * instead of being a `find`. If it returned `null` for an unknown id, tasks
 * would disappear from the board with nothing failing and nothing logged. Nobody
 * "fixes" it so that an unknown id stops resolving: that fix *is* the missing
 * tasks.
 */
export function stateOf(
  states: BoardStates,
  stateId: string | null | undefined,
): BoardState | null {
  if (states.length === 0) return null;
  if (stateId !== null && stateId !== undefined) {
    const found = states.find((state) => state.id === stateId);
    if (found) return found;
  }
  return states[0] ?? null;
}

/**
 * The invariant: the `stateId` of a task is null, or one of the ids in the
 * list's `states`.
 *
 * Null is always valid and means the first state. An unknown id is not, and this
 * is the check the server makes on every write of a `list_item`: it refuses the
 * operation and says so, instead of storing a value nothing can draw — which is
 * the opposite of how `SYNC_WRITABLE_FIELDS` treats an unknown field, where the
 * write is discarded and the push still answers `applied`.
 *
 * It is not the inverse of `stateOf` and the two are not interchangeable. This
 * one answers "may this be written?", which is why null passes; `stateOf`
 * answers "where is it drawn?", which is why null falls back to the first.
 */
export function isKnownStateId(
  states: BoardStates,
  stateId: string | null | undefined,
): boolean {
  if (stateId === null || stateId === undefined) return true;
  return states.some((state) => state.id === stateId);
}