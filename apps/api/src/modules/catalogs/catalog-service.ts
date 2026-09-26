import type {
  CatalogCollection,
  CatalogDetails,
  CatalogKind,
  CatalogRelated,
  CatalogResult,
} from '@orbit-hub/contracts';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * External catalogs: TheMovieDB for films and series, Google Books for books.
 *
 * Two rules shape this module:
 *
 * 1. **The provider keys never leave the API.** The app asks OrbitHub, never
 *    TMDB or Google directly, so a key cannot be extracted from a bundle and the
 *    quota belongs to the project instead of to whoever installed the app.
 * 2. **Both providers are normalised into one shape.** A list item stores an
 *    `externalId` and a `metadata` blob, and the screens must not care whether a
 *    title came from TMDB or from Google Books. Adding a third provider is a new
 *    adapter and nothing else.
 */

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_configured' | 'unavailable' | 'bad_query',
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export function isCatalogConfigured(kind: CatalogKind): boolean {
  return kind === 'books' ? booksConfigured() : tmdbConfigured();
}

function tmdbConfigured(): boolean {
  return Boolean(env.TMDB_API_KEY);
}

function booksConfigured(): boolean {
  return Boolean(env.GOOGLE_BOOKS_API_KEY);
}

/* ------------------------------------------------------------------ caching -- */

/**
 * A tiny TTL cache. Searching a catalog is expensive and the same query comes
 * back constantly while someone browses, and the providers rate limit hard
 * enough that a double click can exhaust a quota.
 */
/** Search hits and detail records are cached together under one budget. */
type CacheValue = CatalogResult[] | CatalogDetails;

const cache = new Map<string, { expiresAt: number; value: CacheValue }>();

function readCache<T extends CacheValue>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function writeCache(key: string, value: CacheValue): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Cheap eviction: the oldest insertion, which Map keeps first.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

export function clearCatalogCache(): void {
  cache.clear();
}

async function fetchJson(url: URL, accept: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      signal: controller.signal,
    });

    if (!response.ok) {
      // 401 and 403 mean the key is wrong, which is a configuration problem the
      // owner has to see, not a transient failure to retry silently.
      logger.warn({ status: response.status, url: url.pathname }, 'catalog provider rejected');
      throw new CatalogError('The catalog provider is unavailable', 'unavailable');
    }

    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    logger.warn({ err: error }, 'catalog provider unreachable');
    throw new CatalogError('The catalog provider could not be reached', 'unavailable');
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------- TMDB -- */

const tmdbMovieSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  overview: z.string().optional(),
  poster_path: z.string().nullable().optional(),
});

const tmdbSearchSchema = z.object({
  results: z.array(tmdbMovieSchema),
});

function tmdbKindPath(kind: CatalogKind): { path: string; type: 'movie' | 'tv' } {
  return kind === 'tv' ? { path: 'tv', type: 'tv' } : { path: 'movie', type: 'movie' };
}

async function searchTmdb(kind: CatalogKind, query: string): Promise<CatalogResult[]> {
  if (!tmdbConfigured()) {
    throw new CatalogError(`The ${kind} catalog is not configured`, 'not_configured');
  }

  const { path } = tmdbKindPath(kind);
  const url = new URL(`https://api.themoviedb.org/3/search/${path}`);
  url.searchParams.set('api_key', env.TMDB_API_KEY as string);
  url.searchParams.set('query', query);
  url.searchParams.set('language', 'es-ES');
  url.searchParams.set('include_adult', 'false');

  const payload = tmdbSearchSchema.parse(await fetchJson(url, 'application/json'));

  return payload.results.slice(0, 20).map<CatalogResult>((entry) => {
    const year = (entry.release_date ?? entry.first_air_date ?? '').slice(0, 4) || null;
    return {
      provider: 'tmdb',
      externalId: `${path}:${entry.id}`,
      kind,
      title: entry.title ?? entry.name ?? 'Sin título',
      subtitle: year,
      overview: entry.overview && entry.overview.length > 0 ? entry.overview : null,
      imageUrl: entry.poster_path
        ? `https://image.tmdb.org/t/p/w342${entry.poster_path}`
        : null,
      metadata: {
        tmdbId: entry.id,
        type: path === 'tv' ? 'tv' : 'movie',
        ...(year ? { year } : {}),
        ...(entry.release_date ? { releaseDate: entry.release_date } : {}),
        ...(entry.first_air_date ? { firstAirDate: entry.first_air_date } : {}),
      },
    };
  });
}

