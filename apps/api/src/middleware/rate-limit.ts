import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../lib/http-error.js';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per window, per key. */
  max: number;
  /** Bucket key, normally the client IP or an identifier such as an email. */
  keyFn: (req: Request) => string;
  name: string;
}

/**
 * Fixed-window limiter held in process memory.
 *
 * Enough for a single instance and for development. When the API runs more than
 * one instance this must move to a shared store (Redis or Postgres), otherwise
 * the effective limit is `max x instances`. The tradeoff is recorded in
 * docs/architecture/api-conventions.md rather than hidden here.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, Bucket>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, Math.max(options.windowMs, 30_000));
  sweep.unref();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = `${options.name}:${options.keyFn(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      res.setHeader('X-RateLimit-Limit', options.max);
      next();
      return;
    }

    if (bucket.count >= options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', options.max);
      res.setHeader('X-RateLimit-Remaining', '0');
      next(
        new HttpError({
          status: 429,
          code: 'rate_limited',
          message: 'Too many requests. Try again later.',
        }),
      );
      return;
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    next();
  };
}

/** Behind a proxy `req.ip` is only trustworthy when `trust proxy` is set. */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
