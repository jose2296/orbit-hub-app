import type { CatalogKind, ListKind } from '@orbit-hub/contracts';

/**
 * Which catalogs may fill a list.
 *
 * A books list that searches TheMovieDB finds nothing, and the user sees an
 * empty result for a book that plainly exists. The list decides, and this
 * function never returns an empty list, so the search screen always has at
 * least one catalog to query.
 */
export function allowedCatalogKinds(listKind: ListKind | null | undefined): CatalogKind[] {
  switch (listKind) {
    case 'books':
      return ['books'];
    case 'movies':
      return ['movies', 'tv'];
    default:
      // A tasks list has no opinion, and a value from a future build or a
      // corrupt cache must not leave the screen with no search at all.
      return ['movies', 'tv', 'books'];
  }
}