/* ------------------------------------------------------------- Google Books -- */

const googleBookSchema = z.object({
  id: z.string(),
  volumeInfo: z
    .object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      authors: z.array(z.string()).optional(),
      publishedDate: z.string().optional(),
      publisher: z.string().optional(),
      description: z.string().optional(),
      categories: z.array(z.string()).optional(),
      averageRating: z.number().optional(),
      industryIdentifiers: z
        .array(z.object({ type: z.string().optional(), identifier: z.string().optional() }))
        .optional(),
      imageLinks: z
        .object({
          thumbnail: z.string().optional(),
          smallThumbnail: z.string().optional(),
        })
        .optional(),
      pageCount: z.number().optional(),
    })
    .optional(),
});

const googleBooksSchema = z.object({
  items: z.array(googleBookSchema).optional(),
});

/**
 * Google serves thumbnails over http, which a page served over https is not
 * allowed to load. Upgrading the host is enough; the path already encodes the
 * size.
 */
function httpsImage(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/^http:/, 'https:');
}

async function searchGoogleBooks(query: string): Promise<CatalogResult[]> {
  if (!booksConfigured()) {
    throw new CatalogError('The books catalog is not configured', 'not_configured');
  }

  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', query);
  url.searchParams.set('key', env.GOOGLE_BOOKS_API_KEY as string);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('printType', 'books');

  const payload = googleBooksSchema.parse(await fetchJson(url, 'application/json'));

  const results: CatalogResult[] = [];
  for (const item of payload.items ?? []) {
    const info = item.volumeInfo;
    // A volume can come back with no metadata at all; a hit with no title is
    // noise, not a result.
    if (!info?.title) continue;

    const year = (info.publishedDate ?? '').slice(0, 4) || null;
    const authors = info.authors ?? [];

    results.push({
      provider: 'google-books',
      externalId: item.id,
      kind: 'books',
      title: info.title,
      subtitle: authors.length > 0 ? authors.join(', ') : year,
      overview: info.description && info.description.length > 0 ? info.description : null,
      imageUrl: httpsImage(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
      metadata: {
        googleVolumeId: item.id,
        ...(authors.length > 0 ? { authors } : {}),
        ...(year ? { year } : {}),
        ...(info.publishedDate ? { publishedDate: info.publishedDate } : {}),
        ...(info.pageCount ? { pageCount: info.pageCount } : {}),
      },
    });
  }

  return results;
}

/* ------------------------------------------------------------------ facade -- */

/** Which list kind can be fed from which catalog. */
export function catalogKindsFor(listKind: string): CatalogKind[] {
  switch (listKind) {
    case 'movies':
      return ['movies', 'tv'];
    case 'books':
      return ['books'];
    default:
      return ['movies', 'tv', 'books'];
  }
}

/* ----------------------------------------------------------------- details -- */

const tmdbGenreSchema = z.object({ id: z.number(), name: z.string() });

const tmdbMovieDetailSchema = tmdbMovieSchema.extend({
  tagline: z.string().optional(),
  status: z.string().optional(),
  runtime: z.number().nullable().optional(),
  vote_average: z.number().optional(),
  homepage: z.string().optional(),
  genres: z.array(tmdbGenreSchema).optional(),
  belongs_to_collection: z
    .object({
      id: z.number(),
      name: z.string(),
      overview: z.string().optional(),
      poster_path: z.string().nullable().optional(),
    })
    .nullish(),
});

const tmdbSeriesDetailSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  overview: z.string().optional(),
  tagline: z.string().optional(),
  status: z.string().optional(),
  first_air_date: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  vote_average: z.number().optional(),
  homepage: z.string().optional(),
  genres: z.array(tmdbGenreSchema).optional(),
  number_of_seasons: z.number().optional(),
  number_of_episodes: z.number().optional(),
  episode_run_time: z.array(z.number()).optional(),
});

/** A poster-sized reference to another title, for collections and similar. */
const relatedSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  overview: z.string().optional(),
});

