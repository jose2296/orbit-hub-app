import { describe, expect, it } from 'vitest';

import type { ListItem } from '@orbit-hub/contracts';

import { providerRefOf } from '../src/lib/lists/provider-ref';

/**
 * Which provider a title is asked about.
 *
 * The bug this stops: the detail screen asked the provider of the *list*, so a
 * book in a list that is not a books list, or a title written by hand, came back
 * with nothing and a screen that said "algo ha ido mal" instead of the title.
 */
function item(partial: Partial<ListItem> & { id: string }): ListItem {
  return {
    listId: 'l1',
    version: 1,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    title: 'Algo',
    position: 0,
    completed: false,
    favorite: false,
    priority: 'none',
    icon: null,
    tags: [],
    externalId: null,
    metadata: null,
    notes: null,
    ...partial,
  };
}

describe('providerRefOf', () => {
  it('believes the id that says what it is', () => {
    expect(providerRefOf(item({ id: 'a', externalId: 'movie:603' }))).toEqual({
      provider: 'tmdb',
      kind: 'movies',
      externalId: 'movie:603',
    });
    expect(providerRefOf(item({ id: 'a', externalId: 'tv:1396' }))).toEqual({
      provider: 'tmdb',
      kind: 'tv',
      externalId: 'tv:1396',
    });
  });

  it('believes the metadata when the id says nothing', () => {
    // This is the case that broke: a book from Google Books has an id of twelve
    // characters and no prefix, so without the metadata there is no way to tell
    // it from a film.
    expect(
      providerRefOf(
        item({ id: 'a', externalId: 'cCcMEAAAQBAJ', metadata: { provider: 'google-books' } }),
      ),
    ).toEqual({ provider: 'google-books', kind: 'books', externalId: 'cCcMEAAAQBAJ' });

    expect(providerRefOf(item({ id: 'a', externalId: 'x', metadata: { type: 'tv' } }))).toEqual({
      provider: 'tmdb',
      kind: 'tv',
      externalId: 'x',
    });
  });

  it('falls back to the shape of the id when nothing says what it is', () => {
    // A volume id from Google Books is long and a TMDB id never is, and this is
    // the only signal left for a record written by an old build.
    expect(providerRefOf(item({ id: 'a', externalId: 'cCcMEAAAQBAJ' }))?.kind).toBe('books');
    expect(providerRefOf(item({ id: 'a', externalId: '603' }))?.kind).toBe('movies');
  });

  it('says a row written by hand has no provider record', () => {
    // Not a failure and not an error: the row is a perfectly good row, it just
    // is not one the catalog knows.
    expect(providerRefOf(item({ id: 'a', title: 'Mi diario' }))).toBeNull();
    expect(providerRefOf(item({ id: 'a', externalId: '' }))).toBeNull();
    expect(providerRefOf(null)).toBeNull();
  });

  it('ignores an id that is not a string', () => {
    // A payload from a client that sends what it knows, with the field present
    // and empty of anything usable.
    expect(
      providerRefOf(item({ id: 'a', externalId: 42 as unknown as string })),
    ).toBeNull();
  });
});
