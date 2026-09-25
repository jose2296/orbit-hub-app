import type { Server } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase, runMigrations } from './db/client.js';
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

  return new Promise<Server>((resolve) => {
    const server = app.listen(env.PORT, env.HOST, () => {
      logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'OrbitHub API listening');
      resolve(server);
    });
  });
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