const tmdbRelatedSchema = z
  .object({
    results: z.array(relatedSchema).optional(),
  })
  .optional()
  .nullable();

const googleBookDetailSchema = googleBookSchema;

async function fetchTmdbDetails(
  kind: 'movies' | 'tv',
  externalId: string,
): Promise<CatalogDetails> {
  if (!tmdbConfigured()) {
    throw new CatalogError(`The ${kind} catalog is not configured`, 'not_configured');
  }

  // The search results already know the path, so no extra round trip is needed.
  const [type, raw] = externalId.split(':');
  const path = type === 'tv' ? 'tv' : 'movie';
  if (!raw) {
    throw new CatalogError('That identifier does not belong to this catalog', 'bad_query');
  }

  const url = new URL(`https://api.themoviedb.org/3/${path}/${encodeURIComponent(raw)}`);
  url.searchParams.set('api_key', env.TMDB_API_KEY as string);
  url.searchParams.set('language', 'es-ES');
  // The cast, the franchise and the "more like this" list all come back on the
  // same call. Asking for them separately would be three round trips per title.
  url.searchParams.append('append_to_response', 'credits,similar,recommendations');

  const rawPayload = (await fetchJson(url, 'application/json')) as Record<string, unknown>;
  const payload = (kind === 'tv' ? tmdbSeriesDetailSchema : tmdbMovieDetailSchema).parse(rawPayload);

  const genres = (payload.genres ?? []).map((genre) => genre.name);
  // A film reports release_date and a series first_air_date, so the branch is on
  // the parsed union rather than on a field both may or may not have.
  const film = 'release_date' in payload ? payload : null;
  const series = 'number_of_seasons' in payload ? payload : null;

  const year = (film?.release_date ?? series?.first_air_date ?? '').slice(0, 4) || null;
  const credits = (rawPayload['credits'] ?? {}) as { cast?: { name?: string }[] };
  const cast = (credits.cast ?? [])
    .map((person) => person.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 12);

  const title = (film?.title ?? series?.name) || 'Sin título';
  const runtime = film?.runtime ?? series?.episode_run_time?.[0] ?? null;
  const backdrop = rawPayload['backdrop_path'];
  const poster = film?.poster_path ?? series?.poster_path ?? null;

  const toRelated = (entry: z.infer<typeof relatedSchema>): CatalogRelated => {
    const year = (entry.release_date ?? entry.first_air_date ?? '').slice(0, 4) || null;
    return {
      externalId: `${path}:${entry.id}`,
      title: entry.title ?? entry.name ?? 'Sin título',
      imageUrl: entry.poster_path
        ? `https://image.tmdb.org/t/p/w342${entry.poster_path}`
        : null,
      released: year,
    };
  };

  // The franchise, when the title belongs to one.
  const collectionRaw = rawPayload['belongs_to_collection'] as
    | { id: number; name: string; overview?: string; poster_path?: string | null }
    | null
    | undefined;

  // "Similar" and "recommended" overlap heavily; recommendations are better
  // curated, so they are preferred and the rest of the similar list fills in.
  // Both are absent for some titles, so neither is required.
  const recommended = (tmdbRelatedSchema.parse(rawPayload['recommendations'])?.results ?? []).map(
    toRelated,
  );
  const similar = (tmdbRelatedSchema.parse(rawPayload['similar'])?.results ?? []).map(toRelated);

  const seen = new Set(recommended.map((entry) => entry.externalId));
  const related = [
    ...recommended,
    ...similar.filter((entry) => !seen.has(entry.externalId) && entry.externalId !== externalId),
  ].slice(0, 12);

  // The rest of the franchise, fetched only when there is one.
  let collection: CatalogCollection | null = null;
  if (collectionRaw?.id) {
    const collectionUrl = new URL(
      `https://api.themoviedb.org/3/collection/${collectionRaw.id}`,
    );
    collectionUrl.searchParams.set('api_key', env.TMDB_API_KEY as string);
    collectionUrl.searchParams.set('language', 'es-ES');
    const payload = z
      .object({
        name: z.string().optional(),
        overview: z.string().optional(),
        poster_path: z.string().nullable().optional(),
        backdrop_path: z.string().nullable().optional(),
        parts: z.array(relatedSchema).optional(),
      })
      .parse(await fetchJson(collectionUrl, 'application/json'));

    collection = {
      name: payload.name ?? collectionRaw.name,
      overview: payload.overview ?? null,
      imageUrl: payload.poster_path
        ? `https://image.tmdb.org/t/p/w342${payload.poster_path}`
        : null,
      backdropUrl: payload.backdrop_path
        ? `https://image.tmdb.org/t/p/w780${payload.backdrop_path}`
        : null,
      items: (payload.parts ?? [])
        .map(toRelated)
        .filter((entry) => entry.externalId !== externalId)
        .slice(0, 12),
    };
  }

  // Built as a whole rather than inline, so the two branches of the union do
  // not have to be reconciled by the compiler at a single return statement.
  const details: CatalogDetails = {
    provider: 'tmdb',
    externalId,
    kind,
    title,
    imageUrl: poster ? `https://image.tmdb.org/t/p/w342${poster}` : null,
    backdropUrl: typeof backdrop === 'string' && backdrop
      ? `https://image.tmdb.org/t/p/w780${backdrop}`
      : null,
    overview: payload.overview && payload.overview.length > 0 ? payload.overview : null,
    tagline: payload.tagline ?? null,
    released: year,
    status: payload.status ?? null,
    runtime,
    genres,
    score: payload.vote_average ?? null,
    scoreOutOf: 10,
    authors: [],
    ...(payload.homepage ? { homepage: payload.homepage } : {}),
    ...(series?.number_of_seasons
      ? {
          seasons: series.number_of_seasons,
          ...(series.number_of_episodes ? { episodes: series.number_of_episodes } : {}),
        }
      : {}),
    ...(cast.length > 0 ? { cast } : {}),
    ...(related.length > 0 ? { related } : {}),
    ...(collection ? { collection } : {}),
  };

  return details;
}

