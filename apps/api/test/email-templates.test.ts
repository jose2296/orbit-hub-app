import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The templates are the only place where a wrong origin turns into a dead link
 * in someone's inbox. `WEB_ORIGIN` is the app, never the API, so these tests
 * pin both the origin and the shape of the link.
 */

const env = {
  // The logger reads these while the module graph is being built.
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:8081',
  EMAIL_TRANSPORT: 'console',
};

vi.mock('../src/config/env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config/env.js')>()),
  env,
}));

const { passwordResetEmail, verificationEmail } = await import('../src/modules/email/email.js');

const input = { to: 'user@example.com', token: 'a-token-value-123', locale: 'es' as const };

beforeEach(() => {
  env.WEB_ORIGIN = 'http://localhost:8081';
});

describe('verificationEmail', () => {
  it('links to the app origin, not to the API', () => {
    const message = verificationEmail(input);

    expect(message.text).toContain('http://localhost:8081/verify-email?token=a-token-value-123');
    expect(message.html).toContain('http://localhost:8081/verify-email?token=a-token-value-123');
  });

  it('never points at the API port', () => {
    // The API serves /api/v1 and has no UI: a link there is a 404 for the user.
    expect(verificationEmail(input).text).not.toContain(':4000');
  });

  it('does not double a slash when the origin has a trailing one', () => {
    env.WEB_ORIGIN = 'http://localhost:8081/';

    expect(verificationEmail(input).text).toContain('http://localhost:8081/verify-email?token=');
  });

  it('writes Spanish and English in the requested language', () => {
    expect(verificationEmail({ ...input, locale: 'es' }).subject).toContain('Verifica');
    expect(verificationEmail({ ...input, locale: 'en' }).subject).toContain('Verify');
  });

  it('falls back to Spanish for an unknown locale', () => {
    const message = verificationEmail({ ...input, locale: 'fr' as never });

    expect(message.subject).toBe(verificationEmail({ ...input, locale: 'es' }).subject);
  });
});

describe('passwordResetEmail', () => {
  it('links to the reset route that actually exists', () => {
    // The API sent links to /reset-password for a whole phase before the route
    // was written, so the path is asserted rather than assumed.
    const message = passwordResetEmail(input);

    expect(message.text).toContain('http://localhost:8081/reset-password?token=a-token-value-123');
  });

  it('does not mention the old domain placeholder', () => {
    expect(passwordResetEmail(input).text).not.toContain('orbithub.app');
  });
});
