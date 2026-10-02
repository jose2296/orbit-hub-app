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

export type GooglePlatform = 'web' | 'ios' | 'android';

interface GoogleClient {
  clientId: string;
  /** Absent on native: those clients are public and must not hold a secret. */
  clientSecret?: string;
}

/**
 * One OAuth client per platform, because Google treats them differently.
 *
 * A "Web application" client is confidential and Google refuses to let an
 * installed app use it, answering `invalid_request` with "does not comply with
 * Google's OAuth 2.0 policy for keeping apps secure". Native clients are public,
 * have no secret, and must redeem their code with the PKCE verifier.
 */
function googleClientFor(platform: GooglePlatform): GoogleClient | null {
  if (platform === 'ios') {
    return env.GOOGLE_IOS_CLIENT_ID ? { clientId: env.GOOGLE_IOS_CLIENT_ID } : null;
  }
  if (platform === 'android') {
    if (!env.GOOGLE_ANDROID_CLIENT_ID) return null;
    /*
     * **El secret viaja también en Android, y aquí está por qué.**
     *
     * La regla de Google es que una app instalada no use un client *web*, y el
     * motivo —el único— es que el secret acaba dentro del APK, donde cualquiera
     * lo extrae. **Aquí no**: el canje lo hace este servidor, la app solo manda
     * el `code` y el `code_verifier`, y el secret no sale de aquí ni entra en el
     * bundle. Se comprueba en `auth-client.ts`, que no envía ni el client id ni
     * el secret.
     *
     * Y el motivo por el que hace falta mandarlo: Google ya no admite un
     * `redirect_uri` https propio en un client **de Android** —probado, el mismo
     * request con el client web pasa a la pantalla de consentimiento y con el de
     * Android responde `Access blocked: This app's request is invalid`— y su
     * esquema propio aparece en su propia consola como "no se recomienda" y lo
     * bloquea a la vez. Esas son las dos ramas, y las dos están cerradas.
     *
     * Mandar el secret es inocuo para un client público de verdad —Google lo
     * ignora— y es lo que un client *web* exige para canjear el código. Por eso
     * se manda siempre que exista, y no solo en la rama de web.
     */
    return {
      clientId: env.GOOGLE_ANDROID_CLIENT_ID,
      ...(env.GOOGLE_CLIENT_SECRET ? { clientSecret: env.GOOGLE_CLIENT_SECRET } : {}),
    };
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

export function isGoogleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** True when the platform the device reported has a usable client. */
export function isGoogleConfiguredFor(platform: GooglePlatform): boolean {
  return googleClientFor(platform) !== null;
}

/**
 * Exchanges an authorization code for the user's profile.
 *
 * The app never sees a client secret: it obtains a short lived code with PKCE
 * and the API performs the exchange server side. On native the client is public,
 * so the API sends the `code_verifier` the app generated instead of a secret.
 *
 * The platform comes from the request and only chooses between three clients the
 * project owns. It cannot select an arbitrary third party client, and a wrong
 * guess simply fails at Google.
 */
export async function exchangeGoogleCode(input: {
  code: string;
  redirectUri?: string;
  codeVerifier?: string;
  platform?: GooglePlatform;
}): Promise<GoogleProfile> {
  const platform: GooglePlatform = input.platform ?? 'web';
  const client = googleClientFor(platform);

  if (!client) {
    throw new GoogleAuthError(
      `Google sign-in is not configured for ${platform}`,
      'not_configured',
    );
  }

  if (!client.clientSecret && !input.codeVerifier) {
    // A public client without the verifier cannot redeem the code at all, so
    // this is a client bug rather than something a retry would fix.
    throw new GoogleAuthError('The authorization code could not be redeemed', 'invalid_code');
  }

  const body = new URLSearchParams({
    code: input.code,
    client_id: client.clientId,
    grant_type: 'authorization_code',
  });

  if (client.clientSecret) {
    body.set('client_secret', client.clientSecret);
  }
  if (input.codeVerifier) {
    body.set('code_verifier', input.codeVerifier);
  }
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
