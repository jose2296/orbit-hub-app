import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/middleware/rate-limit.js';

/**
 * The limiter is unit tested with a tiny window: the integration suite runs
 * every request from the same IP and would throttle itself.
 */
function fakeRequest(ip: string, body: unknown = {}): Request {
  return {
    ip,
    body,
    header: () => undefined,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function fakeResponse(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    status() {
      return res;
    },
    json() {
      return res;
    },
    end() {
      return res;
    },
  };
  return res as unknown as Response & { headers: Record<string, string> };
}

function run(
  limiter: ReturnType<typeof createRateLimiter>,
  req: Request,
): { status: number | null; error: unknown } {
  let status: number | null = null;
  let error: unknown = null;

  const res = fakeResponse();
  const next: NextFunction = (err?: unknown) => {
    if (err) {
      error = err;
      status = (err as { status?: number }).status ?? null;
    }
  };

  limiter(req, res, next);
  return { status, error };
}

describe('createRateLimiter', () => {
  it('lets the first requests through and blocks the rest', () => {
    const limiter = createRateLimiter({
      name: 'test',
      windowMs: 60_000,
      max: 3,
      keyFn: (req) => req.ip ?? 'unknown',
    });

    const req = fakeRequest('10.0.0.1');

    expect(run(limiter, req).status).toBeNull();
    expect(run(limiter, req).status).toBeNull();
    expect(run(limiter, req).status).toBeNull();

    const blocked = run(limiter, req);
    expect(blocked.status).toBe(429);
    expect((blocked.error as { code: string }).code).toBe('rate_limited');
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter({
      name: 'test-keys',
      windowMs: 60_000,
      max: 1,
      keyFn: (req) => req.ip ?? 'unknown',
    });

    expect(run(limiter, fakeRequest('10.0.0.1')).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.2')).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.1')).status).toBe(429);
  });

  it('can key on the request body, as the account limiter does', () => {
    const limiter = createRateLimiter({
      name: 'test-body',
      windowMs: 60_000,
      max: 1,
      keyFn: (req) => String((req.body as { email?: string }).email ?? 'none'),
    });

    expect(run(limiter, fakeRequest('10.0.0.1', { email: 'a@example.com' })).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.1', { email: 'b@example.com' })).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.1', { email: 'a@example.com' })).status).toBe(429);
  });

  it('sets Retry-After when it blocks', () => {
    const limiter = createRateLimiter({
      name: 'test-headers',
      windowMs: 60_000,
      max: 1,
      keyFn: () => 'same',
    });

    const req = fakeRequest('10.0.0.3');
    run(limiter, req);

    const res = fakeResponse();
    limiter(req, res, () => undefined);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('resets after the window', async () => {
    const limiter = createRateLimiter({
      name: 'test-window',
      windowMs: 30,
      max: 1,
      keyFn: () => 'window',
    });

    const req = fakeRequest('10.0.0.4');
    expect(run(limiter, req).status).toBeNull();
    expect(run(limiter, req).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(run(limiter, req).status).toBeNull();
  });
});
