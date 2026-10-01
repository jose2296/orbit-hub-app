/**
 * Types for `assert-export-api-url.mjs`.
 *
 * The script has to stay plain JavaScript: `Dockerfile.web` runs it *before*
 * `npm ci`, so there is no `tsx` and no TypeScript compiler in the image yet, and
 * converting it to `.ts` would mean moving the check after the install — which
 * spends a long dependency install to find out the answer was wrong.
 *
 * A hand-written declaration is the cost of that, and it is a small one: these are
 * the two exported functions and one error class. The alternative was a `// @ts-expect-error`
 * at the import, which tells the reader nothing and stops the moment the file moves.
 */

/** Thrown by both checks. Exported so a caller can tell it apart from a real bug. */
export class ExportApiUrlError extends Error {}

/**
 * Validates the API base URL the bundle is about to be built against.
 *
 * Rejects an empty value, a relative URL, a loopback host (`localhost`, `127.0.0.1`,
 * `[::1]`, `10.0.2.2`), plain `http`, and a base that does not end in `/api/v1`.
 * Returns the value so a caller can assert the artefact against it.
 *
 * @throws ExportApiUrlError
 */
export function checkExportApiUrl(
  value: string | undefined,
  options?: { where?: string },
): string;

/**
 * Whether any file under `<distDir>/_expo/static/js/web` contains the URL.
 *
 * A directory that is not there is an answer, not a crash: it means the bundle is
 * not there, so it does not contain it.
 */
export function bundleContainsUrl(distDir: string, value: string): boolean;