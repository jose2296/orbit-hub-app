import { describe, expect, it } from 'vitest';

/**
 * The key a value is stored under.
 *
 * Mirrors `nativeKey` in `src/lib/storage/secure-storage.ts`. It is duplicated
 * rather than imported because the module under test reaches for
 * `expo-secure-store`, which does not load outside a device — and this rule is
 * exactly the one that a device found and a test would not.
 */

/**
 * What Android's Keystore will accept as a key name.
 *
 * Documented as alphanumeric plus `.`, `-` and `_`. Anything else is rejected,
 * and the message is about the *key* being invalid in a sentence that reads as
 * though the *value* were corrupt — so a sign-in that worked in every other
 * platform fails here with nothing pointing at the name.
 */
const ANDROID_ALLOWED = /^[A-Za-z0-9._-]+$/;

/**
 * A replaced character becomes an underscore and its hex code, not a bare
 * underscore. A bare one would make `orbithub:access-token` and
 * `orbithub_access-token` the same key, and the second of those is a name
 * Android would have accepted on its own.
 */
function nativeKey(key: string): string {
  return key.replace(
    /[^A-Za-z0-9.-]|[_]/g,
    (char) => `_${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

describe('a SecureStore key on Android', () => {
  it('accepts the keys this app actually uses', () => {
    // The real ones, taken from session-storage and local-store. If one of these
    // ever gains a character Android refuses, this is where it shows up rather
    // than on a phone.
    for (const key of [
      'orbithub:access-token',
      'orbithub:refresh-token',
      'orbithub:client-id',
    ]) {
      const stored = nativeKey(key);
      expect(
        ANDROID_ALLOWED.test(stored),
        `"${key}" becomes "${stored}", which Android would refuse`,
      ).toBe(true);
    }
  });

  it('replaces a colon instead of passing it through', () => {
    // Without this the app signs in, tries to keep the session, and every native
    // sign-in fails on the first request that needs the token.
    expect(nativeKey('orbithub:access-token')).toBe('orbithub_3aaccess-token');
    // And a literal underscore moves too, so the escape cannot be forged by a key
    // that happens to look like one.
    expect(nativeKey('a_b')).toBe('a_5fb');
  });

  it('keeps what Android allows as it is, apart from the underscore', () => {
    // A dot and a dash are legal and mean nothing, so they stay. The underscore
    // is legal too, and is the one that has to move, because it is the escape
    // character.
    expect(nativeKey('client.id-1')).toBe('client.id-1');
    expect(nativeKey('orbithub_access-token')).toBe('orbithub_5faccess-token');
  });

  it('round trips, because two different keys must not land in the same place', () => {
    // The whole reason for the hex code rather than a bare underscore: an
    // underscore is legal on Android, so `orbithub_access-token` is a key Android
    // would accept, and a bare replacement would make it the same entry as
    // `orbithub:access-token`. Reading the name back has to give the original.
    for (const key of [
      'orbithub:access-token',
      'orbithub_access-token',
      'a:b_c',
      'a_3ab:c',
    ]) {
      const stored = nativeKey(key);
      const back = stored.replace(/_([0-9a-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
      expect(back, `${key} -> ${stored} did not round trip`).toBe(key);
    }
  });

  it('gives the same name every time, so a write is found by its read', () => {
    // Not idempotent on purpose: escaping the escape means a second pass would
    // escape the first pass. That is fine, because nothing ever passes a stored
    // name back through — `write` and `get` both start from the caller's own key,
    // so they have to agree on it and nothing more.
    const once = nativeKey('orbithub:refresh-token');
    const twice = nativeKey('orbithub:refresh-token');
    expect(twice).toBe(once);
    expect(once).toBe('orbithub_3arefresh-token');
  });

  it('keeps the namespace readable', () => {
    // A dot in the placeholder would be tidier, but a dot is what the web
    // localStorage keys use, and the point of the prefix is that a reader can see
    // which app wrote it.
    expect(nativeKey('orbithub:client-id').startsWith('orbithub')).toBe(true);
  });

  it('cannot make two different keys collide by accident', () => {
    const colon = nativeKey('orbithub:access-token');
    const underscore = nativeKey('orbithub_access-token');
    expect(colon).not.toBe(underscore);
    // And the two forms Android would reject all agree, which is what "readable"
    // is supposed to mean.
    expect(ANDROID_ALLOWED.test(colon)).toBe(true);
    expect(ANDROID_ALLOWED.test(underscore)).toBe(true);
  });
});
