import { APP_SCHEME } from '@orbit-hub/config';
import * as AuthSession from 'expo-auth-session';
import { useAuthRequest as useGoogleProviderRequest } from 'expo-auth-session/providers/google';
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

function platformOf(): GooglePlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/**
 * On web the redirect has to be an origin Google knows, so it is derived from
 * the page. On native the app owns a scheme, which is registered as an
 * authorised redirect on the Android and iOS clients.
 */
function redirectFor(platform: GooglePlatform): string {
  if (platform !== 'web') return nativeScheme;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/google`;
  }
  return nativeScheme;
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

  async function promptAsync(): Promise<string | null> {
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
