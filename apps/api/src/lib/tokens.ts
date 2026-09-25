import { SignJWT, jwtVerify } from 'jose';

import { env } from '../config/env.js';
import { randomToken, sha256 } from './crypto.js';

const ISSUER = 'orbit-hub';
const AUDIENCE = 'orbit-hub-app';
const ALGORITHM = 'HS256';

let cachedKey: Uint8Array | null = null;

function signingKey(): Uint8Array {
  cachedKey ??= new TextEncoder().encode(env.JWT_SECRET as string);
  return cachedKey;
}

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id, so a revoked session can be rejected before the token expires. */
  sid: string;
  typ: 'access';
}

export interface RefreshTokenMaterial {
  /** The value handed to the client. */
  token: string;
  /** What is stored in the database. */
  tokenHash: string;
}

export interface SignAccessTokenInput {
  userId: string;
  sessionId: string;
  expiresInSeconds?: number;
}

export async function signAccessToken(input: SignAccessTokenInput): Promise<string> {
  const expiresIn = input.expiresInSeconds ?? env.ACCESS_TOKEN_TTL_SECONDS;

  return new SignJWT({ sid: input.sessionId, typ: 'access' satisfies AccessTokenClaims['typ'] })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(signingKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, signingKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: [ALGORITHM],
  });

  if (payload['typ'] !== 'access' || typeof payload['sub'] !== 'string' || typeof payload['sid'] !== 'string') {
    throw new Error('Malformed access token');
  }

  return {
    sub: payload['sub'],
    sid: payload['sid'],
    typ: 'access',
  };
}

/** Opaque refresh token. Only its hash is ever stored. */
export function createRefreshToken(): RefreshTokenMaterial {
  const token = randomToken(48);
  return { token, tokenHash: sha256(token) };
}

export function hashRefreshToken(token: string): string {
  return sha256(token);
}
