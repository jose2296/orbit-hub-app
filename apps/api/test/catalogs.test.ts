import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The catalog adapters are tested against stubbed providers: the mapping from a
 * provider's payload to the shared shape is the part that can break silently, and
 * it must not depend on a real key or on the network.
 */

const env = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  TMDB_API_KEY: 'tmdb-test-key',
  GOOGLE_BOOKS_API_KEY: 'books-test-key',
};

vi.mock('../src/config/env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config/env.js')>()),
  env,
}));

const {
  CatalogError,
  catalogKindsFor,
  clearCatalogCache,
  fetchCatalogDetails,
  searchCatalog,
} = await import('../src/modules/catalogs/catalog-service.js');

const requests: URL[] = [];

function stubFetch(handler: (url: URL) => unknown) {
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(String(input));
    requests.push(url);
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

beforeEach(() => {
  requests.length = 0;
  clearCatalogCache();
  env.TMDB_API_KEY = 'tmdb-test-key';
  env.GOOGLE_BOOKS_API_KEY = 'books-test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchCatalog: TheMovieDB', () => {
  it('maps a movie result into the shared shape', async () => {
    stubFetch(() => ({
      results: [
        {
          id: 27205,
          title: 'Inception',
          release_date: '2010-07-15',
          overview: 'A thief who steals corporate secrets…',
          poster_path: '/poster.jpg',
        },
      ],
    }));

    const [result] = await searchCatalog('movies', 'inception');

    expect(result?.provider).toBe('tmdb');
    // Namespaced by type: a film and a series can share a numeric id.
    expect(result?.externalId).toBe('movie:27205');
    expect(result?.title).toBe('Inception');
    expect(result?.subtitle).toBe('2010');
    expect(result?.imageUrl).toBe('https://image.tmdb.org/t/p/w342/poster.jpg');
    expect(result?.metadata).toMatchObject({ tmdbId: 27205, type: 'movie', year: '2010' });
  });

  it('sends the key in the query and never in the path', async () => {
    stubFetch(() => ({ results: [] }));
    await searchCatalog('movies', 'dune');

    const url = requests[0];
    expect(url?.hostname).toBe('api.themoviedb.org');
    expect(url?.searchParams.get('api_key')).toBe('tmdb-test-key');
    expect(url?.pathname).not.toContain('tmdb-test-key');
  });

  it('uses the tv endpoint and first_air_date for a series', async () => {
    stubFetch(() => ({
      results: [{ id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17' }],
    }));

    const [result] = await searchCatalog('tv', 'game of thrones');

    expect(requests[0]?.pathname).toContain('/search/tv');
    expect(result?.title).toBe('Game of Thrones');
    expect(result?.externalId).toBe('tv:1399');
    expect(result?.subtitle).toBe('2011');
  });

  it('skips adult results', async () => {
    stubFetch(() => ({ results: [] }));
    await searchCatalog('movies', 'anything');

    expect(requests[0]?.searchParams.get('include_adult')).toBe('false');
  });
});

describe('searchCatalog: Google Books', () => {
  it('maps a volume, upgrades the thumbnail to https and keeps the authors', async () => {
    stubFetch(() => ({
      items: [
        {
          id: 'abc123',
          volumeInfo: {
            title: 'Cien años de soledad',
            authors: ['Gabriel García Márquez'],
            publishedDate: '1967-05-30',
            description: 'La saga de la familia Buendía.',
            pageCount: 471,
            imageLinks: { thumbnail: 'http://books.google.com/books/content?id=abc123&printsec=frontcover' },
          },
        },
      ],
    }));

    const [result] = await searchCatalog('books', 'cien años');

    expect(result?.provider).toBe('google-books');
    expect(result?.externalId).toBe('abc123');
    expect(result?.subtitle).toBe('Gabriel García Márquez');
    // A page served over https cannot load an http image.
    expect(result?.imageUrl?.startsWith('https://')).toBe(true);
    expect(result?.metadata).toMatchObject({ pageCount: 471, year: '1967' });
  });

  it('drops volumes that come back with no title', async () => {
    stubFetch(() => ({ items: [{ id: 'x' }, { id: 'y', volumeInfo: { title: 'Con título' } }] }));

    const results = await searchCatalog('books', 'buscar');

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Con título');
  });

  it('copes with a response with no items at all', async () => {
    stubFetch(() => ({}));

    await expect(searchCatalog('books', 'nada')).resolves.toEqual([]);
  });
});

describe('searchCatalog: shared behaviour', () => {
  it('refuses a query shorter than two characters', async () => {
    const error = await searchCatalog('movies', ' a ').catch((caught) => caught);

    expect(error).toBeInstanceOf(CatalogError);
    expect((error as InstanceType<typeof CatalogError>).reason).toBe('bad_query');
  });

  it('serves the second identical query from the cache', async () => {
    stubFetch(() => ({ results: [{ id: 1, title: 'Cached' }] }));

    const first = await searchCatalog('movies', 'cacheada');
    const second = await searchCatalog('movies', 'CACHEADA');

    expect(second).toEqual(first);
    expect(requests).toHaveLength(1);
  });

  it('does not cache across catalogs', async () => {
    stubFetch(() => ({ results: [] }));
    await searchCatalog('movies', 'misma');
    await searchCatalog('books', 'misma');

    expect(requests).toHaveLength(2);
  });

  it('reports a provider error as unavailable, not as a crash', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));

    const error = await searchCatalog('movies', 'error').catch((caught) => caught);

    expect((error as InstanceType<typeof CatalogError>).reason).toBe('unavailable');
  });

  it('reports a network failure the same way', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });

    const error = await searchCatalog('books', 'error').catch((caught) => caught);

    expect((error as InstanceType<typeof CatalogError>).reason).toBe('unavailable');
  });
});

