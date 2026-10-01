import { describe, expect, it } from 'vitest';

import { API_PREFIX } from '@orbit-hub/config';

import {
  bundleContainsUrl,
  checkExportApiUrl,
  checkPublicEnvironment,
} from '../../../scripts/assert-export-env.mjs';

const GOOD_ENV = {
  EXPO_PUBLIC_API_URL: 'https://orbithub-api.jrz-labs.com/api/v1',
  EXPO_PUBLIC_WEB_ORIGIN: 'https://orbithub-app.jrz-labs.com',
  EXPO_PUBLIC_GOOGLE_CLIENT_ID: '959281134147-abc.apps.googleusercontent.com',
};

/**
 * The API router mounts everything under `API_PREFIX`, so the base URL the app is
 * given has to carry it. These tests exist because the copy of the prefix inside the
 * script is a literal — it cannot import the package, it runs before the
 * dependencies are installed — and a literal is exactly the thing that drifts.
 */
describe('checkExportApiUrl', () => {
  it('accepts a deployed API behind the prefix', () => {
    expect(checkExportApiUrl(GOOD_ENV.EXPO_PUBLIC_API_URL)).toBe(GOOD_ENV.EXPO_PUBLIC_API_URL);
  });

  it('tolerates a trailing slash on the prefix', () => {
    expect(checkExportApiUrl(`${GOOD_ENV.EXPO_PUBLIC_API_URL}/`)).toBeTruthy();
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
      expect(() => checkExportApiUrl(`http://${host}:4000${API_PREFIX}`)).toThrow(
        /machine doing the build/,
      );
    }
  });

  it('rejects plain http on a deployed origin', () => {
    expect(() => checkExportApiUrl('http://api.example.com/api/v1')).toThrow(/mixed content/);
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

describe('checkPublicEnvironment', () => {
  it('accepts a complete public environment', () => {
    expect(checkPublicEnvironment(GOOD_ENV)).toBe(GOOD_ENV.EXPO_PUBLIC_API_URL);
  });

  it('rejects a missing Google client id, which renders a dead button', () => {
    const { EXPO_PUBLIC_GOOGLE_CLIENT_ID: _omitted, ...rest } = GOOD_ENV;
    expect(() => checkPublicEnvironment(rest)).toThrow(/EXPO_PUBLIC_GOOGLE_CLIENT_ID/);
  });

  it('rejects a missing web origin', () => {
    const { EXPO_PUBLIC_WEB_ORIGIN: _omitted, ...rest } = GOOD_ENV;
    expect(() => checkPublicEnvironment(rest)).toThrow(/EXPO_PUBLIC_WEB_ORIGIN/);
  });

  it('rejects a web origin pointing at the build machine', () => {
    expect(() =>
      checkPublicEnvironment({ ...GOOD_ENV, EXPO_PUBLIC_WEB_ORIGIN: 'http://localhost:8081' }),
    ).toThrow(/build machine/);
  });
});

describe('bundleContainsUrl', () => {
  it('finds nothing in a directory that does not hold the bundle', () => {
    expect(bundleContainsUrl('apps/mobile/src', GOOD_ENV.EXPO_PUBLIC_API_URL)).toBe(false);
  });
});