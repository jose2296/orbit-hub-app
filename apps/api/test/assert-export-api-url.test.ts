import { describe, expect, it } from 'vitest';

import { API_PREFIX } from '@orbit-hub/config';

import { bundleContainsUrl, checkExportApiUrl } from '../../../scripts/assert-export-api-url.mjs';

/**
 * The API router mounts everything under `API_PREFIX`, so the base URL the app is
 * given has to carry it. These tests exist because the copy of the prefix inside
 * the script is a literal — it cannot import the package, it runs before the
 * dependencies are installed — and a literal is exactly the thing that drifts.
 */
describe('assert-export-api-url', () => {
  const good = 'https://orbithub-api.jrz-labs.com/api/v1';

  it('accepts a deployed API behind the prefix', () => {
    expect(checkExportApiUrl(good)).toBe(good);
  });

  it('tolerates a trailing slash on the prefix', () => {
    expect(checkExportApiUrl(`${good}/`)).toBeTruthy();
  });

  it('rejects an empty value', () => {
    expect(() => checkExportApiUrl('')).toThrow(/empty/);
    expect(() => checkExportApiUrl(undefined)).toThrow(/empty/);
  });

  it('rejects a base without the prefix, which asks for a path that 404s', () => {
    expect(() => checkExportApiUrl('https://api.example.com')).toThrow(new RegExp(API_PREFIX));
  });

  it('rejects the build machine by every name it goes by', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '10.0.2.2']) {
      expect(() => checkExportApiUrl(`http://${host}:4000${API_PREFIX}`)).toThrow(/build machine|machine doing the build/);
    }
  });

  it('rejects plain http on a deployed origin', () => {
    expect(() => checkExportApiUrl('http://api.example.com/api/v1')).toThrow(/mixed content/);
  });

  it('rejects the development default too, because this runs in a build', () => {
    // The app's own fallback is `localhost:4000/api/v1` and that is right on a
    // laptop. This script only ever runs in an image, where the same value means
    // "the app will call itself", so it is rejected here on purpose.
    expect(() => checkExportApiUrl(`http://localhost:4000${API_PREFIX}`)).toThrow(/build machine|machine doing the build/);
  });

  it('rejects something that is not a URL', () => {
    expect(() => checkExportApiUrl('temp-api')).toThrow(/absolute URL/);
  });

  it('the prefix it enforces is the one the router uses', () => {
    // The whole point of the literal above: if this fails, the script is checking
    // for a prefix the server stopped mounting.
    expect(API_PREFIX).toBe('/api/v1');
  });
});

describe('bundleContainsUrl', () => {
  it('finds nothing in a directory that does not hold the bundle', () => {
    expect(bundleContainsUrl('apps/mobile/src', 'https://api.example.com/api/v1')).toBe(false);
  });
});