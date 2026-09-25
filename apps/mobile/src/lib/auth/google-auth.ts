import { APP_SCHEME } from '@orbit-hub/config';
import * as AuthSession from 'expo-auth-session';
import { useAuthRequest as useGoogleProviderRequest } from 'expo-auth-session/providers/google';
import { useState } from 'react';
import { Platform } from 'react-native';

import { authClient } from './auth-client';

/**
 * Google web client id. Public by design; the client secret never reaches the
 * app. Provided by the project owner once the Google Cloud client exists.
 */
const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? '';
const redirectUri =
  process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI?.trim() || `${APP_SCHEME}://auth/google`;

export const googleAuth = {
  isConfigured: clientId.length > 0,
  clientId,
  redirectUri,
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
 * exchanges it server side. Until the OAuth client exists the hook reports
 * `isConfigured: false`, so the button renders disabled instead of failing at
 * tap time. See docs/architecture/auth.md.
 */
export function useGoogleAuthRequest(): GoogleAuthRequest {
  const [isLoading, setIsLoading] = useState(false);

  const [request, , prompt] = useGoogleProviderRequest({
    clientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    selectAccount: true,
    shouldAutoExchangeCode: false,
  });

  async function promptAsync(): Promise<string | null> {
    if (!googleAuth.isConfigured || !request || !prompt) return null;

    setIsLoading(true);
    try {
      const result = await prompt();
      if (result.type !== 'success') return null;

      const code = new URL(result.url).searchParams.get('code');
      if (!code) return null;

      await authClient.loginWithGoogleCode(code, redirectUri);
      return code;
    } finally {
      setIsLoading(false);
    }
  }

  return { isConfigured: googleAuth.isConfigured, isLoading, promptAsync };
}

/** Web builds the redirect URI from the current origin, native uses the scheme. */
export function webRedirectUri(): string {
  if (Platform.OS !== 'web') return redirectUri;
  return `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/google`;
}
