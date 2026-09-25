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
