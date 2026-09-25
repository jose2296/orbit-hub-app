#!/usr/bin/env node
/**
 * Environment helper for the OrbitHub monorepo.
 *
 *   node scripts/env.mjs list           inventory of every variable
 *   node scripts/env.mjs init           create the local .env files
 *   node scripts/env.mjs check          report missing variables (names only)
 *   node scripts/env.mjs generate-jwt   write a fresh JWT_SECRET
 *   node scripts/env.mjs import-legacy  copy the reusable keys from ../utility-app-*
 *
 * Rules this script never breaks:
 *  - it never prints a value, only variable names and whether they are set
 *  - it only writes to .env files, which are git ignored
 *  - it refuses to import secrets that OrbitHub must not reuse
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiEnvPath = join(root, 'apps', 'api', '.env');
const mobileEnvPath = join(root, 'apps', 'mobile', '.env');
const legacyPaths = {
  api: join(root, '..', 'utility-app-turbo', 'apps', 'api', '.env'),
  mobile: join(root, '..', 'utility-app-native', '.env'),
};

/** Every variable the API understands, with the context that decides if it is required. */
const API_VARS = [
  { name: 'NODE_ENV', required: false, default: 'development' },
  { name: 'PORT', required: false, default: '4000' },
  { name: 'HOST', required: false, default: '0.0.0.0' },
  { name: 'CORS_ORIGINS', required: false, default: 'http://localhost:8081' },

  { name: 'DATABASE_URL', required: 'one of these two', default: 'PostgreSQL connection string' },
  { name: 'DATABASE_SSL', required: false, default: 'false' },
  { name: 'PGLITE_DATA_DIR', required: 'one of these two', default: '.data/pglite in development' },

  { name: 'JWT_SECRET', required: 'production', default: 'generated at boot in development' },
  { name: 'ACCESS_TOKEN_TTL_SECONDS', required: false, default: '900' },
  { name: 'REFRESH_TOKEN_TTL_SECONDS', required: false, default: '2592000' },

  { name: 'GOOGLE_CLIENT_ID', required: false, default: 'unset: Google sign-in disabled' },
  { name: 'GOOGLE_CLIENT_SECRET', required: false, default: 'unset: Google sign-in disabled' },

  { name: 'EMAIL_TRANSPORT', required: false, default: 'console' },
  { name: 'RESEND_API_KEY', required: 'when EMAIL_TRANSPORT=resend', default: 'unset: email is only logged' },
  { name: 'EMAIL_FROM', required: false, default: 'no-reply@orbithub.app' },
  { name: 'WEB_ORIGIN', required: false, default: 'https://app.orbithub.com' },

  { name: 'AUTH_RATE_LIMIT_WINDOW_MS', required: false, default: '900000' },
  { name: 'AUTH_RATE_LIMIT_MAX', required: false, default: '30' },
  { name: 'AUTH_ACCOUNT_RATE_LIMIT_MAX', required: false, default: '5' },

  { name: 'PUSHER_APP_ID', required: false, default: 'unset: realtime in Phase 5' },
  { name: 'PUSHER_APP_KEY', required: false, default: 'unset: realtime in Phase 5' },
  { name: 'PUSHER_SECRET', required: false, default: 'unset: realtime in Phase 5' },

  { name: 'TMDB_API_KEY', required: false, default: 'unset: catalog integration in Phase 3' },
  { name: 'GOOGLE_BOOKS_API_KEY', required: false, default: 'unset: catalog integration in Phase 3' },
  { name: 'GOOGLE_BOOKS_SEARCH_ENGINE_ID', required: false, default: 'unset: optional, speeds up book search' },
];

const MOBILE_VARS = [
  { name: 'EXPO_PUBLIC_API_URL', required: false, default: 'http://localhost:4000/api/v1' },
  { name: 'EXPO_PUBLIC_GOOGLE_CLIENT_ID', required: false, default: 'unset: Google button disabled' },
  { name: 'EXPO_PUBLIC_GOOGLE_REDIRECT_URI', required: false, default: 'orbithub://auth/google' },
];

