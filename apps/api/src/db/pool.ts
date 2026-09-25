import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool: Pool | null = null;

/**
 * Thin PostgreSQL access layer.
 *
 * The query builder / ORM decision is deliberately deferred to Phase 1 (see
 * docs/architecture/adr/0005-database-access.md); everything above this module
 * works with plain rows, so swapping the driver stays local.
 */
export function getPool(): Pool | null {
  if (!env.DATABASE_URL) return null;
  if (pool) return pool;

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (error) => {
    logger.error({ err: error }, 'unexpected error on idle database client');
  });

  return pool;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(env.DATABASE_URL);
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const database = getPool();
  if (!database) {
    throw new Error('DATABASE_URL is not configured');
  }
  const result = await database.query<T>(text, params);
  return result.rows;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const database = getPool();
  if (!database) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number | null }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, latencyMs: null };
  }

  const startedAt = performance.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    logger.warn({ err: error }, 'database ping failed');
    return { ok: false, latencyMs: null };
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
