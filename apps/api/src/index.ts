import type { Server } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase, pingDatabase, runMigrations } from './db/client.js';
import { logger } from './lib/logger.js';

const app = createApp();

/**
 * Migrations run on boot by default so a fresh environment is usable, and can
 * be disabled in deployments that apply migrations as a separate step.
 */
const shouldMigrate = process.env['RUN_MIGRATIONS_ON_BOOT'] !== 'false';

async function start(): Promise<Server> {
  if (shouldMigrate) {
    await runMigrations(process.env['MIGRATIONS_FOLDER'] ?? './drizzle');
  }

  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(env.PORT, env.HOST, () => {
      logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'OrbitHub API listening');
      resolve(started);
    });
  });

  // The connection is opened before answering anything, and not on the first
  // request. A liveness probe that pays for a cold start is a liveness probe
  // that gets killed by the startup timeout of whatever is watching, and the
  // health endpoint is the one place where being slow is worst: it is the thing
  // people watch when they want to know if the API is alive.
  const database = await pingDatabase();
  if (!database.ok) {
    logger.warn({ latencyMs: database.latencyMs }, 'the database did not answer on boot');
  }

  return server;
}

const server = await start();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });

  // Do not hang forever on stuck connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
