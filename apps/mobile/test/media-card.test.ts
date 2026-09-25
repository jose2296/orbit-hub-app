import { describe, expect, it } from 'vitest';

import { isMediaList, mediaCardOf } from '../src/lib/lists/media-card';

/**
 * A media card is the picture. These rules decide when a list shows one and when
 * it falls back to a text row, and a wrong answer is either a grey hole where a
 * poster should be, or a poster next to "buy milk".
 */
describe('isMediaList', () => {
  it('treats films and books as media lists', () => {
    expect(isMediaList('movies')).toBe(true);
    expect(isMediaList('books')).toBe(true);
  });

  it('never treats a tasks list as media', () => {
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
    const item = {
      id: 'a', listId: 'l', title: 'Comprar pan', position: 0, completed: false,
      favorite: false, priority: 'none' as const, externalId: null, metadata: null,
      notes: null, version: 1, createdAt: '', updatedAt: '', deletedAt: null,
    };

    expect(mediaCardOf(item)).toBeNull();
  });

  it('reads the poster, the year and the provider off a film', () => {
    const item = {
      id: 'a', listId: 'l', title: 'Matrix', position: 0, completed: false,
      favorite: false, priority: 'none' as const, externalId: 'movie:603',
      metadata: {
        provider: 'tmdb', type: 'movie', year: '1999', releaseDate: '1999-03-31',
        imageUrl: 'https://image.tmdb.org/t/p/w342/p.jpg',
      },
      notes: null, version: 1, createdAt: '', updatedAt: '', deletedAt: null,
    };

    expect(mediaCardOf(item)).toEqual({
      imageUrl: 'https://image.tmdb.org/t/p/w342/p.jpg',
      released: '1999',
      provider: 'tmdb',
      mediaKind: 'movie',
    });
  });

  it('prefers the full release date over the bare year for a film', () => {
    const item = {
      id: 'a', listId: 'l', title: 'Matrix', position: 0, completed: false,
      favorite: false, priority: 'none' as const, externalId: 'movie:603',
      metadata: { year: '1999', releaseDate: '1999-03-31', imageUrl: 'https://x/p.jpg' },
      notes: null, version: 1, createdAt: '', updatedAt: '', deletedAt: null,
    };

    expect(mediaCardOf(item)?.released).toBe('1999');
  });

  it('reads the published date for a book', () => {
    const item = {
      id: 'a', listId: 'l', title: 'Cien años', position: 0, completed: false,
      favorite: false, priority: 'none' as const, externalId: 'abc123',
      metadata: {
        provider: 'google-books', year: '1967', publishedDate: '1967-05-30',
        imageUrl: 'https://books.google.com/content?id=abc123',
      },
      notes: null, version: 1, createdAt: '', updatedAt: '', deletedAt: null,
    };

    expect(mediaCardOf(item)).toMatchObject({ released: '1967', provider: 'google-books' });
  });

  it('returns nothing when a catalog item has no image, so the row falls back', () => {
    // The card is the picture. Without one it is a grey hole, and a text row
    // reads better than that.
    const item = {
      id: 'a', listId: 'l', title: 'Sin portada', position: 0, completed: false,
      favorite: false, priority: 'none' as const, externalId: 'xyz',
      metadata: { provider: 'tmdb', year: '2001' },
      notes: null, version: 1, createdAt: '', updatedAt: '', deletedAt: null,
    };

    expect(mediaCardOf(item)).toBeNull();
  });

  it('survives a metadata blob with the wrong types', () => {
    const item = {
      id: 'a', listId: 'l', title: 'Raro', position: 0, completed: false,
      favorite: false, priority: 'none' as const, externalId: 'x',
      metadata: { imageUrl: 42, year: {}, provider: [] },
      notes: null, version: 1, createdAt: '', updatedAt: '', deletedAt: null,
    };

    expect(mediaCardOf(item)).toBeNull();
  });

  it('reports no provider when the record has only an image', () => {
    const item = {
      id: 'a', listId: 'l', title: 'Solo poster', position: 0, completed: false,
      favorite: false, priority: 'none' as const, externalId: 'x',
      metadata: { imageUrl: 'https://x/p.jpg' },
      notes: null, version: 1, createdAt: '', updatedAt: '', deletedAt: null,
    };

    expect(mediaCardOf(item)).toEqual({
      imageUrl: 'https://x/p.jpg',
      released: null,
      provider: null,
      mediaKind: null,
    });
  });
});
