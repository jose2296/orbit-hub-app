import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { closeDatabase, runMigrations } from '../src/db/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '..', 'drizzle');

export interface TestServer {
  url: string;
  request: (path: string, init?: RequestInit) => Promise<{ status: number; body: any }>;
  post: (path: string, body?: unknown, token?: string) => Promise<{ status: number; body: any }>;
  get: (path: string, token?: string) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

/**
 * Boots the real application against an in-memory Postgres (PGlite) with the
 * committed migrations applied. No mocks: these are integration tests.
 */
export async function startTestServer(): Promise<TestServer> {
  await runMigrations(migrationsFolder);

  const app = createApp();
  const server: Server = await new Promise((resolvePromise) => {
    const listening = app.listen(0, '127.0.0.1', () => resolvePromise(listening));
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not determine the test server address');
  }
  const url = `http://127.0.0.1:${address.port}/api/v1`;

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
  }

  return {
    url,
    request,
    post: (path, body, token) =>
      request(path, {
        method: 'POST',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      }),
    get: (path, token) =>
      request(path, token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    close: async () => {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
      await closeDatabase();
    },
  };
}

export interface TestUser {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  sessionId: string;
}

let sequence = 0;

export function uniqueEmail(prefix = 'user'): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Date.now().toString(36)}@example.com`;
}

const DEFAULT_PASSWORD = 'a-very-long-password';

/** Extracts the token from an email body such as `.../verify-email?token=abc`. */
export function tokenFromEmail(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) {
    throw new Error('No token found in the email body');
  }
  return match[1];
}

/** Registers, verifies and signs in, returning a usable session. */
export async function createVerifiedUser(
  api: TestServer,
  overrides: { email?: string; password?: string; displayName?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const displayName = overrides.displayName ?? 'Test User';

  const registered = await api.post('/auth/register', {
    email,
    password,
    displayName,
    locale: 'es',
    acceptedTermsAt: new Date().toISOString(),
    device: { label: 'Test device', platform: 'web' },
  });

  if (registered.status !== 201) {
    throw new Error(`register failed: ${JSON.stringify(registered.body)}`);
  }

  const { capturedEmails } = await import('../src/modules/email/email.js');
  const emailMessages = capturedEmails();
  const last = emailMessages[emailMessages.length - 1];
  if (!last) {
    throw new Error('No verification email was captured');
  }

  const verified = await api.post('/auth/verify-email', { token: tokenFromEmail(last.text) });
  if (verified.status !== 200) {
    throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
  }

  const login = await api.post('/auth/login', {
    email,
    password,
    device: { label: 'Test device', platform: 'web' },
  });

  if (login.status !== 200 || login.body?.data?.status !== 'authenticated') {
    throw new Error(`login failed: ${JSON.stringify(login.body)}`);
  }

  const session = login.body.data.session;
  return {
    email,
    password,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId: session.user.id,
    sessionId: session.device.id,
  };
}
