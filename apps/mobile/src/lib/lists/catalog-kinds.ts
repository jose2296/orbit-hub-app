import type { CatalogKind, ListKind } from '@orbit-hub/contracts';

/**
 * Which catalogs may fill a list.
 *
 * The list decides, because a list of books that searches TheMovieDB finds
 * nothing and the person sees an empty result for a book that plainly exists.
 * A list of tasks has no catalog at all: there is no provider that has "buy
 * milk", and the search screen is not offered for one.
 */
export function allowedCatalogKinds(listKind: ListKind | null | undefined): CatalogKind[] {
  switch (listKind) {
    case 'books':
      return ['books'];
    case 'movies':
      return ['movies'];
    case 'series':
      return ['tv'];
    case 'movies_and_series':
      return ['movies', 'tv'];
    default:
      // A tasks list has nothing to search, and a value from a future build or a
      // corrupt cache must not offer a catalog that does not apply.
      return [];
  }
}

/** Whether the search screen makes sense for a list. */
export function hasCatalog(listKind: ListKind | null | undefined): boolean {
  return allowedCatalogKinds(listKind).length > 0;
}
