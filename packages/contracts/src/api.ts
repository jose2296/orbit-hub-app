import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * Every response uses the same envelope so the client can always read a request id,
 * and errors are always machine readable.
 */
export const apiErrorCodeSchema = z.enum([
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'not_implemented',
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    /** Field level issues, e.g. { email: 'Email is required' } */
    fields: z.record(z.string(), z.string()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiMetaSchema = z.object({
  requestId: z.string(),
});
export type ApiMeta = z.infer<typeof apiMetaSchema>;

/** Successful single-resource response. */
export const apiResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: apiMetaSchema.optional() });

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Health payload, also used by the mobile app to detect API availability. */
export const healthStatusSchema = z.enum(['ok', 'degraded', 'down']);

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.literal('orbit-hub-api'),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.object({
    database: z.object({
      status: healthStatusSchema,
      latencyMs: z.number().nonnegative().nullable(),
    }),
    /**
     * Which transport is live, so "the emails never arrive" is answerable with
     * one request instead of guessing from the process environment.
     */
    email: z.object({
      transport: z.enum(['console', 'resend', 'noop']),
      /** False for `console`, which writes the message to the log instead. */
      delivers: z.boolean(),
    }),
  }),
  timestamp: isoDateTimeSchema,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Shared shape for entities that participate in offline sync. */
export const syncableEntitySchema = z.object({
  id: z.uuid(),
  version: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable().default(null),
});
