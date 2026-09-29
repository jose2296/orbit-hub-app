import { Platform } from 'react-native';

import type { AuthResult, Device, Session } from '@orbit-hub/contracts';
import { sessionSchema } from '@orbit-hub/contracts';
import { SYNC_DEFAULTS } from '@orbit-hub/config';

import { api, configureApiClient, toApiError } from '@/lib/api';
import type { ApiError } from '@/lib/api';

import { forgetEverything } from './forget-everything';
import { sessionStorage } from './session-storage';
import type { StoredSession } from './session-storage';

export type AuthEvent =
  | { type: 'signed-in'; session: Session }
  | { type: 'signed-out' }
  | { type: 'refreshed'; session: Session };

/** Raised when the credentials are right but the email is still unverified. */
export class EmailVerificationRequiredError extends Error {
  readonly email: string;

  constructor(email: string) {
    super('Email verification required');
    this.name = 'EmailVerificationRequiredError';
    this.email = email;
  }
}

type AuthListener = (event: AuthEvent) => void;

/**
 * Owns the tokens and the refresh cycle.
 *
 * Two problems the legacy client had are solved here:
 *  - refresh is single flight, so parallel 401s trigger exactly one refresh;
 *  - requests always read the current token from this module, never from a
 *    closure captured when the screen was created.
 */
/**
 * How long the launch check waits before going on with what is stored.
 *
 * A fourth of the default fifteen. Long enough for a real answer from a real API
 * and short enough that the person is not looking at nothing.
 */
const BOOT_CHECK_TIMEOUT_MS = 4_000;

class AuthClient {
  private stored: StoredSession | null = null;
  private refreshInFlight: Promise<Session | null> | null = null;
  private listeners = new Set<AuthListener>();

  configure(): void {
    configureApiClient({
      getAccessToken: async () => this.stored?.session.accessToken ?? null,
      onUnauthorized: async () => (await this.refresh()) !== null,
    });
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: AuthEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  get session(): Session | null {
    return this.stored?.session ?? null;
  }

  get isAuthenticated(): boolean {
    return this.stored !== null;
  }

  async restore(): Promise<Session | null> {
    const stored = await sessionStorage.read();
    this.stored = stored;

    if (!stored) return null;

    // A token restored from disk may already be expired: refresh eagerly.
    if (this.isExpiring(stored)) {
      const refreshed = await this.refresh();
      if (refreshed) return refreshed;
    }

    /*
     * Validate the session against the API so the profile is never stale, and a
     * revoked device stops working.
     *
     * **On a short clock, and that is the whole change.** This is a boot check
     * and not a request anybody is waiting on: the session is already in storage
     * and the app could be drawing. Waiting the fifteen seconds of the default
     * timeout for a call whose failure is already handled — the catch below
     * keeps the cached profile, that is what it is for — bought nothing and cost
     * a white screen on every launch with a slow or absent network. Four seconds
     * is long enough for a real API on a normal connection and short enough that
     * a person watching a dead network sees the app instead of a void.
     *
     * A device that was revoked still stops working, and still immediately from
     * the person's side of it: the very next request the app makes is refused
     * with the same 401, and the refresh path clears the session then.
     */
    try {
      const user = await api.get<Session['user']>('/auth/me', {
        timeoutMs: BOOT_CHECK_TIMEOUT_MS,
      });
      if (this.stored) {
        this.stored = { ...this.stored, session: { ...this.stored.session, user } };
        await sessionStorage.write(this.stored.session, this.stored.issuedAt);
      }
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.kind === 'unauthorized' || apiError.kind === 'forbidden') {
        await this.clear();
        return null;
      }
      // Offline: keep the cached profile, the app is designed for this.
    }

    return this.session;
  }

  private isExpiring(stored: StoredSession): boolean {
    const expiresAt = stored.issuedAt + stored.session.expiresIn * 1000;
    return expiresAt - Date.now() < SYNC_DEFAULTS.refreshSkewSeconds * 1000;
  }

