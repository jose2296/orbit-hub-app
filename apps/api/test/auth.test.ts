import { authResultSchema, deviceSchema, sessionSchema, userSchema } from '@orbit-hub/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { capturedEmails } from '../src/modules/email/email.js';

import { createVerifiedUser, startTestServer, tokenFromEmail, uniqueEmail } from './helpers';
import type { TestServer } from './helpers';

let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

const PASSWORD = 'a-very-long-password';

function registerBody(email: string) {
  return {
    email,
    password: PASSWORD,
    displayName: 'Jose',
    locale: 'es',
    acceptedTermsAt: new Date().toISOString(),
    device: { label: 'iPhone', platform: 'ios' },
  };
}

describe('POST /auth/register', () => {
  it('creates an unverified account and asks for verification', async () => {
    const email = uniqueEmail('register');
    const response = await api.post('/auth/register', registerBody(email));

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('email_verification_required');
    expect(response.body.data.email).toBe(email);

    const sent = capturedEmails().at(-1);
    expect(sent?.to).toBe(email);
    expect(sent?.text).toContain('verify-email?token=');
  });

  it('normalises the email before storing it', async () => {
    const email = uniqueEmail('Mixed');
    const response = await api.post('/auth/register', registerBody(`  ${email.toUpperCase()}  `));

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe(email.toLowerCase());
  });

  it('rejects a duplicate email with a conflict', async () => {
    const email = uniqueEmail('duplicate');
    await api.post('/auth/register', registerBody(email));
    const second = await api.post('/auth/register', registerBody(email));

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');
  });

  it('validates the payload with the shared schema', async () => {
    const response = await api.post('/auth/register', { email: 'not-an-email' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.fields).toHaveProperty('email');
  });
});

describe('POST /auth/verify-email', () => {
  it('rejects an unknown token', async () => {
    const response = await api.post('/auth/verify-email', { token: 'x'.repeat(43) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('bad_request');
  });

  it('accepts a token only once', async () => {
    const email = uniqueEmail('verify-once');
    await api.post('/auth/register', registerBody(email));

    const token = tokenFromEmail(capturedEmails().at(-1)?.text ?? '');
    const first = await api.post('/auth/verify-email', { token });
    const second = await api.post('/auth/verify-email', { token });

    expect(first.status).toBe(200);
    expect(first.body.data.email).toBe(email);
    expect(second.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('does not issue a session before the email is verified', async () => {
    const email = uniqueEmail('unverified');
    await api.post('/auth/register', registerBody(email));

    const response = await api.post('/auth/login', {
      email,
      password: PASSWORD,
      device: { label: 'iPhone', platform: 'ios' },
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('email_verification_required');
  });

  it('rejects a wrong password with the same answer as an unknown account', async () => {
    const user = await createVerifiedUser(api);

    const wrongPassword = await api.post('/auth/login', {
      email: user.email,
      password: 'definitely-not-the-password',
    });
    const unknownAccount = await api.post('/auth/login', {
      email: uniqueEmail('ghost'),
      password: 'definitely-not-the-password',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
  });

  it('returns a contract valid session', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.post('/auth/login', {
      email: user.email,
      password: PASSWORD,
      device: { label: 'MacBook', platform: 'web' },
    });

    const parsed = authResultSchema.safeParse(response.body.data);
    expect(parsed.success).toBe(true);

    if (parsed.success && parsed.data.status === 'authenticated') {
      expect(sessionSchema.safeParse(parsed.data.session).success).toBe(true);
      expect(deviceSchema.safeParse(parsed.data.session.device).success).toBe(true);
      expect(userSchema.safeParse(parsed.data.session.user).success).toBe(true);
      expect(parsed.data.session.user.providers).toContain('email');
    }
  });
});

describe('GET /auth/me and /auth/devices', () => {
  it('rejects requests without a token', async () => {
    expect((await api.get('/auth/me')).status).toBe(401);
    expect((await api.get('/auth/devices')).status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const response = await api.get('/auth/me', 'not-a-jwt');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('returns the signed in user', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/auth/me', user.accessToken);

    expect(response.status).toBe(200);
    expect(userSchema.safeParse(response.body.data).success).toBe(true);
    expect(response.body.data.id).toBe(user.userId);
  });

  it('marks only the current device in the device list', async () => {
    const user = await createVerifiedUser(api);
    const second = await api.post('/auth/login', {
      email: user.email,
      password: PASSWORD,
      device: { label: 'iPad', platform: 'ios' },
    });
    const secondToken = second.body.data.session.accessToken;

    const fromFirst = await api.get('/auth/devices', user.accessToken);
    const fromSecond = await api.get('/auth/devices', secondToken);

    expect(fromFirst.body.data).toHaveLength(2);
    expect(fromFirst.body.data.filter((d: { current: boolean }) => d.current)).toHaveLength(1);
    expect(fromSecond.body.data.filter((d: { current: boolean }) => d.current)[0].id).not.toBe(
      user.sessionId,
    );
  });

  it('revokes a device and refuses its access token afterwards', async () => {
    const user = await createVerifiedUser(api);
    const other = await api.post('/auth/login', {
      email: user.email,
      password: PASSWORD,
      device: { label: 'Tablet', platform: 'android' },
    });
    const otherSession = other.body.data.session;

    const deleted = await api.request(`/auth/devices/${otherSession.device.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(deleted.status).toBe(204);

    expect((await api.get('/auth/me', otherSession.accessToken)).status).toBe(401);
    expect((await api.get('/auth/me', user.accessToken)).status).toBe(200);
  });

  it('does not let a user revoke someone else device', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);

    const response = await api.request(`/auth/devices/${stranger.sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect(response.status).toBe(404);
    expect((await api.get('/auth/me', stranger.accessToken)).status).toBe(200);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const user = await createVerifiedUser(api);

    const refreshed = await api.post('/auth/refresh', { refreshToken: user.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(user.refreshToken);

    // The access token may be byte identical: same session, same claims, same
    // second. Only the refresh token is guaranteed to change.
    const meWithNew = await api.get('/auth/me', refreshed.body.data.accessToken);
    expect(meWithNew.status).toBe(200);
  });

  it('revokes the family when an already rotated token is replayed', async () => {
    const user = await createVerifiedUser(api);

    const firstRotation = await api.post('/auth/refresh', { refreshToken: user.refreshToken });
    const currentToken = firstRotation.body.data.refreshToken;

    const replay = await api.post('/auth/refresh', { refreshToken: user.refreshToken });
    expect(replay.status).toBe(401);

    // The legitimate token is now dead too: the whole family was revoked.
    const afterReplay = await api.post('/auth/refresh', { refreshToken: currentToken });
    expect(afterReplay.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const response = await api.post('/auth/refresh', { refreshToken: 'nope' });
    expect(response.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('ends the current session only', async () => {
    const user = await createVerifiedUser(api);
    const other = await api.post('/auth/login', {
      email: user.email,
      password: PASSWORD,
      device: { label: 'Desktop', platform: 'web' },
    });

    const logout = await api.post('/auth/logout', { allDevices: false }, user.accessToken);
    expect(logout.status).toBe(204);

    expect((await api.get('/auth/me', user.accessToken)).status).toBe(401);
    expect((await api.get('/auth/me', other.body.data.session.accessToken)).status).toBe(200);
  });

  it('ends every session with allDevices', async () => {
    const user = await createVerifiedUser(api);
    const other = await api.post('/auth/login', {
      email: user.email,
      password: PASSWORD,
      device: { label: 'Desktop', platform: 'web' },
    });

    const logout = await api.post('/auth/logout', { allDevices: true }, user.accessToken);
    expect(logout.status).toBe(204);

    expect((await api.get('/auth/me', user.accessToken)).status).toBe(401);
    expect((await api.get('/auth/me', other.body.data.session.accessToken)).status).toBe(401);
    expect((await api.post('/auth/refresh', { refreshToken: user.refreshToken })).status).toBe(401);
  });
});

describe('password reset', () => {
  it('answers the same way for unknown accounts', async () => {
    const known = await createVerifiedUser(api);

    const knownResponse = await api.post('/auth/password/forgot', { email: known.email });
    const unknownResponse = await api.post('/auth/password/forgot', { email: uniqueEmail('ghost') });

    expect(knownResponse.status).toBe(202);
    expect(unknownResponse.status).toBe(202);
    expect(knownResponse.body.data).toEqual(unknownResponse.body.data);
  });

  it('resets the password and revokes every session', async () => {
    const user = await createVerifiedUser(api);
    await api.post('/auth/password/forgot', { email: user.email });

    const resetToken = tokenFromEmail(capturedEmails().at(-1)?.text ?? '');
    const reset = await api.post('/auth/password/reset', {
      token: resetToken,
      password: 'another-very-long-password',
    });
    expect(reset.status).toBe(200);

    expect((await api.get('/auth/me', user.accessToken)).status).toBe(401);
    expect(
      (
        await api.post('/auth/login', {
          email: user.email,
          password: 'another-very-long-password',
        })
      ).status,
    ).toBe(200);
  });

  it('rejects a reset token twice', async () => {
    const user = await createVerifiedUser(api);
    await api.post('/auth/password/forgot', { email: user.email });
    const token = tokenFromEmail(capturedEmails().at(-1)?.text ?? '');

    expect((await api.post('/auth/password/reset', { token, password: 'x'.repeat(12) })).status).toBe(200);
    expect((await api.post('/auth/password/reset', { token, password: 'y'.repeat(12) })).status).toBe(400);
  });

  it('changes the password and keeps the current session alive', async () => {
    const user = await createVerifiedUser(api);

    const wrong = await api.post(
      '/auth/password/change',
      { currentPassword: 'wrong-password-here', newPassword: 'a-brand-new-password' },
      user.accessToken,
    );
    expect(wrong.status).toBe(400);

    const changed = await api.post(
      '/auth/password/change',
      { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' },
      user.accessToken,
    );
    expect(changed.status).toBe(200);
    expect((await api.get('/auth/me', user.accessToken)).status).toBe(200);
  });
});

describe('DELETE /auth/account', () => {
  it('requires the password and then blocks the session', async () => {
    const user = await createVerifiedUser(api);

    const withoutPassword = await api.request('/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    // Missing confirmation: rejected by the schema before the service runs.
    expect(withoutPassword.status).toBe(422);

    const wrongPassword = await api.request('/auth/account', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: 'not-the-password', confirmation: 'DELETE' }),
    });
    expect(wrongPassword.status).toBe(400);

    const deleted = await api.request('/auth/account', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: PASSWORD, confirmation: 'DELETE' }),
    });
    expect(deleted.status).toBe(204);

    expect((await api.get('/auth/me', user.accessToken)).status).toBe(401);
    expect(
      (await api.post('/auth/login', { email: user.email, password: PASSWORD })).status,
    ).toBe(401);
  });
});
