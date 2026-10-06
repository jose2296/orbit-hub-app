/**
 * Refuses to export a web bundle built from a broken public environment.
 *
 * Everything `EXPO_PUBLIC_*` is inlined by Metro **while it exports**, which means
 * three things that are all invisible afterwards:
 *
 *   1. a variable that is missing at build time is not an error, it is a default;
 *   2. the value ends up inside `dist`, not in the environment of the running site;
 *   3. Docker does not hand a build variable to a `RUN` unless the stage declares
 *      it with `ARG`, so setting the variable in the host is not the same as the
 *      build seeing it.
 *
 * Together those produced a bundle that was perfectly valid, loaded, rendered — and
 * called `http://localhost:4000`, so every request went to whichever machine was
 * looking at the page. Nothing downstream complains, because a connection refused
 * looks like a flaky network.
 *
 * So the check is here, at build time, where it costs a second instead of an
 * afternoon. It runs twice: before the export, so a wrong setup does not spend the
 * dependency install, and after it, reading the files, because "the variable was set"
 * and "the bundler used it" are two different claims and only the second one ships.
 *
 *   node scripts/assert-export-env.mjs
 *   node scripts/assert-export-env.mjs --after apps/mobile/dist
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Names that resolve to the machine doing the work, whatever the scheme. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '10.0.2.2']);

/**
 * The router mounts everything under this, and the app joins paths onto the base
 * URL rather than onto the origin. A base of `https://api.example.com` therefore
 * asks for `https://api.example.com/auth/login`, which the API answers with a 404 —
 * and a 404 on a login screen reads as "wrong password", not as "wrong address".
 *
 * A literal rather than an import, because this runs before `npm ci`: there is no
 * `tsx` and no TypeScript in the image yet, and installing the workspace to read one
 * constant would spend the longest step of the build on a two-second check. The copy
 * is tied to the real one by a test that compares the two, so it cannot drift
 * silently.
 */
const API_PREFIX = '/api/v1';

/**
 * What the web build cannot do without.
 *
 * `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID` is here because its absence is silent in
 * the worst way: `GoogleSignInButton` reads a missing id, decides there is no OAuth
 * client, and renders a **disabled button with an explanation underneath**. The
 * page looks finished. The user cannot sign in and the app gives no hint that a
 * build variable was empty.
 *
 * **And `_ANDROID`, not `GOOGLE_CLIENT_ID`.** This script checked the bare
 * `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, which nothing defines any more: `google-auth.ts`
 * reads a client **per platform** —`_WEB`, `_ANDROID`, `_IOS`— because Google
 * refuses a web client id inside an installed app. So the guard was asking for a
 * variable that no configuration could provide, and the release could not pass
 * whatever was written in `.env.release`.
 *
 * That is worth being precise about, because the fix has two directions and only
 * one of them is right: changing the guard to the variable the app really reads,
 * or adding a variable to satisfy a guard. The second would have meant putting the
 * **web** client id in an Android build, which is exactly what
 * `.env.release.example` warns against, twenty lines above where the release reads
 * it. A guard that can only be satisfied by doing the thing it exists to prevent
 * is not a guard.
 *
 * `_WEB` and `_IOS` are deliberately not required. The one that matters for a
 * Play build is Android, and `.env.release.example` says it carries only that one.
 *
 * `EXPO_PUBLIC_GOOGLE_REDIRECT_URI` is not listed: on web the redirect comes from
 * `window.location.origin`, and the scheme is only for native.
 */
const REQUIRED = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_WEB_ORIGIN',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID',
];

/**
 * Throws, and only exits when run as a command.
 *
 * The first version called `process.exit(1)` from here, which is right for a
 * Dockerfile and useless for a test: `process.exit` kills the vitest worker instead
 * of throwing, so the first test that asserted a failure took the whole file down and
 * the suite reported a crash instead of a pass.
 */
export class ExportEnvError extends Error {}

function fail(message) {
  throw new ExportEnvError(message);
}

/**
 * Validates the API base URL the bundle is about to be built against.
 *
 * Rejects an empty value, a relative URL, a loopback host, plain `http`, and a base
 * that does not end in the router's prefix. Returns the value so the caller can
 * assert the artefact against it.
 *
 * @throws ExportEnvError
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

/** An https origin that is not this machine, or nothing. */
export function checkPublicOrigin(value, name, { where = 'the build environment' } = {}) {
  if (!value || !value.trim()) {
    fail(`${name} is empty in ${where}. Anything built without it cannot say where the app lives.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} is not an absolute URL in ${where}: "${value}"`);
  }

  if (LOOPBACK_HOSTS.has(parsed.hostname)) {
    fail(`${name} points at ${parsed.hostname} in ${where}, which is the build machine.`);
  }

  if (parsed.protocol !== 'https:') {
    fail(`${name} is ${parsed.protocol}// in ${where}; a deployed page will not load it as secure.`);
  }

  return value;
}

/** Just non-empty. A client id has no shape worth asserting on. */
export function checkPresent(value, name, { where = 'the build environment' } = {}) {
  if (!value || !value.trim()) {
    fail(`${name} is empty in ${where}. The app renders a feature as switched off rather than failing.`);
  }
  return value;
}

/** Whether any file under `<distDir>/_expo/static/js/web` contains the value. */
export function bundleContainsUrl(distDir, value) {
  const needle = Buffer.from(value);

  const contains = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      // A directory that is not there means the bundle is not there, and "not there"
      // is an answer to "is it in the bundle?" — it is not. Throwing ENOENT out of a
      // predicate turns a question into a crash.
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

/**
 * The whole public environment, validated. Returns the API URL for the artefact
 * check.
 *
 * @throws ExportEnvError
 */
export function checkPublicEnvironment(env = process.env) {
  checkPresent(env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID, 'EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID');
  checkPublicOrigin(env.EXPO_PUBLIC_WEB_ORIGIN, 'EXPO_PUBLIC_WEB_ORIGIN');
  return checkExportApiUrl(env.EXPO_PUBLIC_API_URL);
}

function main(argv) {
  const distDir = argv.includes('--after') ? (argv[argv.indexOf('--after') + 1] ?? 'dist') : null;

  try {
    for (const name of REQUIRED) checkPresent(process.env[name], name);
    checkExportApiUrl(process.env.EXPO_PUBLIC_API_URL);

    if (!distDir) {
      console.log(
        `[assert-export-env] building against ${process.env.EXPO_PUBLIC_API_URL} ` +
          `from ${process.env.EXPO_PUBLIC_WEB_ORIGIN}`,
      );
      return;
    }

    // Every required value, not just the API URL: the bundle is the artefact and
    // the bundle is what ships.
    for (const name of REQUIRED) {
      if (!bundleContainsUrl(distDir, process.env[name])) {
        fail(
          `the exported bundle does not contain ${name} (${process.env[name]}). The build ` +
            'read the variable but the bundler did not inline it. Check the ARG/ENV pair ' +
            'in Dockerfile.web.',
        );
      }
    }

    console.log(`[assert-export-env] the bundle carries all ${REQUIRED.length} required values`);
  } catch (error) {
    console.error(`[assert-export-env] ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}