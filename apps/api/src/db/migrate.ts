import { closeDatabase, runMigrations } from './client.js';
import { logger } from '../lib/logger.js';

/**
 * Applies the committed SQL migrations. Deployments run this before starting
 * the server; the CLI never generates migrations.
 */
async function main(): Promise<void> {
  await runMigrations(process.env['MIGRATIONS_FOLDER'] ?? './drizzle');
}

main()
  .then(() => closeDatabase())
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, 'migration failed');
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
