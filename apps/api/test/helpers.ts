import { randomUUID } from 'node:crypto';
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
  patch: (path: string, body?: unknown, token?: string) => Promise<{ status: number; body: any }>;
  delete: (path: string, token?: string) => Promise<{ status: number; body: any }>;
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
    // Header names are case insensitive, but a plain object is not: spreading
    // `content-type` over `Content-Type` leaves two keys, fetch joins them, and
    // the server sees `application/json, application/json`, which body-parser
    // does not recognise. So the body is silently not parsed and a PATCH arrives
    // as an empty object, which reads as a validation error about a field the
    // test did send. Normalised here so that cannot happen.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [key, value] of Object.entries(
      (init.headers as Record<string, string> | undefined) ?? {},
    )) {
      const existing = Object.keys(headers).find(
        (candidate) => candidate.toLowerCase() === key.toLowerCase(),
      );
      if (existing !== undefined) delete headers[existing];
      headers[key] = value;
    }

    const response = await fetch(`${url}${path}`, {
      ...init,
      headers,
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
    patch: (path, body, token) =>
      request(path, {
        method: 'PATCH',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      }),
    delete: (path, token) =>
      request(path, {
        method: 'DELETE',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      }),
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

/**
 * Shares a node **and files it**, which is the two things the app does.
 *
 * Not a convenience. Since the rule that a received thing appears nowhere until you say
 * where it goes, sharing alone puts a row in the inbox and nothing else: no folder, no
 * space, no contents. A test that shares and then pulls is testing a half-finished flow,
 * and about twenty of them were written before the rule existed.
 *
 * The fileable spaces are the recipient's own, so a test has to give them one. Pass
 * `en` to leave it unfiled and assert that nothing arrives, which is the other half of
 * the rule and worth testing directly.
 */
export async function compartirYColocar(
  api: TestServer,
  args: {
    /** Who owns the node and where it lives. */
    dueno: TestUser;
    nodeType: 'workspace' | 'folder' | 'list' | 'list_item' | 'note';
    nodeId: string;
    workspaceId: string;
    /** Who is given it. */
    destinatario: TestUser;
    role?: 'editor' | 'viewer';
    /** Where it is filed. `null` for a space, which is not filed anywhere. */
    en?: string | null;
  },
): Promise<{ shareId: string }> {
  const creada = await api.post(
    '/shares',
    {
      workspaceId: args.workspaceId,
      nodeType: args.nodeType,
      nodeId: args.nodeId,
      granteeUserId: args.destinatario.userId,
      role: args.role ?? 'editor',
    },
    args.dueno.accessToken,
  );

  if (creada.status !== 201) {
    throw new Error(`compartir fallo: ${JSON.stringify(creada.body)}`);
  }

  const shareId = creada.body.data.id as string;
  if (args.nodeType === 'workspace' || args.en === undefined) {
    return { shareId };
  }

  const colocada = await api.post(
    `/shares/${shareId}/place`,
    { workspaceId: args.en, folderId: null, position: 0 },
    args.destinatario.accessToken,
  );
  if (colocada.status !== 200) {
    throw new Error(`colocar fallo: ${JSON.stringify(colocada.body)}`);
  }

  return { shareId };
}

/** A space of this person's own, which is where a received thing gets filed. */
export async function espacioPropio(api: TestServer, user: TestUser, name: string): Promise<string> {
  const id = randomUUID();
  const response = await api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [
        {
          operationId: randomUUID(),
          clientId: 'test-client-helper',
          entity: 'workspace',
          kind: 'create',
          entityId: id,
          baseVersion: 0,
          payload: { name, color: 'teal' },
          base: null,
          clientTimestamp: new Date().toISOString(),
        },
      ],
    },
    user.accessToken,
  );

  if (response.body.data.results[0].status !== 'applied') {
    throw new Error(`no se pudo crear el espacio: ${JSON.stringify(response.body)}`);
  }
  return id;
}
