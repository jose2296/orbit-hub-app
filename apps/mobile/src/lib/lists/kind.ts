import { Ionicons } from '@expo/vector-icons';

import type { ListKind } from '@orbit-hub/contracts';

import type { TranslationKey } from '@/lib/i18n';

/**
 * What each kind of list looks like.
 *
 * One place, because the same five kinds appear in the picker of a new list,
 * in the row of a list, in the carousel and in the search results, and a kind
 * that has an icon in one of them and not in another reads as a missing one.
 */
export const LIST_KIND_ICON: Record<ListKind, keyof typeof Ionicons.glyphMap> = {
  tasks: 'checkbox-outline',
  movies: 'film-outline',
  series: 'tv-outline',
  movies_and_series: 'albums-outline',
  books: 'book-outline',
};

export const LIST_KIND_LABEL: Record<ListKind, TranslationKey> = {
  tasks: 'lists.kind.tasks',
  movies: 'lists.kind.movies',
  series: 'lists.kind.series',
  movies_and_series: 'lists.kind.moviesAndSeries',
  books: 'lists.kind.books',
};

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
};

/** The order they are offered in. Films and series together sit next to each. */
export const LIST_KIND_ORDER: ListKind[] = [
  'tasks',
  'movies',
  'series',
  'movies_and_series',
  'books',
];
