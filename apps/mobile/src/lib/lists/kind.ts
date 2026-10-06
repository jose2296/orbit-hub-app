import { Ionicons } from '@expo/vector-icons';

import type { ListKind } from '@orbit-hub/contracts';

import type { TranslationKey } from '@/lib/i18n';

/**
 * What each kind of list looks like.
 *
 * One place, because the same kinds appear in the picker of a new list, in the
 * row of a list, in the carousel and in the search results, and a kind that has
 * an icon in one of them and not in another reads as a missing one.
 */
export const LIST_KIND_ICON: Record<ListKind, keyof typeof Ionicons.glyphMap> = {
  tasks: 'checkbox-outline',
  // A grid and not a list: the board is columns of tasks, and the shape of the
  // icon is the only thing that says so before anybody opens it. `grid-outline`
  // is in the Ionicons set the app already draws from, which is why it is named
  // here and not left to the picker's fallback.
  board: 'grid-outline',
  movies: 'film-outline',
  series: 'tv-outline',
  movies_and_series: 'albums-outline',
  books: 'book-outline',
};

export const LIST_KIND_LABEL: Record<ListKind, TranslationKey> = {
  tasks: 'lists.kind.tasks',
  board: 'lists.kind.board',
  movies: 'lists.kind.movies',
  series: 'lists.kind.series',
  movies_and_series: 'lists.kind.moviesAndSeries',
  books: 'lists.kind.books',
};

/**
 * The order they are offered in. Films and series together sit next to each.
 *
 * **`'board'` is right after `'tasks'`, and this array is the one thing about the
 * three maps above that no compiler checks.** The other two are
 * `Record<ListKind, …>`, so a kind that arrives without an entry is a compile
 * error; this one is a `ListKind[]`, so `'board'` can simply be absent and the
 * build stays green. What that costs is the board not being offered at all in
 * the picker of a new list — checked in a browser, with five kinds and no board
 * — and no test, no typecheck and no exception anywhere. If a kind is ever
 * missing from here, that is what it looks like.
 */

/**
 * Qué es cada tipo, **en una frase**.
 *
 * No estaban, y el sitio donde se echaban de menos era el selector: cinco pastillas con
 * el nombre y nada más, y dos de ellas se distinguían por una palabra—"películas" y
 * "películas y series" son el mismo icono con una etiqueta más larga—. Una línea que
 * diga para qué sirve cada uno no cabe en una pastilla y en una página de opciones sí.
 */
export const LIST_KIND_HINT: Record<ListKind, TranslationKey> = {
  tasks: 'lists.kind.tasksHint',
  movies: 'lists.kind.moviesHint',
  series: 'lists.kind.seriesHint',
  movies_and_series: 'lists.kind.moviesAndSeriesHint',
  books: 'lists.kind.booksHint',
  board: 'lists.kind.boardHint',
};

/** The order they are offered in. Films and series together sit next to each. */
export const LIST_KIND_ORDER: ListKind[] = [
  'tasks',
  'board',
  'movies',
  'series',
  'movies_and_series',
  'books',
];

/** Las listas en las que el orden manual es el unico que significa algo. */
export function isManualOrderOnly(kind: ListKind | null | undefined): boolean {
  return kind === 'board' || kind === 'tasks';
}
