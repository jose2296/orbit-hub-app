import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token. 32 bytes = 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored as SHA-256 digests, not as reversible values. A leaked
 * database therefore does not hand out usable refresh tokens.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant time comparison for two hex digests of the same length. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
