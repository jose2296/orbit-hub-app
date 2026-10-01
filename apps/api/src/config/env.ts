import { config as loadDotenv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import {
  ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT,
  ATTACHMENT_MAX_BYTES_DEFAULT,
} from '@orbit-hub/contracts';

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
    /**
     * Native Google clients. Google refuses a web client id on an installed
     * app, and these are public clients: no secret, redeemed with PKCE.
     */
    GOOGLE_ANDROID_CLIENT_ID: z.string().optional(),
    GOOGLE_IOS_CLIENT_ID: z.string().optional(),

    EMAIL_TRANSPORT: z.enum(['console', 'resend', 'noop']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('no-reply@orbithub.app'),
    WEB_ORIGIN: z.string().url().default('https://app.orbithub.com'),

    /**
     * Where a file goes.
     *
     * `local` writes under a directory and the API serves it, which is what makes
     * an attachment work on a clean clone with nothing configured. `s3` is the real
     * one and never serves a file itself: it hands out a presigned URL and the
     * bytes go straight from the phone to the bucket, so a video does not pass
     * through the API in memory.
     */
    STORAGE_DRIVER: z.enum(['local', 's3', 'noop']).default('local'),
    /** Where the local driver writes, and where the API looks to serve from. */
    STORAGE_LOCAL_DIR: z.string().default('.data/attachments'),
    /** How long an upload or download link stays usable, in seconds. */
    STORAGE_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    /**
     * What a note will accept, decided once and used by both sides.
     *
     * A limit the server does not enforce is a limit the client can ignore, and an
     * image the editor renders is a file the server has already accepted — so the
     * numbers live here rather than inside a request handler.
     */
    // The defaults come from the contract so the app and the server start from the
    // same number; the server may raise them and the app asks before it refuses.
    ATTACHMENT_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(ATTACHMENT_MAX_BYTES_DEFAULT),
    ATTACHMENT_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT),

    /**
     * External catalogs. Server side only: the keys are never exposed to the
     * app, which is the point of routing catalog search through the API.
     */
    TMDB_API_KEY: z.string().optional(),
    GOOGLE_BOOKS_API_KEY: z.string().optional(),

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

    if (value.EMAIL_TRANSPORT === 'resend' && !isResendKey(value.RESEND_API_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'EMAIL_TRANSPORT=resend needs a Resend API key, which looks like re_...',
      });
    }

    if (value.NODE_ENV === 'production' && value.EMAIL_TRANSPORT === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'EMAIL_TRANSPORT=console only logs emails; set it to resend in production',
      });
    }

    if (value.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `STORAGE_DRIVER=s3 needs ${key}`,
          });
        }
      }
    }

    // `local` in production is deliberately NOT an error any more. It was one, and
    // refusing to boot turned out to be the wrong call for a reason a deploy shows
    // in one minute: a server that will not start cannot be looked at, and one that
    // starts with a warning can. The attachments really are lost on every redeploy —
    // that has not been downgraded, it just stopped being a reason to keep the whole
    // API down until somebody configures a bucket. What is missing is the driver, not
    // the permission to run without it. See `warnAboutEphemeralStorage`.

    if (value.NODE_ENV === 'production' && !value.JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET is required in production (at least 32 characters)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Resend keys are prefixed, so an obviously wrong value fails at boot. */
function isResendKey(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('re_') && value.length > 20;
}

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
