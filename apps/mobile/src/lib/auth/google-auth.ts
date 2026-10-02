import { APP_SCHEME } from '@orbit-hub/config';
import * as AuthSession from 'expo-auth-session';
import { useAuthRequest as useGoogleProviderRequest } from 'expo-auth-session/providers/google';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { authClient } from './auth-client';

/**
 * Google sign-in.
 *
 * Google needs a different OAuth client per platform, so the app picks one
 * before it builds the request:
 *
 * - Web uses a confidential "Web application" client. The API holds the secret.
 * - Android and iOS use their own public clients. Google refuses a web client
 *   id on an installed app, and a public client has no secret at all, so its
 *   code can only be redeemed with the PKCE verifier the app generated.
 *
 * Client ids are public by design. See docs/architecture/auth.md.
 */
type GooglePlatform = 'web' | 'ios' | 'android';

const webClientId =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB?.trim() ??
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim() ??
  '';
const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID?.trim() ?? '';
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS?.trim() ?? '';

const nativeScheme = process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI?.trim() || `${APP_SCHEME}://auth/google`;

/**
 * El origen de la web, que en nativo es de donde sale el redirect https. Vive en
 * el bundle porque `EXPO_PUBLIC_*` se inlinea al compilar.
 */
const EXPO_PUBLIC_WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? '';

function platformOf(): GooglePlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/**
 * **Where Google sends the browser back to. Two hops, and they are not the same
 * address.**
 *
 * `redirectFor` is the `redirect_uri` that goes in the request to Google.
 * `returnUrlFor` is the address `openAuthSessionAsync` waits for, and it is the
 * one that has to bring the user back into the app.
 *
 * On native they used to be the same, `orbithub://auth/google`, and Google now
 * refuses it. Reproduced against the Android client with the same request the
 * app builds:
 *
 *     Access blocked: Authorization Error
 *     redirect_uri=orbithub://auth/google
 *
 * The console says why, on the client itself: *"No se recomienda este parámetro
 * de configuración para los clientes de Android"*, with the custom URI scheme
 * enabled. Google no admite el scheme como `redirect_uri` en una app instalada,
 * y el campo *Authorized redirect URIs* —que es donde se busca la solución— es
 * de los clientes web, así que tampoco sirve ahí.
 *
 * So native goes out to **https** and comes back by **scheme**:
 *
 *     Google ──▶ https://<web>/auth/google      (Google is happy: it is https)
 *            ──▶ orbithub://auth/google?code=… (the app is happy: it is ours)
 *
 * The middle hop is `/auth/google`, which exists. It bounces the browser to the
 * scheme and the flow finishes. Google never sees the scheme: it only ever had
 * the https one, which is the whole point.
 */