async function fetchGoogleBookDetails(externalId: string): Promise<CatalogDetails> {
  if (!booksConfigured()) {
    throw new CatalogError('The books catalog is not configured', 'not_configured');
  }

  const url = new URL(
    `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(externalId)}`,
  );
  url.searchParams.set('key', env.GOOGLE_BOOKS_API_KEY as string);

  const payload = googleBookDetailSchema.parse(await fetchJson(url, 'application/json'));
  const info = payload.volumeInfo;
  if (!info?.title) {
    throw new CatalogError('The provider returned no details for this book', 'unavailable');
  }

  const authors = info.authors ?? [];

  return {
    provider: 'google-books',
    externalId,
    kind: 'books',
    title: info.title,
    imageUrl: httpsImage(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    backdropUrl: null,
    overview: info.description && info.description.length > 0 ? info.description : null,
    tagline: info.subtitle ?? null,
    released: (info.publishedDate ?? '').slice(0, 4) || null,
    status: null,
    runtime: info.pageCount ?? null,
    genres: info.categories ?? [],
    score: info.averageRating ?? null,
    // Google Books rates out of five, not out of ten.
    scoreOutOf: 5,
    authors,
    ...(info.publisher ? { publisher: info.publisher } : {}),
    ...(info.industryIdentifiers ? { identifiers: info.industryIdentifiers } : {}),
  };
}

/** Full record for one item, for the detail screen. */
export async function fetchCatalogDetails(
  kind: CatalogKind,
  externalId: string,
): Promise<CatalogDetails> {
  const key = `detail:${kind}:${externalId}`;
  const cached = readCache<CatalogDetails>(key);
  if (cached) return cached;

  const details =
    kind === 'books'
      ? await fetchGoogleBookDetails(externalId)
      : await fetchTmdbDetails(kind, externalId);

  writeCache(key, details);
  return details;
}

export async function searchCatalog(kind: CatalogKind, rawQuery: string): Promise<CatalogResult[]> {
  const query = rawQuery.trim().slice(0, 120);
  if (query.length < 2) {
    throw new CatalogError('Type at least two characters', 'bad_query');
  }

  const key = `${kind}:${query.toLowerCase()}`;
  const cached = readCache<CatalogResult[]>(key);
  if (cached) return cached;

  const results: CatalogResult[] =
    kind === 'books' ? await searchGoogleBooks(query) : await searchTmdb(kind, query);
  writeCache(key, results);
  return results;
}
