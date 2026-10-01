/**
 * Types for `assert-export-env.mjs`.
 *
 * The script has to stay plain JavaScript: `Dockerfile.web` runs it *before*
 * `npm ci`, so there is no `tsx` and no TypeScript compiler in the image yet, and
 * converting it to `.ts` would mean moving the check after the install — which
 * spends the longest step of the build to find out the answer was wrong.
 *
 * A hand-written declaration is the cost of that, and it is a small one: three
 * exported functions and one error class. The alternative was a `// @ts-expect-error`
 * at the import, which tells the reader nothing and stops working the moment the
 * file moves.
 */

/** Thrown by every check. Exported so a caller can tell it apart from a real bug. */
export class ExportEnvError extends Error {}

/**
 * Validates the API base URL the bundle is about to be built against.
 *
 * Rejects an empty value, a relative URL, a loopback host (`localhost`, `127.0.0.1`,
 * `[::1]`, `10.0.2.2`), plain `http`, and a base that does not end in `/api/v1`.
 * Returns the value so a caller can assert the artefact against it.
 *
 * @throws ExportEnvError
 */
export function checkExportApiUrl(
  value: string | undefined,
  options?: { where?: string },
): string;

/** An https origin that is not the build machine. @throws ExportEnvError */
export function checkPublicOrigin(
  value: string | undefined,
  name: string,
  options?: { where?: string },
): string;

/** Just non-empty, for values with no shape worth asserting. @throws ExportEnvError */
export function checkPresent(
  value: string | undefined,
  name: string,
  options?: { where?: string },
): string;

/**
 * Whether any file under `<distDir>/_expo/static/js/web` contains the value.
 *
 * A directory that is not there is an answer, not a crash: it means the bundle is
 * not there, so it does not contain it.
 */
export function bundleContainsUrl(distDir: string, value: string): boolean;

/** Validates every public variable the web build needs. @throws ExportEnvError */
export function checkPublicEnvironment(env?: NodeJS.ProcessEnv): string;