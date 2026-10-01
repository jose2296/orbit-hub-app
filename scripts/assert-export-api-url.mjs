/**
 * Refuses to export a web bundle that points at the build machine.
 *
 * `resolveBaseUrl()` in the app falls back to `http://localhost:4000/api/v1` when
 * `EXPO_PUBLIC_API_URL` is not set. That fallback is right on a laptop and wrong
 * everywhere else, and it fails in the worst possible way: the export succeeds, the
 * image is valid, the page loads, and every request the app makes goes to whatever
 * machine happens to be looking at it. A connection refused looks like a flaky
 * network, so nothing ever says "wrong address".
 *
 * This is why the first deployed bundle had `localhost` in it: the variable was set
 * in Railway, the platform passed it to the build, and the Dockerfile never declared
 * it — so the build ran without it and fell back.
 *
 * Two checks, in two moments, because "the variable was set" and "the bundler used
 * it" are different claims and only the second one ships:
 *
 *   node scripts/assert-export-api-url.mjs            # before the export
 *   node scripts/assert-export-api-url.mjs --after   # after it, against the files
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Names that resolve to the machine doing the work, whatever the scheme. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '10.0.2.2']);

/**
 * The router mounts everything under this, and the app joins paths onto the base
 * URL rather than onto the origin. A base of `https://api.example.com` therefore
 * asks for `https://api.example.com/auth/login`, which the API answers with a 404 —
 * and a 404 on login reads as "wrong password", not as "wrong address".
 *
 * Kept as a literal rather than imported: this script runs inside the build
 * container before the packages are installed, and importing `@orbit-hub/config`
 * would mean installing the workspace to read one constant. The value is asserted
 * against the real one in the test file, so the copy cannot drift unnoticed.
 */
const API_PREFIX = '/api/v1';

/**
 * Throws, and only exits when run as a command.
 *
 * The first version called `process.exit(1)` from here, which is right for a
 * Dockerfile and useless for a test: `process.exit` kills the vitest worker
 * instead of throwing, so the first test that asserted a failure took the whole
 * file down and the suite reported a crash rather than a pass.
 */
class ExportApiUrlError extends Error {}

function fail(message) {
  throw new ExportApiUrlError(message);
}

/**
 * The URL has to be set, absolute, https, and not aimed at this machine.
 *
 * Returns the value so the caller can assert against the artefact with it.
 */
export function checkExportApiUrl(value, { where = 'the build environment' } = {}) {
  if (!value || !value.trim()) {
    fail(
      `EXPO_PUBLIC_API_URL is empty in ${where}. The export would bake in ` +
        'http://localhost:4000/api/v1 and the deployed app would call itself.',
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`EXPO_PUBLIC_API_URL is not an absolute URL in ${where}: "${value}"`);
  }

  if (LOOPBACK_HOSTS.has(parsed.hostname)) {
    fail(
      `EXPO_PUBLIC_API_URL points at ${parsed.hostname} in ${where}, which is the ` +
        'machine doing the build and not an API anyone else can reach.',
    );
  }

  if (parsed.protocol !== 'https:') {
    fail(
      `EXPO_PUBLIC_API_URL is ${parsed.protocol}// in ${where}. A browser on a ` +
        'deployed page refuses it as mixed content, and the app then has no API.',
    );
  }

  if (parsed.pathname.replace(/\/$/, '') !== API_PREFIX) {
    fail(
      `EXPO_PUBLIC_API_URL must end in ${API_PREFIX} (in ${where}), and this one ends in ` +
        `"${parsed.pathname || '/'}". The app joins paths onto the base URL, so without the ` +
        `prefix it asks for ${parsed.origin}/auth/login and the API answers 404 — which on a ` +
        'login screen looks like a wrong password.',
    );
  }

  return value;
}

/** Whether the built bundle actually carries the URL, read from the files. */
export function bundleContainsUrl(distDir, value) {
  const needle = Buffer.from(value);

  const contains = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      // A directory that is not there means the bundle is not there, and "not
      // there" is an answer to "is it in the bundle?" — it is not. Throwing ENOENT
      // out of a predicate turns a question into a crash.
      return false;
    }

    for (const entry of entries) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (contains(path)) return true;
      } else if (readFileSync(path).includes(needle)) {
        return true;
      }
    }
    return false;
  };

  return contains(join(distDir, '_expo/static/js/web'));
}

function main(argv) {
  const distDir = argv.includes('--after') ? (argv[argv.indexOf('--after') + 1] ?? 'dist') : null;

  try {
    const value = checkExportApiUrl(process.env.EXPO_PUBLIC_API_URL);

    if (!distDir) {
      console.log(`[assert-export-api-url] building against ${value}`);
      return;
    }

    if (!bundleContainsUrl(distDir, value)) {
      fail(
        `the exported bundle in ${distDir} does not contain ${value}. The build read the ` +
          'variable but the bundler did not inline it, so the app is about to call ' +
          'http://localhost:4000. Check the ARG/ENV pair in Dockerfile.web.',
      );
    }

    console.log(`[assert-export-api-url] the bundle carries ${value}`);
  } catch (error) {
    console.error(`[assert-export-api-url] ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}