import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GooglePlatform } from '../src/modules/auth/google.js';

/**
 * The platform rules are the whole point of this module: Google blocks a web
 * client id on an installed app, and a public native client can only redeem its
 * code with the PKCE verifier. Both failures are silent from the user's point of
 * view, so they are pinned here.
 */

const env = {
  // The logger reads these while the module graph is being built.
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  GOOGLE_CLIENT_ID: 'web-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'web-secret',
  GOOGLE_ANDROID_CLIENT_ID: 'android-client-id.apps.googleusercontent.com',
  GOOGLE_IOS_CLIENT_ID: 'ios-client-id.apps.googleusercontent.com',
};

vi.mock('../src/config/env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config/env.js')>()),
  env,
}));

const { exchangeGoogleCode, GoogleAuthError, isGoogleConfiguredFor } = await import(
  '../src/modules/auth/google.js'
);

const tokenRequests: URLSearchParams[] = [];

function stubGoogle(profile: Record<string, unknown> = { sub: '1', email: 'a@b.co', email_verified: true }) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/token')) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({ access_token: 'token-123' }), { status: 200 });
    }
    return new Response(JSON.stringify(profile), { status: 200 });
  });
}

beforeEach(() => {
  tokenRequests.length = 0;
  // A test that removes a client must not leak that into the next one.
  env.GOOGLE_CLIENT_ID = 'web-client-id.apps.googleusercontent.com';
  env.GOOGLE_CLIENT_SECRET = 'web-secret';
  env.GOOGLE_ANDROID_CLIENT_ID = 'android-client-id.apps.googleusercontent.com';
  env.GOOGLE_IOS_CLIENT_ID = 'ios-client-id.apps.googleusercontent.com';
  stubGoogle();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(): URLSearchParams {
  const last = tokenRequests.at(-1);
  if (!last) throw new Error('no token request was made');
  return last;
}

describe('exchangeGoogleCode', () => {
  it('redeems a web code with the secret, as a confidential client requires', async () => {
    await exchangeGoogleCode({ code: 'code-web', platform: 'web' });

    const body = bodyOf();
    expect(body.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
    expect(body.get('client_secret')).toBe('web-secret');
  });

  it('redeems a native code without a secret, sending the PKCE verifier', async () => {
    await exchangeGoogleCode({
      code: 'code-android',
      codeVerifier: 'verifier-value-1234567890',
      platform: 'android',
    });

    const body = bodyOf();
    expect(body.get('client_id')).toBe(env.GOOGLE_ANDROID_CLIENT_ID);
    // Sending the web secret with a native client is what Google rejects.
    expect(body.get('client_secret')).toBeNull();
    expect(body.get('code_verifier')).toBe('verifier-value-1234567890');
  });

  it('uses the iOS client on iOS', async () => {
    await exchangeGoogleCode({
      code: 'code-ios',
      codeVerifier: 'verifier-value-1234567890',
      platform: 'ios',
    });

    expect(bodyOf().get('client_id')).toBe(env.GOOGLE_IOS_CLIENT_ID);
  });

  it('refuses a native code with no verifier instead of sending a doomed request', async () => {
    const error = await exchangeGoogleCode({ code: 'code', platform: 'ios' }).catch((caught) => caught);

    expect(error).toBeInstanceOf(GoogleAuthError);
    expect((error as InstanceType<typeof GoogleAuthError>).reason).toBe('invalid_code');
    expect(tokenRequests).toHaveLength(0);
  });

  it('never falls back to the web client on native', async () => {
    await exchangeGoogleCode({
      code: 'code',
      codeVerifier: 'verifier-value-1234567890',
      platform: 'android',
    });

    expect(bodyOf().get('client_id')).not.toBe(env.GOOGLE_CLIENT_ID);
  });

  it('reports a platform with no client as not configured', async () => {
    env.GOOGLE_IOS_CLIENT_ID = '';

    const error = await exchangeGoogleCode({
      code: 'code',
      codeVerifier: 'verifier-value-1234567890',
      platform: 'ios',
    }).catch((caught) => caught);

    expect((error as InstanceType<typeof GoogleAuthError>).reason).toBe('not_configured');
    expect((error as Error).message).toContain('ios');
    expect(isGoogleConfiguredFor('ios')).toBe(false);
    expect(isGoogleConfiguredFor('web')).toBe(true);
  });

  it('treats a missing platform as web', async () => {
    await exchangeGoogleCode({ code: 'code' });

    expect(bodyOf().get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
  });

  it('rejects an account whose email Google has not verified', async () => {
    stubGoogle({ sub: '1', email: 'a@b.co', email_verified: false });

    const error = await exchangeGoogleCode({ code: 'code', platform: 'web' }).catch((caught) => caught);

    expect((error as InstanceType<typeof GoogleAuthError>).reason).toBe('unverified_email');
  });

  it('reports a rejected code as an invalid code', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );

    const error = await exchangeGoogleCode({ code: 'stale', platform: 'web' }).catch((caught) => caught);

    expect((error as InstanceType<typeof GoogleAuthError>).reason).toBe('invalid_code');
  });
});

describe('isGoogleConfiguredFor', () => {
  it('reports the platform that is actually usable', () => {
    const platforms: GooglePlatform[] = ['web', 'ios', 'android'];
    for (const platform of platforms) {
      expect(isGoogleConfiguredFor(platform)).toBe(true);
    }
  });
});
