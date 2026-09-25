import { describe, expect, it } from 'vitest';

import { allowedCatalogKinds } from '../src/lib/lists/catalog-kinds';

/**
 * Which catalogs a list may show.
 *
 * A books list that searches TheMovieDB finds nothing, and the user sees an
 * empty result for a book that plainly exists. The list decides, not the
 * default, and a list of tasks may use every catalog.
 */
describe('allowedCatalogKinds', () => {
  it('offers only books for a books list', () => {
    expect(allowedCatalogKinds('books')).toEqual(['books']);
  });

  it('offers films and series for a films list, in that order', () => {
    // Films first: a films list is about films, and series is the second tab.
    expect(allowedCatalogKinds('movies')).toEqual(['movies', 'tv']);
  });

  it('offers everything for a tasks list', () => {
    expect(allowedCatalogKinds('tasks')).toEqual(['movies', 'tv', 'books']);
  });

  it('offers films for an unknown kind rather than nothing', () => {
    // A list written by a future version, or a corrupt cache value, must still
    // offer something usable.
    expect(allowedCatalogKinds('whatever' as never).length).toBeGreaterThan(0);
  });

  it('never returns an empty list, which would leave the screen with no search', () => {
    for (const kind of ['tasks', 'movies', 'books', undefined, ''] as const) {
      expect(allowedCatalogKinds(kind as never).length).toBeGreaterThan(0);
    }
  });
});
