import { healthResponseSchema } from '@orbit-hub/contracts';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

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
    const response = await fetch(`${baseUrl}/api/v1/notes`, { method: 'POST' });
    const body = (await response.json()) as { error?: { code?: string; message?: string } };

    expect(response.status).toBe(501);
    expect(body.error?.code).toBe('not_implemented');
    expect(body.error?.message).toContain('next phase');
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
