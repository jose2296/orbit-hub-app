import { defineConfig } from 'drizzle-kit';

/**
 * Only `generate` needs no database; `migrate`/`push` require DATABASE_URL.
 * Migrations are committed as SQL so deployments never depend on the CLI.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/orbit_hub',
  },
});
