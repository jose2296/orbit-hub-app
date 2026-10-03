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
 * `Pick` rather than `List` because the callers do not agree on what they hold:
 * some have the whole list and some have a row with the list inside it, and
 * `Pick` is the one shape both of them already satisfy. With `List` the second
 * kind would have to cast to compile.
 *
 * A missing list is the index of the lists, which is a screen somebody can act
 * on. The alternative is what the concatenation used to build: `/list/undefined`.
 */
export function routeForList(
  list: Pick<List, 'id' | 'kind'> | null | undefined,
): string {
  if (!list) return '/lists';
  return list.kind === 'board' ? `/board/${list.id}` : `/list/${list.id}`;
}
