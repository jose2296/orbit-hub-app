import { config as loadDotenv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

loadDotenv({ quiet: true });

/**
 * Environment contract. The API refuses to boot with an invalid configuration
 * instead of failing later on the first request.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    CORS_ORIGINS: z.string().default('http://localhost:8081'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    /** External PostgreSQL. Optional when PGLITE_DATA_DIR is used instead. */
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    /** Embedded Postgres (PGlite) for local development and tests. */
    PGLITE_DATA_DIR: z.string().optional(),

    /** Signing key for access tokens. Mandatory in production. */
    JWT_SECRET: z.string().min(32).optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    EMAIL_TRANSPORT: z.enum(['console', 'noop']).default('console'),
    EMAIL_FROM: z.string().default('no-reply@orbithub.app'),
    WEB_ORIGIN: z.string().url().default('https://app.orbithub.com'),

    /** Auth throttling. Generous values in tests keep the suite independent. */
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    AUTH_ACCOUNT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production; the embedded database is not allowed',
      });
    }

    if (value.NODE_ENV === 'production' && !value.JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET is required in production (at least 32 characters)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** In tests the process provides an explicit secret; never guess one in production. */
const developmentSecret = randomBytes(48).toString('base64url');

/**
 * With no database configured in development the API falls back to an embedded
 * Postgres (PGlite) in `.data/pglite`, so `npm run api` works on a clean clone.
 */
const DEFAULT_DEV_DATA_DIR = '.data/pglite';

function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const raw: NodeJS.ProcessEnv = { ...source };
  const nodeEnv = raw['NODE_ENV'] ?? 'development';

  if (!raw['DATABASE_URL'] && !raw['PGLITE_DATA_DIR'] && nodeEnv === 'development') {
    raw['PGLITE_DATA_DIR'] = DEFAULT_DEV_DATA_DIR;
  }

  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return { ...result.data, JWT_SECRET: result.data.JWT_SECRET ?? developmentSecret };
}

export const env = parseEnv();

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * True when the API runs on the embedded database (PGlite) instead of an
 * external PostgreSQL. Only possible outside production.
 */
export const usesEmbeddedDatabase = !env.DATABASE_URL;

/** Undefined means in-memory, which is what the test suite uses. */
export const embeddedDataDir = env.PGLITE_DATA_DIR;
