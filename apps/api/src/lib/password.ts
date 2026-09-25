import { hash, verify } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id` is an ambient const enum, which cannot be referenced
 * under isolatedModules. 2 is its value.
 */
const ARGON2ID = 2;

/**
 * Argon2id parameters.
 *
 * 19 MiB of memory and two passes is the OWASP baseline for Argon2id. They are
 * stored inside the hash string, so raising them later does not invalidate
 * existing passwords: the next successful login rehashes with the new cost.
 */
const ARGON_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

/**
 * Constant time verification handled by argon2. A malformed stored hash is
 * treated as "does not match" instead of throwing, so a corrupted row cannot
 * turn into a 500.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

/** True when the stored hash was produced with weaker parameters than current. */
export function needsRehash(storedHash: string): boolean {
  try {
    const [, , , params] = storedHash.split('$');
    // $argon2id$v=19$m=...,t=...,p=...
    const parsed = Object.fromEntries(
      (params ?? '')
        .split(',')
        .map((pair) => pair.split('='))
        .filter((pair): pair is [string, string] => pair.length === 2),
    ) as Record<string, string>;

    return (
      Number(parsed['m']) < ARGON_OPTIONS.memoryCost ||
      Number(parsed['t']) < ARGON_OPTIONS.timeCost ||
      Number(parsed['p']) < ARGON_OPTIONS.parallelism
    );
  } catch {
    return true;
  }
}
