import type { Server } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';

const app = createApp();

const server: Server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { port: env.PORT, host: env.HOST, env: env.NODE_ENV },
    'OrbitHub API listening',
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await closePool();
    process.exit(0);
  });

  // Do not hang forever on stuck connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
