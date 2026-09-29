/**
 * What `localhost` means is the one thing the three targets disagree about.
 *
 * The browser and the iOS simulator run on the machine that serves the API, so
 * `localhost` names the right host. The Android emulator runs behind its own
 * virtual router: there `127.0.0.1` is the emulator itself and the machine
 * hosting it answers to `10.0.2.2`. A real phone matches neither, and gets a LAN
 * address injected into the environment by `make device` instead.
 *
 * The API URL is a build-time value and `EXPO_PUBLIC_*` is inlined into the
 * bundle, so it cannot be different per target — and Expo has no per-platform
 * `.env` files, only `.env.<mode>`. The difference is applied here instead, once
 * the app is running and knows what it is running on. A host written for the
 * emulator in a `.env.local` otherwise leaks into web, and the app then points at
 * an address nothing is listening on while looking perfectly healthy.
 */

/** The name the Android emulator uses for the machine hosting it. */
export const ANDROID_EMULATOR_HOST = '10.0.2.2';

/**
 * Addresses that name the machine the code happens to be running on.
 *
 * `URL` reports an IPv6 loopback host already bracketed, hence the brackets.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Points a loopback address at the emulator's host, and leaves everything else
 * exactly as it was: a deployed API, a LAN address and a real phone are already
 * right, and rewriting one of those would break the case that currently works.
 *
 * A value that is not an absolute address is returned untouched. This is not the
 * place to decide what a bare path means, and the caller's own error, when the
 * configured value is nonsense, is a better one than a rewritten nonsense.
 */
export function retargetLoopbackHost(url: string, platform: string): string {
  if (platform !== 'android') return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return url;

  parsed.hostname = ANDROID_EMULATOR_HOST;

  // `URL` puts a slash on a bare origin. The value going in did not have one, and
  // callers join paths onto this, so it must not acquire one on the way out.
  const rewritten = parsed.toString();
  return rewritten.endsWith('/') && !url.endsWith('/')
    ? rewritten.slice(0, -1)
    : rewritten;
}
