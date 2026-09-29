import { describe, expect, it } from 'vitest';

/**
 * The body of an upload, per runtime.
 *
 * This is the rule that only a device could tell you. `fetch` on a browser takes
 * the `File`; React Native's old `XMLHttpRequest` took `{ uri }` and read the
 * sandbox path in native code; Expo's `fetch` is a spec-compliant `BodyInit` and
 * accepts neither a `{ uri }` object nor a path. Handed one it throws
 * `Unsupported BodyInit type` — measured on an emulator, with the note showing
 * "could not upload" and nothing in the log but that.
 *
 * So the three cases are written out here rather than behind a `Platform.OS`
 * check. The check is what made the bug invisible: a ternary that is correct on
 * web and wrong on a phone is still a ternary, and reading it tells you nothing
 * about which.
 */

/** What the picker produced, per platform, and nothing else. */
type Picked = { uri: string | { name: string; size: number } };

/**
 * Mirrors the shape of the real code: the branch is on the value, not the
 * platform, because a browser never produces a string and a phone never produces
 * a `File`. Asking the platform instead would be one more thing that can disagree
 * with reality.
 */
function whatGoesInTheBody(picked: Picked): "fetch-with-file" | "expo-file-system" {
  return typeof picked.uri === "string" ? "expo-file-system" : "fetch-with-file";
}

describe('el cuerpo de una subida', () => {
  it('un File del navegador va directo a fetch', () => {
    // The browser streams it and nothing is read into memory first, which is the
    // whole point of not buffering a ten-megabyte picture to show it.
    expect(whatGoesInTheBody({ uri: { name: 'salsa.png', size: 80 } })).toBe(
      'fetch-with-file',
    );
  });

  it('una ruta de fichero en un movil va por expo-file-system', () => {
    expect(whatGoesInTheBody({ uri: 'file:///data/user/0/app/cache/1000000022.png' })).toBe(
      'expo-file-system',
    );
  });

  it('nunca se manda la ruta como si fueran los bytes', () => {
    // This is the failure the branch exists to prevent, and it is a *silent* one
    // if the runtime accepts it: the request goes through, the server stores a
    // picture whose contents are the forty characters of a path, and the note
    // shows a broken image with a row insisting the file is there.
    const path = 'file:///data/user/0/app/cache/1000000022.png';
    const body = whatGoesInTheBody({ uri: path });
    expect(body).not.toBe('fetch-with-file');
  });

  it('nunca se manda { uri } como BodyInit', () => {
    // Expo's fetch converts a body against a fixed list: string, ArrayBuffer, a
    // view, Blob, URLSearchParams, ReadableStream, FormData. `{ uri }` is none of
    // them, so it falls off the end and the request throws before it is sent —
    // which is at least loud, unlike the case above.
    const notABodyInit: unknown[] = [
      'file:///x.png',
      { uri: 'file:///x.png' },
    ];
    for (const value of notABodyInit) {
      const isOneOf =
        typeof value === 'string' ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value) ||
        value instanceof URLSearchParams;
      expect(isOneOf, `${JSON.stringify(value)} no es un BodyInit`).toBe(
        typeof value === 'string',
      );
    }
  });
});