describe('fetchCatalogDetails', () => {
  it('maps a film: poster, backdrop, runtime, genres, score and cast', async () => {
    stubFetch((url) => {
      if (url.pathname.endsWith('/movie/603')) {
        return {
          id: 603,
          title: 'Matrix',
          overview: 'Un hacker descubre la realidad.',
          tagline: 'El futuro no es lo que era.',
          release_date: '1999-03-31',
          runtime: 136,
          status: 'Released',
          vote_average: 8.2,
          homepage: 'https://www.themoviedb.org/movie/603',
          poster_path: '/p.jpg',
          backdrop_path: '/b.jpg',
          genres: [{ id: 28, name: 'Acción' }, { id: 878, name: 'Ciencia ficción' }],
          credits: { cast: [{ name: 'Keanu Reeves' }, { name: 'Carrie-Anne Moss' }] },
        };
      }
      return {};
    });

    const details = await fetchCatalogDetails('movies', 'movie:603');

    expect(details.title).toBe('Matrix');
    expect(details.imageUrl).toContain('/p.jpg');
    expect(details.backdropUrl).toContain('/b.jpg');
    expect(details.runtime).toBe(136);
    expect(details.genres).toEqual(['Acción', 'Ciencia ficción']);
    expect(details.score).toBe(8.2);
    // The scale travels with the score: a book rated 3 out of 5 shown as 3/10
    // reads like a book nobody liked, and that is how it was.
    expect(details.scoreOutOf).toBe(10);
    expect(details.released).toBe('1999');
    expect(details.cast).toEqual(['Keanu Reeves', 'Carrie-Anne Moss']);
  });

  it('maps a series: seasons, episode length and first_air_date', async () => {
    stubFetch((url) => {
      if (url.pathname.endsWith('/tv/1396')) {
        return {
          id: 1396,
          name: 'Breaking Bad',
          first_air_date: '2008-01-20',
          episode_run_time: [47],
          number_of_seasons: 5,
          number_of_episodes: 62,
          status: 'Ended',
          genres: [{ id: 18, name: 'Drama' }],
        };
      }
      return {};
    });

    const details = await fetchCatalogDetails('tv', 'tv:1396');

    expect(details.title).toBe('Breaking Bad');
    expect(details.released).toBe('2008');
    expect(details.runtime).toBe(47);
    expect(details.seasons).toBe(5);
    expect(details.episodes).toBe(62);
  });

  it('returns the franchise with the rest of its parts', async () => {
    stubFetch((url) => {
      if (url.pathname.endsWith('/movie/603')) {
        return {
          id: 603, title: 'Matrix', release_date: '1999-03-31',
          belongs_to_collection: { id: 2344, name: 'Matrix' },
        };
      }
      if (url.pathname.includes('/collection/2344')) {
        return {
          name: 'Matrix',
          overview: 'La saga completa.',
          poster_path: '/c.jpg',
          parts: [
            { id: 603, title: 'Matrix' },
            { id: 604, title: 'Matrix Reloaded' },
          ],
        };
      }
      return {};
    });

    const details = await fetchCatalogDetails('movies', 'movie:603');

    expect(details.collection?.name).toBe('Matrix');
    expect(details.collection?.overview).toBe('La saga completa.');
    // The film itself is not listed as part of its own franchise.
    expect(details.collection?.items.map((i) => i.title)).toEqual(['Matrix Reloaded']);
  });

  it('merges recommendations before similar and never repeats a title', async () => {
    stubFetch((url) => {
      if (url.pathname.endsWith('/movie/603')) {
        return {
          id: 603, title: 'Matrix',
          recommendations: { results: [{ id: 1, title: 'Recomendada' }] },
          similar: {
            results: [
              { id: 1, title: 'Recomendada' },
              { id: 2, title: 'Parecida' },
              // The film itself can come back in its own similar list.
              { id: 603, title: 'Matrix' },
            ],
          },
        };
      }
      return {};
    });

    const details = await fetchCatalogDetails('movies', 'movie:603');
    const titles = details.related?.map((r) => r.title) ?? [];

    expect(titles[0]).toBe('Recomendada');
    expect(titles).toContain('Parecida');
    expect(titles.filter((t) => t === 'Recomendada')).toHaveLength(1);
    expect(titles).not.toContain('Matrix');
  });

  it('copes with a title that has no similar list at all', async () => {
    stubFetch(() => ({ id: 603, title: 'Matrix' }));

    const details = await fetchCatalogDetails('movies', 'movie:603');

    expect(details.related).toBeUndefined();
    expect(details.collection).toBeUndefined();
  });

  it('does not spend a call on a franchise that does not exist', async () => {
    stubFetch(() => ({ id: 603, title: 'Matrix' }));

    await fetchCatalogDetails('movies', 'movie:603');

    expect(requests.some((url) => url.pathname.includes('/collection/'))).toBe(false);
  });

  it('refuses an identifier that belongs to another catalog', async () => {
    stubFetch(() => ({}));

    const error = await fetchCatalogDetails('movies', 'no-namespace').catch((caught) => caught);

    expect((error as InstanceType<typeof CatalogError>).reason).toBe('bad_query');
    expect(requests).toHaveLength(0);
  });

  it('maps a book: authors, publisher, pages and rating', async () => {
    stubFetch((url) => {
      if (url.pathname.includes('/volumes/abc123')) {
        return {
          id: 'abc123',
          volumeInfo: {
            title: 'Cien años de soledad',
            subtitle: 'La saga de los Buendía',
            authors: ['Gabriel García Márquez'],
            publisher: 'Editorial Sudamericana',
            publishedDate: '1967-05-30',
            description: 'La historia de una familia.',
            pageCount: 471,
            averageRating: 4.7,
            categories: ['Fiction', 'Magic realism'],
            industryIdentifiers: [{ type: 'ISBN_10', identifier: '9780307474728' }],
          },
        };
      }
      return {};
    });

    const details = await fetchCatalogDetails('books', 'abc123');

    expect(details.title).toBe('Cien años de soledad');
    expect(details.tagline).toBe('La saga de los Buendía');
    expect(details.authors).toEqual(['Gabriel García Márquez']);
    expect(details.publisher).toBe('Editorial Sudamericana');
    expect(details.runtime).toBe(471);
    expect(details.score).toBe(4.7);
    // Google Books rates out of five, not out of ten.
    expect(details.scoreOutOf).toBe(5);
    expect(details.genres).toEqual(['Fiction', 'Magic realism']);
    expect(details.identifiers?.[0]?.type).toBe('ISBN_10');
  });

  it('caches a detail so opening the same item twice costs one call', async () => {
    stubFetch(() => ({
      id: 603,
      title: 'Matrix',
      release_date: '1999-03-31',
      poster_path: '/p.jpg',
    }));

    await fetchCatalogDetails('movies', 'movie:603');
    await fetchCatalogDetails('movies', 'movie:603');

    expect(requests).toHaveLength(1);
  });

  it('keeps search results and details in separate cache slots', async () => {
    // A search hit and a detail share the same provider id. If they collided in
    // the cache, opening the detail would return the list entry instead.
    stubFetch((url) =>
      url.pathname.includes('/search/')
        ? { results: [{ id: 603, title: 'Matrix from search' }] }
        : { id: 603, title: 'Matrix from details', release_date: '1999-03-31' },
    );

    await searchCatalog('movies', 'matrix');
    const details = await fetchCatalogDetails('movies', 'movie:603');

    expect(details.title).toBe('Matrix from details');
  });
});

describe('catalogKindsFor', () => {
  it('offers films and series for a films list', () => {
    expect(catalogKindsFor('movies')).toEqual(['movies', 'tv']);
  });

  it('offers only books for a books list', () => {
    expect(catalogKindsFor('books')).toEqual(['books']);
  });

  it('offers everything for a tasks list', () => {
    expect(catalogKindsFor('tasks')).toEqual(['movies', 'tv', 'books']);
  });
});
