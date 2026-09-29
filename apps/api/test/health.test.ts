import { healthResponseSchema } from '@orbit-hub/contracts';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { pingDatabase } from '../src/db/client.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not determine the test server address');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  // The connection is warmed here, the way the real server warms it on boot.
  // Without this the first health request pays for opening it — a second and a
  // half, measured — and a test that took 1.7s alone fails at 5s when the other
  // ten files are running against the same database.
  await pingDatabase();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /api/v1/health', () => {
  it('answers with a contract valid payload', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBeTruthy();

    const payload: unknown = await response.json();
    const parsed = healthResponseSchema.safeParse(payload);

    expect(parsed.success).toBe(true);
  });

  it('echoes an incoming request id', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'x-request-id': 'test-request-id' },
    });

    expect(response.headers.get('x-request-id')).toBe('test-request-id');
  });

  it('reports whether email is actually delivered', async () => {
    // "The emails never arrive" is otherwise invisible: a process started before
    // EMAIL_TRANSPORT changed keeps logging to the console while the file says
    // resend. This makes the live value answerable in one request.
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const body = (await response.json()) as {
      checks: { email: { transport: string; delivers: boolean } };
    };

    expect(['console', 'resend', 'noop']).toContain(body.checks.email.transport);
    expect(body.checks.email.delivers).toBe(body.checks.email.transport === 'resend');
  });
});

describe('error envelope', () => {
  it('returns not_found for unknown routes', async () => {
    const response = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    const body = (await response.json()) as { error?: { code?: string; requestId?: string } };

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe('not_found');
    expect(body.error?.requestId).toBeTruthy();
  });

  it('returns not_implemented for planned endpoints', async () => {
    // Publishing a template to the public catalogue. Notes, templates, attachments
    // and the sync path all arrived; this one is still to come, and the point of
    // the 501 is that the client can tell "not built yet" apart from "broken".
    const response = await fetch(
      `${baseUrl}/api/v1/notes/templates/00000000-0000-4000-8000-000000000000/publish`,
      { method: 'POST' },
    );
    const body = (await response.json()) as { error?: { code?: string; message?: string } };

    expect(response.status).toBe(501);
    expect(body.error?.code).toBe('not_implemented');
    expect(body.error?.message).toContain('next phase');
  });

  it('answers notes with authentication rather than with 501', async () => {
    // A regression guard for the placeholder. While notes were still planned,
    // this route answered 501 to everybody, including somebody with a session,
    // so a client could not tell "not built" from "you are not logged in".
    const response = await fetch(`${baseUrl}/api/v1/notes`, { method: 'GET' });

    expect(response.status).toBe(401);
  });

  it('validates the payload of implemented endpoints', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST' });
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe('validation_failed');
  });

  it('requires authentication on implemented read endpoints', async () => {
    const response = await fetch(`${baseUrl}/api/v1/workspaces`);

    expect(response.status).toBe(401);
  });
});

describe('security headers', () => {
  it('sets helmet headers and hides the framework', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});
