import type { CatalogKind, CatalogResult } from '@orbit-hub/contracts';
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
const cache = new Map<string, { expiresAt: number; value: CatalogResult[] }>();

function readCache(key: string): CatalogResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: CatalogResult[]): void {
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
      description: z.string().optional(),
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

export async function searchCatalog(kind: CatalogKind, rawQuery: string): Promise<CatalogResult[]> {
  const query = rawQuery.trim().slice(0, 120);
  if (query.length < 2) {
    throw new CatalogError('Type at least two characters', 'bad_query');
  }

  const key = `${kind}:${query.toLowerCase()}`;
  const cached = readCache(key);
  if (cached) return cached;

  const results = kind === 'books' ? await searchGoogleBooks(query) : await searchTmdb(kind, query);
  writeCache(key, results);
  return results;
}
