import { describe, expect, it } from 'vitest';

import type { ListItem } from '@orbit-hub/contracts';

import { isMediaList, mediaCardOf } from '../src/lib/lists/media-card';

/**
 * A row of a list.
 *
 * The helper exists so a test says what it is about: adding the fields a
 * contract grows is a one line change here instead of a dozen.
 */
function makeItem(partial: Partial<ListItem> & { externalId: string | null }): ListItem {
  return {
    id: 'item-1',
    listId: 'list-1',
    version: 1,
    title: 'Matrix',
    position: 0,
    completed: false,
    favorite: false,
    priority: 'none',
    icon: null,
    tags: [],
    metadata: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

describe('isMediaList', () => {
  it('is true for every kind whose items are covers', () => {
    expect(isMediaList('movies')).toBe(true);
    expect(isMediaList('series')).toBe(true);
    expect(isMediaList('movies_and_series')).toBe(true);
    expect(isMediaList('books')).toBe(true);
  });

  it('is false for a tasks list', () => {
    // A poster next to "buy milk" helps nobody, which is exactly the mixing
    // the two kinds of list exist to avoid.
    expect(isMediaList('tasks')).toBe(false);
  });

  it('is false for a missing or unknown kind', () => {
    expect(isMediaList(null)).toBe(false);
    expect(isMediaList(undefined)).toBe(false);
    expect(isMediaList('whatever')).toBe(false);
  });
});

describe('mediaCardOf', () => {
  it('returns nothing for a hand written item, which has no provider record', () => {
    expect(mediaCardOf(makeItem({ externalId: null }))).toBeNull();
  });

  it('returns nothing for a catalog item with no picture', () => {
    // The card is the picture. Without one there is nothing to show but a grey
    // hole, so the caller falls back to a text row instead.
    expect(
      mediaCardOf(makeItem({ externalId: 'movie:603', metadata: { year: '1999' } })),
    ).toBeNull();
  });

  it('reads the poster, the year and the provider off a film', () => {
    const card = mediaCardOf(
      makeItem({
        externalId: 'movie:603',
        metadata: {
          provider: 'tmdb',
          type: 'movie',
          year: '1999',
          releaseDate: '1999-03-31',
          imageUrl: 'https://image.tmdb.org/t/p/w342/x.jpg',
        },
      }),
    );

    expect(card?.imageUrl).toBe('https://image.tmdb.org/t/p/w342/x.jpg');
    expect(card?.released).toBe('1999');
    expect(card?.provider).toBe('tmdb');
    expect(card?.mediaKind).toBe('movie');
  });

  it('takes the year from the release date, which is more precise', () => {
    const card = mediaCardOf(
      makeItem({
        externalId: 'movie:603',
        metadata: { releaseDate: '1999-03-31', imageUrl: 'https://x/y.jpg' },
      }),
    );

    expect(card?.released).toBe('1999');
  });

  it('reads a book the same way, with its publication date', () => {
    const card = mediaCardOf(
      makeItem({
        externalId: 'kmAQCwAAQBAJ',
        metadata: {
          provider: 'google-books',
          publishedDate: '2015-06-04',
          imageUrl: 'https://books.google.com/x.jpg',
        },
      }),
    );

    expect(card?.released).toBe('2015');
    expect(card?.provider).toBe('google-books');
  });

  it('returns nothing when the metadata is the wrong shape entirely', () => {
    // A cache written by a future build, or a corrupt one, must not make the
    // screen throw: there is simply no card to draw.
    expect(
      mediaCardOf(
        makeItem({
          externalId: 'movie:603',
          metadata: { imageUrl: 42, year: {}, provider: [] } as never,
        }),
      ),
    ).toBeNull();
  });

  it('keeps the item untouched', () => {
    const item = makeItem({
      externalId: 'movie:603',
      metadata: { imageUrl: 'https://x/y.jpg' },
    });
    const before = JSON.stringify(item.metadata);

    mediaCardOf(item);

    expect(JSON.stringify(item.metadata)).toBe(before);
  });
});
