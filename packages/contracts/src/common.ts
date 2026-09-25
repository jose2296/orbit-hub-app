import { z } from 'zod';

/** UUID v4 identifier. Every entity uses a server generated UUID. */
export const uuidSchema = z.uuid();

/** Lower-cased, trimmed email address. Normalisation happens on the edge of the API. */
export const emailSchema = z.email().trim().toLowerCase().max(254);

/** Password rules for the MVP. Length is the dominant factor, so we only enforce a sane floor. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'Password is too long');

/** ISO-8601 timestamp with timezone, e.g. 2026-01-31T10:00:00.000Z */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Non-negative integer stored as a number. */
export const countSchema = z.int().min(0);

export const localeSchema = z.enum(['es', 'en']);
export type Locale = z.infer<typeof localeSchema>;

export const appearanceSchema = z.enum(['system', 'light', 'dark']);
export type Appearance = z.infer<typeof appearanceSchema>;

export const accentSchema = z.enum(['orbit', 'violet', 'emerald', 'amber', 'rose']);
export type Accent = z.infer<typeof accentSchema>;

/** Cursor pagination. Cursors are opaque strings produced by the API. */
export const paginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().default(null),
  });

/** Optimistic concurrency token. Incremented by the API on every accepted write. */
export const versionSchema = z.int().min(0);

/** Soft delete marker used by the sync protocol. */
export const deletedAtSchema = isoDateTimeSchema.nullable().default(null);

export const idParamSchema = z.object({ id: uuidSchema });
