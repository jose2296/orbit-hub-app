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

/**
 * Says out loud that attachments are living on a disk that a redeploy erases.
 *
 * This used to be a boot error instead, and the change is worth recording: it kept
 * the entire API down — auth, sync, lists, notes, everything — for the sake of a
 * feature that one part of the app uses. The files really are lost; what changed is
 * that it is a warning in the log instead of a reason not to run.
 *
 * `warn` and not `error`, so it is visible in the middle of a normal deploy log
 * instead of buried among the lines that say everything is fine.
 */
function warnAboutEphemeralStorage(): void {
  if (env.NODE_ENV !== 'production' || env.STORAGE_DRIVER !== 'local') return;

  logger.warn(
    {
      driver: env.STORAGE_DRIVER,
      dir: env.STORAGE_LOCAL_DIR,
      fix: 'set STORAGE_DRIVER=s3 and the four S3_* variables; attachments are lost on every redeploy until then',
    },
    'attachments are being written to this container\'s disk, which a restart or redeploy erases',
  );
}

async function start(): Promise<Server> {
  if (shouldMigrate) {
    await runMigrations(process.env['MIGRATIONS_FOLDER'] ?? './drizzle');
  }

  warnAboutEphemeralStorage();

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
