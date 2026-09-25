import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export interface GoogleProfile {
  /** The Google account id. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_configured' | 'invalid_code' | 'unverified_email' | 'provider_error',
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export function isGoogleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Exchanges an authorization code for the user's profile.
 *
 * The app never sees the client secret: it obtains a short lived code with PKCE
 * and the API performs the exchange server side.
 */
export async function exchangeGoogleCode(input: {
  code: string;
  redirectUri?: string;
}): Promise<GoogleProfile> {
  if (!isGoogleConfigured()) {
    throw new GoogleAuthError('Google sign-in is not configured', 'not_configured');
  }

  const body = new URLSearchParams({
    code: input.code,
    client_id: env.GOOGLE_CLIENT_ID as string,
    client_secret: env.GOOGLE_CLIENT_SECRET as string,
    grant_type: 'authorization_code',
  });

  if (input.redirectUri) {
    body.set('redirect_uri', input.redirectUri);
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const tokenPayload = (await tokenResponse.json()) as GoogleTokenResponse;

  if (!tokenResponse.ok || !tokenPayload.access_token) {
    logger.warn(
      { status: tokenResponse.status, reason: tokenPayload.error },
      'google code exchange rejected',
    );
    throw new GoogleAuthError('The authorization code was rejected', 'invalid_code');
  }

  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });

  const profile = (await profileResponse.json()) as GoogleUserInfoResponse;

  if (!profileResponse.ok || !profile.sub || !profile.email) {
    logger.warn({ status: profileResponse.status }, 'google userinfo rejected');
    throw new GoogleAuthError('Could not read the Google profile', 'provider_error');
  }

  // A Google account without a verified email can never be linked safely.
  if (profile.email_verified !== true) {
    throw new GoogleAuthError('The Google account has no verified email', 'unverified_email');
  }

  return {
    sub: profile.sub,
    email: profile.email.toLowerCase(),
    emailVerified: true,
    name: profile.name ?? null,
    picture: profile.picture ?? null,
  };
}
