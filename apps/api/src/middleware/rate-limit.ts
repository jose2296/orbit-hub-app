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
  /**
   * Only a **client error** spends the budget; everything else gives it back.
   *
   * For a limit that hangs off **one account**, which exists to stop somebody
   * guessing that account's password. Counting the attempts that get it right
   * stops nobody — a guesser never gets it right — and locks out the person who
   * owns the account after five ordinary logins, with a `rate_limited` that
   * reads exactly like an attack in progress. They may end up logging that out
   * and changing the password for nothing.
   *
   * A unit is therefore spent by a `4xx` other than `429`, and returned by:
   *
   * - **`2xx`** — the caller got what they asked for, which is not an attempt.
   * - **`5xx`** — the server's fault, and it says nothing about a password. If
   *   these spent budget, one outage would empty every account's allowance and
   *   the next ordinary person would find the door shut with no way to guess why.
   * - **`429`** — this limiter's own answer, which never reached the route and so
   *   never spent anything to begin with.
   *
   * Counting still happens **on the way in**, before the route runs, so a flood
   * of concurrent attempts is refused exactly as before.
   *
   * Left off for a limit that hangs off an **IP**. There it is a flood guard and
   * every single request is the thing being guarded against.
   */
  countOnlyClientErrors?: boolean;
}

/**
 * Whether this answer should cost the caller a unit of budget.
 *
 * A rejection in the `4xx` range, except this limiter's own `429`. The wording is
 * "the caller asked for something and was told no" — which is what a wrong
 * password is — and not "the request failed", because those are different things
 * and only one of them is evidence of guessing.
 */
function isChargeable(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
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

  /** Hands one unit back, and never to a bucket that is not the one it was taken from. */
  const refund = (key: string, resetAt: number): void => {
    const bucket = buckets.get(key);
    // The window may have rolled over while the route was working. Refunding the
    // new window would hand out budget nobody spent, and would resurrect a bucket
    // the sweep had already thrown away.
    if (!bucket || bucket.resetAt !== resetAt) return;
    bucket.count = Math.max(0, bucket.count - 1);
  };

  /*
    Armed in exactly one place, used by both paths, and the status is checked here
    instead of at each call site. Armed twice, it is once too easy for one path to
    skip the check — and an arming that ignores the status is a limiter that spends
    nothing at all. That is not a near miss: the budget quietly became `max + 1`,
    because the very first attempt of a window was the one never held to account.
  */
  const arm = (res: Response, key: string, resetAt: number): void => {
    if (!options.countOnlyClientErrors) return;
    res.on('finish', () => {
      if (!isChargeable(res.statusCode)) refund(key, resetAt);
    });
  };

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = `${options.name}:${options.keyFn(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + options.windowMs;
      buckets.set(key, { count: 1, resetAt });
      res.setHeader('X-RateLimit-Limit', options.max);
      arm(res, key, resetAt);
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
    arm(res, key, bucket.resetAt);
    next();
  };
}

/** Behind a proxy `req.ip` is only trustworthy when `trust proxy` is set. */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
