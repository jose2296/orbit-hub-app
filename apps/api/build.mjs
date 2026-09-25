import * as esbuild from 'esbuild';

/**
 * Production bundle.
 *
 * Third-party packages and node built-ins stay external (they are installed
 * from package.json at deploy time); the workspace packages are bundled so the
 * artifact does not depend on the monorepo layout.
 */
const external = [
  '@electric-sql/pglite',
  '@node-rs/argon2',
  'cors',
  'dotenv',
  'drizzle-orm',
  'express',
  'helmet',
  'jose',
  'pg',
  'pino',
  'pino-http',
  'zod',
];

await esbuild.build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