function redirectFor(platform: GooglePlatform): string {
  if (platform === 'web') {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/auth/google`;
    }
    return nativeScheme;
  }
  // Nativo: la direccion que ve Google tiene que ser https y viva en un
  // dominio de nuestra cuenta. Sin ella, Google bloquea antes de abrir nada.
  const web = EXPO_PUBLIC_WEB_ORIGIN.trim();
  return web ? `${web.replace(/\/$/, '')}/auth/google` : nativeScheme;
}

/**
 * The address the app is waiting for, which is the scheme — and this one Google
 * never sees, so what Google thinks of custom schemes is irrelevant here.
 *
 * It takes no platform because it is the same in all of them: it is where the
 * *app* is listening, and the app is the app.
 */
function returnUrlFor(): string {
  return nativeScheme;
}

/**
 * A PKCE `code_verifier`: 43 to 128 characters of unreserved ASCII.
 *
 * The length is not a preference, it is what the spec asks for, and Google
 * rejects a shorter one with an `invalid_request` that has nothing to do with
 * the thing you were looking at. 64 random characters fit inside 128.
 */
function randomBytesPKCE(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let out = '';
  for (let i = 0; i < 64; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * `code_challenge` = base64url(SHA256(verifier)), with the padding off.
 *
 * Base64url and not base64: the challenge travels in a query string, and the
 * standard alphabet's `+` and `/` have to be escaped to survive that. The padding
 * goes because it is optional in the challenge and its absence is what every
 * implementation sends.
 */
async function sha256Base64Url(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clientIdFor(platform: GooglePlatform): string {
  if (platform === 'ios') return iosClientId;
  if (platform === 'android') return androidClientId;
  return webClientId;
}

export const googleAuth = {
  platform: platformOf(),
  get clientId() {
    return clientIdFor(platformOf());
  },
  get redirectUri() {
    return redirectFor(platformOf());
  },
  get isConfigured() {
    return clientIdFor(platformOf()).length > 0;
  },
};

export interface GoogleAuthRequest {
  isConfigured: boolean;
  isLoading: boolean;
  /** Returns the authorization code, or null when the flow was cancelled. */
  promptAsync: () => Promise<string | null>;
}

/**
 * Google sign-in through the Authorization Code flow with PKCE.
 *
 * The app never sees a client secret: it obtains a short lived code and the API
 * exchanges it server side. Until the platform's OAuth client exists the hook
 * reports `isConfigured: false`, so the button renders disabled instead of
 * failing at tap time. See docs/architecture/auth.md.
 */
export function useGoogleAuthRequest(): GoogleAuthRequest {
  const [isLoading, setIsLoading] = useState(false);

  const platform = platformOf();
  const clientId = clientIdFor(platform);
  const redirectUri = redirectFor(platform);
  const returnUrl = returnUrlFor();
  const isConfigured = clientId.length > 0;

  const [request, , prompt] = useGoogleProviderRequest({
    clientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    selectAccount: true,
    shouldAutoExchangeCode: false,
  });

  const devicePlatform = useMemo<GooglePlatform>(() => platform, [platform]);

  /**
   * The https hop, hand-built, because `expo-auth-session` ties both hops to one
   * address and the two cannot be the same any more.
   *
   * `prompt()` would send `orbithub://auth/google` to Google, which is exactly
   * what Google now rejects on an installed app. So the URL is assembled here,
   * with the https `redirect_uri` in it, and the browser is opened against the
   * **scheme** as the address to come back to. The middle hop —`/auth/google`,
   * which is a real route— turns the https one into the scheme one.
   *
   * PKCE is not optional on native: the Android client is a public client, it
   * has no secret, and Google only redeems a code that arrives with the verifier
   * that produced its challenge. The API needs both, and it has the verifier.
   */
  async function promptNativo(): Promise<string | null> {
    const verifier = randomBytesPKCE();
    const challenge = await sha256Base64Url(verifier);

    const url =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&code_challenge=${challenge}` +
      `&code_challenge_method=S256` +
      `&access_type=offline` +
      `&prompt=select_account`;

    const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
    if (result.type !== 'success') return null;

    const code = new URL(result.url).searchParams.get('code');
    if (!code) return null;

    await authClient.loginWithGoogleCode({
      code,
      redirectUri,
      codeVerifier: verifier,
      platform: devicePlatform,
    });
    return code;
  }

  async function promptAsync(): Promise<string | null> {
    // En nativo no hay popup: es el esquema el que devuelve el control, y eso
    // no lo sabe hacer `prompt()`.
    if (platform !== 'web') {
      if (!isConfigured) return null;
      setIsLoading(true);
      try {
        return await promptNativo();
      } finally {
        setIsLoading(false);
      }
    }

    if (!isConfigured || !request || !prompt) return null;

    setIsLoading(true);
    try {
      const result = await prompt();
      if (result.type !== 'success') return null;

      const code = new URL(result.url).searchParams.get('code');
      if (!code) return null;

      await authClient.loginWithGoogleCode({
        code,
        redirectUri,
        // A public client cannot be redeemed without it, and it is useless to
        // send it to a confidential one.
        ...(request.codeVerifier ? { codeVerifier: request.codeVerifier } : {}),
        platform: devicePlatform,
      });
      return code;
    } finally {
      setIsLoading(false);
    }
  }

  return { isConfigured, isLoading, promptAsync };
}
