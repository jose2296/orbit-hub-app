import type { List } from '@orbit-hub/contracts';

/**
 * Which screen a list opens in, decided by its kind.
 *
 * A board opens in `/board` and every other kind in `/list`, and this is the
 * only place that says so: the moment two places build the route of a list, one
 * of them stops being updated — and **it does not fail**. It opens the task
 * screen of a board, which is close enough to the board that nothing about it
 * looks broken, and no assertion anywhere catches that. That is why this is a
 * function and not a string in each caller.
 *
 * `Pick` rather than `List` because most callers are not holding a list: the id
 * of a list that was just created and the kind the form chose, a row of the
 * content of a space, a search hit, a catalog screen whose cache lookup missed.
 * They know the id and the kind and nothing else, and they build a
 * `{ id, kind }` of their own to hand over. With `List` in the signature those
 * callers would have to cast, or fetch a whole list they never had.
 *
 * No list at all is the index of the lists, which is a screen somebody can act
 * on. That case is a caller whose lookup came back empty — and it is the whole
 * of what the guard is for: an object that carries an id but no kind, or an
 * undefined id inside one, still builds the route the concatenation built.
 */
export function routeForList(
  list: Pick<List, 'id' | 'kind'> | null | undefined,
): string {
  if (!list) return '/lists';
  return list.kind === 'board' ? `/board/${list.id}` : `/list/${list.id}`;
}