/**
 * What can be carried over from the legacy projects, and what must never be.
 * The third column exists so the decision is visible instead of implicit.
 */
const LEGACY_MAP = [
  { from: 'api', source: 'PUSHER_APP_ID', to: 'api', target: 'PUSHER_APP_ID', why: 'same account, realtime in Phase 5' },
  { from: 'api', source: 'PUSHER_KEY', to: 'api', target: 'PUSHER_APP_KEY', why: 'same account' },
  { from: 'api', source: 'PUSHER_SECRET', to: 'api', target: 'PUSHER_SECRET', why: 'same account' },
  { from: 'mobile', source: 'EXPO_PUBLIC_THEMOVIEDB_API_KEY', to: 'api', target: 'TMDB_API_KEY', why: 'moved to the API: the key never reaches the app' },
  { from: 'mobile', source: 'EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY', to: 'api', target: 'GOOGLE_BOOKS_API_KEY', why: 'moved to the API' },
  { from: 'mobile', source: 'EXPO_PUBLIC_GOOGLE_SEARCH_ENGINE_ID', to: 'api', target: 'GOOGLE_BOOKS_SEARCH_ENGINE_ID', why: 'moved to the API' },
];

const NEVER_IMPORT = [
  { name: 'DATABASE_URL', why: 'points at the legacy database; OrbitHub starts on an empty one' },
  { name: 'DIRECT_URL', why: 'Supabase specific, OrbitHub talks to PostgreSQL directly' },
  { name: 'SUPABASE_URL', why: 'Supabase is not part of the new stack' },
  { name: 'SUPABASE_ANON_KEY', why: 'Supabase is not part of the new stack' },
  { name: 'SUPABASE_DB_PASSWORD', why: 'Supabase is not part of the new stack' },
  { name: 'JWT_SECRET', why: 'a new signing key breaks every old token on purpose' },
  { name: 'JWT_REFRESH_SECRET', why: 'same reason' },
  { name: 'SALT_ROUNDS', why: 'OrbitHub hashes with Argon2id, not bcrypt' },
  { name: 'CRON_SECRET', why: 'belongs to the legacy job runner' },
  { name: 'GEMINI_API_KEY', why: 'AI was removed from OrbitHub' },
  { name: 'GROQ_API_KEY', why: 'AI was removed from OrbitHub' },
  { name: 'OPENROUTER_API_KEY', why: 'AI was removed from OrbitHub' },
  { name: 'FIREBASE_PROJECT_ID', why: 'push needs its own Firebase project in Phase 6' },
  { name: 'FIREBASE_CLIENT_EMAIL', why: 'same' },
  { name: 'FIREBASE_PRIVATE_KEY', why: 'same' },
  { name: 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY', why: 'OrbitHub has its own auth' },
];

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

function writeEnvValue(path, name, value) {
  if (!existsSync(path)) {
    writeFileSync(path, `${name}=${value}\n`, 'utf8');
    return;
  }
  const current = readFileSync(path, 'utf8');
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  const line = `${name}=${value}`;

  writeFileSync(path, pattern.test(current) ? current.replace(pattern, line) : `${current.trimEnd()}\n${line}\n`, 'utf8');
}

function isSet(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/^(changeme|your-|example|unset)/i.test(value.trim());
}

const log = {
  title: (text) => console.log(`\n${text}\n${'─'.repeat(text.length)}`),
  ok: (text) => console.log(`  ✓ ${text}`),
  warn: (text) => console.log(`  ! ${text}`),
  fail: (text) => console.log(`  ✗ ${text}`),
  note: (text) => console.log(`    ${text}`),
};

function commandList() {
  log.title('API (apps/api/.env)');
  for (const variable of API_VARS) {
    const required =
      variable.required === true
        ? 'required'
        : typeof variable.required === 'string'
          ? `required in ${variable.required}`
          : 'optional';
    log.note(`${variable.name.padEnd(32)} ${required.padEnd(22)} ${variable.default}`);
  }

  log.title('App (apps/mobile/.env)');
  for (const variable of MOBILE_VARS) {
    log.note(`${variable.name.padEnd(32)} ${'optional'.padEnd(22)} ${variable.default}`);
  }
}

function commandInit() {
  for (const target of [
    { example: join(root, 'apps', 'api', '.env.example'), env: apiEnvPath },
    { example: join(root, 'apps', 'mobile', '.env.example'), env: mobileEnvPath },
  ]) {
    if (existsSync(target.env)) {
      log.warn(`${relative(target.env)} already exists, left untouched`);
      continue;
    }
    if (!existsSync(target.example)) {
      log.fail(`missing template ${relative(target.example)}`);
      continue;
    }
    writeFileSync(target.env, readFileSync(target.example, 'utf8'), 'utf8');
    log.ok(`created ${relative(target.env)}`);
  }
  log.note('Both files are git ignored. Never commit them.');
}

function relative(path) {
  return path.replace(`${root}/`, '');
}

function commandCheck() {
  const api = readEnvFile(apiEnvPath);
  const mobile = readEnvFile(mobileEnvPath);
  const production = api['NODE_ENV'] === 'production';

  log.title('API');
  let missing = 0;

  const hasDatabase = isSet(api['DATABASE_URL']) || isSet(api['PGLITE_DATA_DIR']);
  if (hasDatabase) {
    log.ok(isSet(api['DATABASE_URL']) ? 'DATABASE_URL is set' : 'PGLITE_DATA_DIR is set (embedded database)');
  } else if (production) {
    log.fail('DATABASE_URL is required in production');
    missing += 1;
  } else {
    log.warn('No database configured: development falls back to PGlite in .data/pglite');
  }

  if (isSet(api['JWT_SECRET'])) {
    log.ok('JWT_SECRET is set');
  } else if (production) {
    log.fail('JWT_SECRET is required in production');
    missing += 1;
  } else {
    log.warn('JWT_SECRET is not set: a random one is generated at every boot, so sessions reset on restart');
  }

  if (isSet(api['GOOGLE_CLIENT_ID']) && isSet(api['GOOGLE_CLIENT_SECRET'])) {
    log.ok('Google sign-in is configured');
  } else {
    log.warn('Google sign-in is disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set');
  }

  if ((api['EMAIL_TRANSPORT'] ?? 'console') === 'console') {
    log.warn('EMAIL_TRANSPORT=console: emails are logged, not sent');
  } else {
    log.ok(`EMAIL_TRANSPORT=${api['EMAIL_TRANSPORT']}`);
  }

  log.title('App');
  for (const variable of MOBILE_VARS) {
    const value = mobile[variable.name];
    if (isSet(value)) {
      log.ok(`${variable.name} is set`);
    } else {
      log.warn(`${variable.name} is not set (${variable.default})`);
    }
  }

  log.title(missing === 0 ? 'Ready to run' : 'Not ready');
  if (missing === 0) {
    log.note('make -C apps/api dev, then make -C apps/mobile web');
  } else {
    log.note('Fill the missing variables above, or run: make env-init');
  }
}

function commandGenerateJwt() {
  const secret = randomBytes(48).toString('base64url');
  writeEnvValue(apiEnvPath, 'JWT_SECRET', secret);
  log.ok('JWT_SECRET written to apps/api/.env');
  log.note('The value is not printed on purpose. Copy it from the file when you need it.');
}

function commandImportLegacy() {
  log.title('Legacy import');
  log.warn('Only the keys below are reusable. Everything else is refused on purpose.');
  log.note('');

  for (const entry of NEVER_IMPORT) {
    log.note(`refused  ${entry.name.padEnd(28)} ${entry.why}`);
  }
  log.note('');

  let copied = 0;
  let skipped = 0;

  for (const mapping of LEGACY_MAP) {
    const source = readEnvFile(legacyPaths[mapping.from]);
    const value = source[mapping.source];

    if (!isSet(value)) {
      log.warn(`missing  ${mapping.source} in ${relative(legacyPaths[mapping.from])}`);
      skipped += 1;
      continue;
    }

    const target = mapping.to === 'api' ? apiEnvPath : mobileEnvPath;
    const current = readEnvFile(target);

    if (isSet(current[mapping.target])) {
      log.warn(`kept     ${mapping.target} (already set here)`);
      skipped += 1;
      continue;
    }

    writeEnvValue(target, mapping.target, value);
    log.ok(`copied   ${mapping.source} -> ${mapping.target} (${mapping.why})`);
    copied += 1;
  }

  log.title('Result');
  log.note(`${copied} copied, ${skipped} skipped. Values were written to the .env files, never printed.`);
  log.note('Keys taken from an old install should still be rotated before production.');
  if (!isSet(readEnvFile(apiEnvPath)['JWT_SECRET'])) {
    log.note('JWT_SECRET is still unset. Run: make -C apps/api env-jwt');
  }
}

const rootEnvPath = join(root, '.env');

/**
 * Moves values out of the root .env and into the file that owns them.
 *
 * The root file is a shadow copy of everything, which is a reliable way to edit
 * a variable in a place nothing reads. This fixes that: EXPO_PUBLIC_* go to the
 * app, everything else to the API, and the root file is left as a template.
 */
function commandDistribute() {
  const source = readEnvFile(rootEnvPath);

  if (Object.keys(source).length === 0) {
    log.warn('the root .env is empty, nothing to move');
    return;
  }

  log.title('Distributing the root .env');
  const moved = { api: [], mobile: [] };
  const lines = [];

  for (const [name, value] of Object.entries(source)) {
    if (isSet(value)) {
      const destination = name.startsWith('EXPO_PUBLIC_') ? 'mobile' : 'api';
      const target = destination === 'api' ? apiEnvPath : mobileEnvPath;
      const current = readEnvFile(target);

      if (isSet(current[name]) && current[name] !== value) {
        log.warn(`kept     ${name} in ${destination} (a different value is already set there)`);
      } else {
        writeEnvValue(target, name, value);
        moved[destination].push(name);
        log.ok(`moved    ${name} -> ${destination}`);
      }
      lines.push(`${name}=`);
    } else {
      lines.push(`${name}=${value}`);
    }
  }

  deriveGoogleClientId();

  // The root file keeps the shape, with no values in it.
  writeFileSync(
    rootEnvPath,
    `# Values moved to apps/api/.env and apps/mobile/.env by \`make env-distribute\`.\n` +
      '# This file is a map, not a source of truth. See docs/environment.md.\n\n' +
      `${lines.join('\n')}\n`,
    'utf8',
  );

  log.title('Result');
  log.note(`${moved.api.length} went to the API, ${moved.mobile.length} to the app.`);
  log.note('The root .env now holds names only.');
  log.note('Restart the API and the dev server so they pick the values up.');
}

/**
 * The OAuth client id is public by design, and the app needs the same value the
 * API uses for the web client. Deriving it here removes the most common reason
 * for the Google button to stay disabled.
 */
function deriveGoogleClientId() {
  const api = readEnvFile(apiEnvPath);
  const mobile = readEnvFile(mobileEnvPath);

  if (!isSet(api['GOOGLE_CLIENT_ID'])) return;
  if (isSet(mobile['EXPO_PUBLIC_GOOGLE_CLIENT_ID'])) return;

  writeEnvValue(mobileEnvPath, 'EXPO_PUBLIC_GOOGLE_CLIENT_ID', api['GOOGLE_CLIENT_ID']);
  log.ok('derived  EXPO_PUBLIC_GOOGLE_CLIENT_ID in the app from the API client id');
  log.note('        the app needs the *web* OAuth client id for the web target');
}

const commands = {
  list: commandList,
  init: commandInit,
  check: commandCheck,
  distribute: commandDistribute,
  'generate-jwt': commandGenerateJwt,
  'import-legacy': commandImportLegacy,
};

const command = process.argv[2] ?? 'list';
const handler = commands[command];

if (!handler) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

handler();
