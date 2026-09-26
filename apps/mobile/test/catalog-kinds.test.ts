import { describe, expect, it } from 'vitest';

import { allowedCatalogKinds, hasCatalog } from '../src/lib/lists/catalog-kinds';

/**
 * Which catalogs a list may show.
 *
 * A books list that searches TheMovieDB finds nothing, and the person sees an
 * empty result for a book that plainly exists. The list decides, and now the
 * list is one kind for good, so the decision is exact rather than a preference.
 */
describe('allowedCatalogKinds', () => {
  it('offers only books for a books list', () => {
    expect(allowedCatalogKinds('books')).toEqual(['books']);
  });

  it('offers only films for a films list', () => {
    expect(allowedCatalogKinds('movies')).toEqual(['movies']);
  });

  it('offers only series for a series list', () => {
    expect(allowedCatalogKinds('series')).toEqual(['tv']);
  });

  it('offers films and series for a list of both, films first', () => {
    // A list that is both is one intention, and the order of the tabs follows
    // it: films first, because that is the word in the name.
    expect(allowedCatalogKinds('movies_and_series')).toEqual(['movies', 'tv']);
  });

  it('offers nothing for a tasks list, because no provider has "buy milk"', () => {
    expect(allowedCatalogKinds('tasks')).toEqual([]);
  });

  it('offers nothing for a kind from the future rather than a wrong catalog', () => {
    // A list written by a newer version, or a corrupt cache value, must not end
    // up searching a catalog that has nothing to do with it.
    expect(allowedCatalogKinds('whatever' as never)).toEqual([]);
  });

  it('offers nothing when the list is not known at all', () => {
    expect(allowedCatalogKinds(undefined)).toEqual([]);
    expect(allowedCatalogKinds(null)).toEqual([]);
  });
});

describe('hasCatalog', () => {
  it('is true for every kind of list that has something to search', () => {
    for (const kind of ['movies', 'series', 'movies_and_series', 'books'] as const) {
      expect(hasCatalog(kind)).toBe(true);
    }
  });

  it('is false for a tasks list, so the search screen is not offered', () => {
    expect(hasCatalog('tasks')).toBe(false);
  });
});
