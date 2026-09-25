import { PGlite } from '@electric-sql/pglite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Pool } from 'pg';

import { env, embeddedDataDir, usesEmbeddedDatabase } from '../config/env.js';
import { logger } from '../lib/logger.js';

import { schema } from './schema.js';

export type Database = ReturnType<typeof drizzleNodePg<typeof schema>>;

export type DatabaseDriver = 'postgres' | 'pglite';

interface DatabaseHandle {
  db: Database;
  driver: DatabaseDriver;
  close: () => Promise<void>;
}

let handle: DatabaseHandle | null = null;
let initialising: Promise<DatabaseHandle> | null = null;

async function createHandle(): Promise<DatabaseHandle> {
  if (usesEmbeddedDatabase) {
    // Undefined dataDir means in-memory: that is the test configuration.
    const dataDir = embeddedDataDir;
    logger.warn(
      { dataDir: dataDir ?? 'memory' },
      'no DATABASE_URL configured: using the embedded Postgres (PGlite) database',
    );

    if (dataDir) {
      // PGlite creates the leaf directory but not its parents.
      mkdirSync(dirname(resolve(dataDir)), { recursive: true });
    }

    const client = new PGlite(dataDir);
    // PgliteDatabase and NodePgDatabase expose the same query surface; the cast
    // keeps one type for the whole application.
    const db = drizzlePglite(client, { schema }) as unknown as Database;

    return {
      db,
      driver: 'pglite',
      close: async () => {
        await client.close();
      },
    };
  }

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (error) => {
    logger.error({ err: error }, 'unexpected error on an idle database client');
  });

  return {
    db: drizzleNodePg(pool, { schema }),
    driver: 'postgres',
    close: async () => {
      await pool.end();
    },
  };
}

/** Idempotent: safe to call from anywhere, including concurrent requests. */
export function getDatabase(): Promise<DatabaseHandle> {
  if (handle) return Promise.resolve(handle);
  if (!initialising) {
    initialising = createHandle().then((created) => {
      handle = created;
      return created;
    });
  }
  return initialising;
}

/** Convenience accessor for the query interface. */
export async function db(): Promise<Database> {
  return (await getDatabase()).db;
}

export async function runMigrations(migrationsFolder = './drizzle'): Promise<void> {
  const { db: database, driver } = await getDatabase();
  logger.info({ driver }, 'applying migrations');

  if (driver === 'pglite') {
    await migratePglite(database as Parameters<typeof migratePglite>[0], {
      migrationsFolder,
    });
  } else {
    await migrateNodePg(database, { migrationsFolder });
  }

  logger.info({ driver }, 'migrations applied');
}

export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number | null; driver: DatabaseDriver | null }> {
  try {
    const { db: database, driver } = await getDatabase();
    const startedAt = performance.now();
    await database.execute('select 1');
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), driver };
  } catch (error) {
    logger.warn({ err: error }, 'database ping failed');
    return { ok: false, latencyMs: null, driver: null };
  }
}

export async function closeDatabase(): Promise<void> {
  if (!handle) return;
  await handle.close();
  handle = null;
  initialising = null;
}
