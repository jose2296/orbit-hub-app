import { z } from 'zod';

import { listKindSchema } from './workspace';
import { uuidSchema } from './common';

/**
 * Catalog search.
 *
 * The providers (TheMovieDB, Google Books) live behind the API, so their keys
 * never reach the app. Both are normalised into one shape here, which is what
 * lets a list item store an `externalId` and a `metadata` blob without the
 * screens knowing where a title came from.
 */

/** Which catalog to search. Mirrors the list kinds that can be fed. */
export const catalogKindSchema = z.enum(['movies', 'tv', 'books']);
export type CatalogKind = z.infer<typeof catalogKindSchema>;

export const catalogSearchQuerySchema = z.object({
  kind: catalogKindSchema,
  q: z.string().trim().min(2).max(120),
});
export type CatalogSearchQuery = z.infer<typeof catalogSearchQuerySchema>;

export const catalogResultSchema = z.object({
  /** 'tmdb' or 'google-books'. Stored in the item metadata. */
  provider: z.enum(['tmdb', 'google-books']),
  /** Stable id from the provider, namespaced by type where needed. */
  externalId: z.string().min(1).max(120),
  kind: catalogKindSchema,
  title: z.string().min(1).max(300),
  /** Year, author list, whatever the provider gives to disambiguate. */
  subtitle: z.string().max(200).nullable(),
  overview: z.string().max(2000).nullable(),
  imageUrl: z.url().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type CatalogResult = z.infer<typeof catalogResultSchema>;

export const catalogSearchResponseSchema = z.object({
  items: z.array(catalogResultSchema),
  /** The catalog that was searched, echoed for the client's convenience. */
  kind: catalogKindSchema,
  /** False when the provider has no key configured on this server. */
  configured: z.boolean(),
});
export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;

/**
 * One record in full, for the detail screen.
 *
 * Deliberately not stored in the list item: a detail is fetched when it is
 * opened, and a list keeps only enough to recognise the title offline.
 */
/** A poster-sized reference to another title. */
export const catalogRelatedSchema = z.object({
  externalId: z.string().min(1).max(120),
  title: z.string(),
  imageUrl: z.url().nullable(),
  released: z.string().nullable(),
});
export type CatalogRelated = z.infer<typeof catalogRelatedSchema>;

/** A franchise, with the rest of its parts. */
export const catalogCollectionSchema = z.object({
  name: z.string(),
  overview: z.string().nullable(),
  imageUrl: z.url().nullable(),
  backdropUrl: z.url().nullable(),
  items: z.array(catalogRelatedSchema),
});
export type CatalogCollection = z.infer<typeof catalogCollectionSchema>;

export const catalogDetailsSchema = z.object({
  provider: z.enum(['tmdb', 'google-books']),
  externalId: z.string().min(1).max(120),
  kind: catalogKindSchema,
  title: z.string(),
  imageUrl: z.url().nullable(),
  /** Wide image, used behind the header on a film or series. */
  backdropUrl: z.url().nullable(),
  overview: z.string().nullable(),
  /** TMDB tagline, or the subtitle of a book. */
  tagline: z.string().nullable(),
  /** Year, or the publication year for a book. */
  released: z.string().nullable(),
  /** "Released", "Returning series", "Ended". */
  status: z.string().nullable(),
  /** Minutes for a film, episode length for a series, pages for a book. */
  runtime: z.number().int().nullable(),
  genres: z.array(z.string()),
  /**
   * The provider's own rating, and what it is a rating out of.
   *
   * Two numbers without a scale is a number that lies: a book rated 3 out of 5
   * shown as "3.0/10" reads like a book nobody liked, when it is one most people
   * did. The scale travels with the value instead of being assumed.
   */
  score: z.number().nullable(),
  scoreOutOf: z.union([z.literal(5), z.literal(10)]),
  authors: z.array(z.string()),
  cast: z.array(z.string()).optional(),
  publisher: z.string().optional(),
  seasons: z.number().int().optional(),
  episodes: z.number().int().optional(),
  homepage: z.string().optional(),
  identifiers: z
    .array(z.object({ type: z.string().optional(), identifier: z.string().optional() }))
    .optional(),
  /** What else to watch, already merged from recommendations and similar. */
  related: z.array(catalogRelatedSchema).optional(),
  /** The franchise, when the title belongs to one. */
  collection: catalogCollectionSchema.nullable().optional(),
});
export type CatalogDetails = z.infer<typeof catalogDetailsSchema>;

export const catalogDetailsQuerySchema = z.object({
  kind: catalogKindSchema,
  externalId: z.string().min(1).max(120),
});
export type CatalogDetailsQuery = z.infer<typeof catalogDetailsQuerySchema>;

/** Turns a catalog hit into the fields a list item stores. */
export const catalogItemDraftSchema = z.object({
  listId: uuidSchema,
  externalId: z.string().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CatalogItemDraft = z.infer<typeof catalogItemDraftSchema>;

/** Kinds that can be filled from a catalog, for the list creation screen. */
export const catalogKindsForListSchema = z.object({
  listKind: listKindSchema,
  kinds: z.array(catalogKindSchema),
});
export type CatalogKindsForList = z.infer<typeof catalogKindsForListSchema>;
