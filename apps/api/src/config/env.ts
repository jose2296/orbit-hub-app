import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

/**
 * Environment contract. The API refuses to boot with an invalid configuration
 * instead of failing later on the first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default('no-reply@orbithub.app'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}

export const env = parseEnv();

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