  /**
   * Signs in with email and password.
   *
   * Throws `EmailVerificationRequiredError` when the account exists and the
   * password is correct but the address has not been verified yet.
   */
  async login(email: string, password: string): Promise<Session> {
    const result = await api.post<AuthResult>(
      '/auth/login',
      { email: email.trim(), password, device: this.deviceInfo() },
      { anonymous: true },
    );

    if (result.status !== 'authenticated') {
      throw new EmailVerificationRequiredError(result.email);
    }

    await this.acceptSession(result.session);
    return result.session;
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    locale: string;
  }): Promise<AuthResult> {
    const result = await api.post<AuthResult>(
      '/auth/register',
      { ...input, acceptedTermsAt: new Date().toISOString(), device: this.deviceInfo() },
      { anonymous: true },
    );

    if (result.status === 'authenticated') {
      await this.acceptSession(result.session);
    }
    return result;
  }

  async loginWithGoogleCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    platform: 'web' | 'ios' | 'android';
  }): Promise<Session> {
    const result = await api.post<AuthResult>(
      '/auth/google',
      {
        code: input.code,
        redirectUri: input.redirectUri,
        ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}),
        // The API picks the matching Google client; it never trusts a client id
        // chosen by the app.
        device: { ...this.deviceInfo(), platform: input.platform },
      },
      { anonymous: true },
    );

    if (result.status !== 'authenticated') {
      throw new EmailVerificationRequiredError(result.email);
    }

    await this.acceptSession(result.session);
    return result.session;
  }

  async requestPasswordReset(email: string): Promise<void> {
    await api.post('/auth/password/forgot', { email: email.trim() }, { anonymous: true });
  }

  async resendVerification(email: string): Promise<void> {
    await api.post('/auth/verify-email/resend', { email: email.trim() }, { anonymous: true });
  }

  async verifyEmail(token: string): Promise<string> {
    const result = await api.post<{ email: string }>(
      '/auth/verify-email',
      { token },
      { anonymous: true },
    );
    return result.email;
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await api.post('/auth/password/reset', { token, password }, { anonymous: true });
  }

  async listDevices(): Promise<Device[]> {
    return api.get<Device[]>('/auth/devices');
  }

  async revokeDevice(sessionId: string): Promise<void> {
    await api.delete(`/auth/devices/${sessionId}`);
  }

  private async acceptSession(session: Session): Promise<void> {
    await sessionStorage.write(session);
    this.stored = { session, issuedAt: Date.now() };
    this.emit({ type: 'signed-in', session });
  }

  /**
   * Single flight refresh: concurrent callers await the same request, and a
   * failed refresh clears the session exactly once.
   */
  async refresh(): Promise<Session | null> {
    if (!this.stored) return null;
    if (this.refreshInFlight) return this.refreshInFlight;

    const refreshToken = this.stored.session.refreshToken;

    this.refreshInFlight = (async () => {
      try {
        const payload = await api.post<Session>(
          '/auth/refresh',
          { refreshToken },
          {
            anonymous: true,
            noRetryOnUnauthorized: true,
            /*
             * El mismo reloj corto, y por el mismo motivo que la comprobacion de
             * arranque. Este `refresh` se dispara **antes de pintar nada**, y su
             * fallo ya esta tratado dos lineas mas abajo: una red que no contesta
             * devuelve la sesion guardada. Medido: con la red colgada, el token a
             * punto de caducar dejaba la app en la pantalla de carga durante los
             * quince segundos completos del tiempo limite, que es lo que este
             * cambio quita.
             */
            timeoutMs: BOOT_CHECK_TIMEOUT_MS,
          },
        );

        const session = sessionSchema.parse(payload);
        await sessionStorage.write(session);
        this.stored = { session, issuedAt: Date.now() };
        this.emit({ type: 'refreshed', session });
        return session;
      } catch (error) {
        // Only an explicit rejection ends the session; a network blip must not.
        const apiError = toApiError(error);
        if (apiError.kind === 'unauthorized' || apiError.kind === 'forbidden') {
          await this.clear();
          return null;
        }
        return this.session;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  async signOut(allDevices = false): Promise<void> {
    try {
      await api.post('/auth/logout', { allDevices });
    } catch {
      // Signing out locally must always succeed, even offline.
    }
    await this.clear();
    await forgetEverything();
  }

  /**
   * Forgets the tokens and nothing else.
   *
   * The cache is **not** touched here, and that is the bug this is next to.
   *
   * `signOut` used to end at `this.clear()`, which removed the session and left
   * everything that session had written: the cache of workspaces, folders, lists
   * and notes, the outbox with whatever had not been pushed yet, and the pull
   * cursor. So the next person to sign in on that browser opened the app and was
   * shown the previous one's spaces — their names, their folders, their note
   * titles — while `/workspaces` answered `items: []`, because the server had
   * never heard of them either.
   *
   * The screen was not wrong to render what it read, and the data was not in the
   * wrong place: the two halves disagreed, and the half the person could see was
   * somebody else's.
   *
   * On a phone that is a shared device at a desk. On the web it is worse, because
   * the browser profile outlives the session and the next sign-in is a different
   * person typing their own password. Either way the fix is the same: the local
   * data belongs to the session that wrote it.
   */
  async clear(): Promise<void> {
    await sessionStorage.clear();
    this.stored = null;
    this.emit({ type: 'signed-out' });
  }

  private deviceInfo(): { label: string; platform: 'ios' | 'android' | 'web' } {
    const platform = Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
      ? Platform.OS
      : 'web';
    return { label: `${Platform.OS} · OrbitHub`, platform };
  }
}

export const authClient = new AuthClient();

export function toAuthError(error: unknown): ApiError {
  return toApiError(error);
}
