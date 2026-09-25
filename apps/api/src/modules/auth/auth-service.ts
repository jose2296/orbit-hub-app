import type { AuthResult, Device, Locale, Session, User } from '@orbit-hub/contracts';

import { env } from '../../config/env.js';
import { EMAIL_TOKEN_TTL_SECONDS, RESET_TOKEN_TTL_SECONDS } from '../../db/constants.js';
import type { DevicePlatform } from '../../db/constants.js';
import type { SessionRow, UserRow } from '../../db/schema.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { HttpError } from '../../lib/http-error.js';
import { hashPassword, needsRehash, verifyPassword } from '../../lib/password.js';
import { logger } from '../../lib/logger.js';
import { createRefreshToken, signAccessToken } from '../../lib/tokens.js';
import { recordAudit } from '../audit/audit.js';
import type { AuditContext } from '../audit/audit.js';
import {
  createEmailSender,
  EmailDeliveryError,
  passwordResetEmail,
  verificationEmail,
} from '../email/email.js';

import { toContractDevice, toContractUser } from './auth-mappers.js';
import { authRepository } from './auth-repository.js';
import { exchangeGoogleCode, GoogleAuthError } from './google.js';

/**
 * Hash of a value nobody knows. Verifying against it on an unknown email makes
 * the failure path cost the same as a real one, so response timing cannot be
 * used to enumerate accounts.
 */
const TIMING_EQUALISER_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$9DGNlNWEQsf4mywDLx1qiw$s1eRl5Pu0o2SoWzWgra4DycpVG5iLo1HQsEMKguVQpY';

const emailSender = createEmailSender();

export interface DeviceInfo {
  label: string;
  platform: DevicePlatform;
}

export interface RequestContext extends AuditContext {}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);
}

export class AuthService {
  private async buildSession(
    user: UserRow,
    device: DeviceInfo,
    context: RequestContext,
  ): Promise<{ session: Session; sessionRow: SessionRow }> {
    const refresh = createRefreshToken();
    const sessionRow = await authRepository.createSession({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      deviceLabel: device.label,
      platform: device.platform,
      userAgent: context.userAgent ?? null,
      expiresAt: refreshExpiry(),
    });

    const accessToken = await signAccessToken({
      userId: user.id,
      sessionId: sessionRow.id,
    });

    const providers = await authRepository.listProviders(user.id);

    const session: Session = {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
      user: toContractUser(user, providers),
      device: toContractDevice(sessionRow, sessionRow.id),
    };

    return { session, sessionRow };
  }

  private async issueVerificationEmail(user: UserRow): Promise<void> {
    const token = randomToken(32);
    await authRepository.createEmailToken({
      userId: user.id,
      type: 'verify_email',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_SECONDS * 1000),
    });

    await this.deliver('verify_email', () =>
      emailSender.send(
        verificationEmail({
          to: user.email,
          token,
          locale: (user.locale === 'en' ? 'en' : 'es') as Locale,
        }),
      ),
    );
  }

  /**
   * Sends an email without ever failing the request over it.
   *
   * A verification mail that does not arrive looks exactly like a broken
   * sign-up, so the failure is logged, recorded in the audit trail, and the user
   * is pointed at the resend endpoint.
   */
  private async deliver(
    kind: 'verify_email' | 'reset_password',
    send: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await send();
      return true;
    } catch (error) {
      const failure =
        error instanceof EmailDeliveryError
          ? { message: error.message, status: error.status }
          : { message: 'Unexpected delivery error', status: null };

      logger.error({ err: error, kind, status: failure.status }, 'email delivery failed');
      await recordAudit({
        event: 'auth.email_delivery_failed',
        metadata: { kind, status: failure.status, message: failure.message },
      });
      return false;
    }
  }

  async register(
    input: {
      email: string;
      password: string;
      displayName: string;
      locale: Locale;
      device: DeviceInfo;
    },
    context: RequestContext,
  ): Promise<AuthResult> {
    const email = normaliseEmail(input.email);
    const existing = await authRepository.findUserByEmail(email);

    if (existing) {
      await recordAudit({ ...context, event: 'auth.register', metadata: { outcome: 'email_taken' } });
      throw HttpError.conflict('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await authRepository.createUserWithEmailIdentity({
      email,
      displayName: input.displayName.trim(),
      locale: input.locale,
      passwordHash,
    });

    await this.issueVerificationEmail(user);
    await recordAudit({ ...context, userId: user.id, event: 'auth.register' });

    // No session until the address is verified: an unverified account must not
    // reach the product.
    return {
      status: 'email_verification_required',
      email: user.email,
      verificationResentAt: new Date().toISOString(),
    };
  }

  async login(
    input: { email: string; password: string; device: DeviceInfo },
    context: RequestContext,
  ): Promise<AuthResult> {
    const email = normaliseEmail(input.email);
    const user = await authRepository.findUserByEmail(email);
    const identity = user ? await authRepository.findEmailIdentity(email) : null;

    if (!user || !identity?.passwordHash) {
      await verifyPassword(TIMING_EQUALISER_HASH, input.password);
      await recordAudit({ ...context, event: 'auth.login_failed', metadata: { email } });
      throw HttpError.unauthorized('Incorrect email or password');
    }

    // A deleted account must not be signable, and must not look different from
    // an unknown one.
    if (user.deletedAt || user.status !== 'active') {
      await verifyPassword(identity.passwordHash, input.password);
      await recordAudit({ ...context, event: 'auth.login_failed', metadata: { email } });
      throw HttpError.unauthorized('Incorrect email or password');
    }

    const valid = await verifyPassword(identity.passwordHash, input.password);

    if (!valid) {
      await recordAudit({ ...context, userId: user.id, event: 'auth.login_failed' });
      throw HttpError.unauthorized('Incorrect email or password');
    }

    if (!user.emailVerified) {
      await this.issueVerificationEmail(user);
      return {
        status: 'email_verification_required',
        email: user.email,
        verificationResentAt: new Date().toISOString(),
      };
    }

    // Opportunistic upgrade when the hashing parameters have been raised.
    if (needsRehash(identity.passwordHash)) {
      const upgraded = await hashPassword(input.password);
      await authRepository.updatePasswordHash(user.id, upgraded);
    }

    const { session } = await this.buildSession(user, input.device, context);
    await recordAudit({ ...context, userId: user.id, event: 'auth.login' });

    return { status: 'authenticated', session };
  }

  /**
   * Rotates the refresh token. Presenting a token that was already rotated is a
   * replay: the whole family is revoked, because either the client or an
   * attacker is holding a stolen copy.
   */
  async refresh(refreshToken: string, context: RequestContext): Promise<Session> {
    const tokenHash = sha256(refreshToken);

    const current = await authRepository.findSessionByTokenHash(tokenHash);
    const replayed = current ? null : await authRepository.findSessionByPreviousTokenHash(tokenHash);

    if (!current && replayed) {
      await authRepository.revokeFamily(replayed.tokenFamilyId, 'replayed');
      await recordAudit({
        ...context,
        userId: replayed.userId,
        event: 'auth.refresh_replay_detected',
        metadata: { sessionId: replayed.id },
      });
      throw HttpError.unauthorized('This session has been revoked. Sign in again.');
    }

    if (!current) {
      throw HttpError.unauthorized('Invalid refresh token');
    }

    if (current.revokedAt) {
      throw HttpError.unauthorized('This session has been revoked. Sign in again.');
    }

    if (current.user.deletedAt || current.user.status !== 'active') {
      await authRepository.revokeFamily(current.tokenFamilyId, 'revoked');
      throw HttpError.unauthorized('This account is not available');
    }

    if (current.expiresAt.getTime() <= Date.now()) {
      await authRepository.revokeSession(current.id, 'revoked');
      throw HttpError.unauthorized('This session has expired. Sign in again.');
    }

    const next = createRefreshToken();
    const rotated = await authRepository.rotateSession(
      current.id,
      next.tokenHash,
      refreshExpiry(),
    );

    const accessToken = await signAccessToken({
      userId: current.user.id,
      sessionId: rotated.id,
    });

    const providers = await authRepository.listProviders(current.user.id);
    await recordAudit({ ...context, userId: current.userId, event: 'auth.refresh' });

    return {
      accessToken,
      refreshToken: next.token,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
      user: toContractUser(current.user, providers),
      device: toContractDevice(rotated, rotated.id),
    };
  }

  async logout(
    input: { userId: string; sessionId: string; allDevices: boolean },
    context: RequestContext,
  ): Promise<void> {
    if (input.allDevices) {
      const revoked = await authRepository.revokeAllUserSessions(input.userId, 'logout');
      await recordAudit({
        ...context,
        userId: input.userId,
        event: 'auth.logout_all',
        metadata: { revoked },
      });
      return;
    }

    await authRepository.revokeSession(input.sessionId, 'logout');
    await recordAudit({ ...context, userId: input.userId, event: 'auth.logout' });
  }

  async getUser(userId: string): Promise<User> {
    const user = await authRepository.findUserById(userId);
    if (!user || user.deletedAt) {
      throw HttpError.notFound('User not found');
    }
    const providers = await authRepository.listProviders(userId);
    return toContractUser(user, providers);
  }

  async listDevices(userId: string, currentSessionId: string): Promise<Device[]> {
    const active = await authRepository.listActiveSessions(userId);
    return active.map((session) => toContractDevice(session, currentSessionId));
  }

  async revokeDevice(userId: string, sessionId: string, context: RequestContext): Promise<void> {
    const session = await authRepository.findSessionById(sessionId, userId);
    if (!session) {
      throw HttpError.notFound('Session not found');
    }
    await authRepository.revokeSession(sessionId, 'revoked');
    await recordAudit({
      ...context,
      userId,
      event: 'auth.session_revoked',
      metadata: { sessionId },
    });
  }

  /** Always answers the same way, whether or not the account exists. */
  async resendVerification(email: string, context: RequestContext): Promise<void> {
    const user = await authRepository.findUserByEmail(normaliseEmail(email));
    if (user && !user.emailVerified && !user.deletedAt) {
      await this.issueVerificationEmail(user);
      await recordAudit({ ...context, userId: user.id, event: 'auth.verify_email_resent' });
    }
  }

  async verifyEmail(token: string, context: RequestContext): Promise<{ email: string }> {
    const userId = await authRepository.consumeEmailToken(sha256(token), 'verify_email');
    if (!userId) {
      throw HttpError.badRequest('This link is invalid or has expired');
    }

    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw HttpError.badRequest('This link is invalid or has expired');
    }

    await authRepository.markEmailVerified(userId);
    await recordAudit({ ...context, userId, event: 'auth.verify_email' });

    return { email: user.email };
  }

  async requestPasswordReset(email: string, context: RequestContext): Promise<void> {
    const user = await authRepository.findUserByEmail(normaliseEmail(email));
    if (!user || user.deletedAt) {
      await recordAudit({ ...context, event: 'auth.password_reset_requested', metadata: { email } });
      return;
    }

    const token = randomToken(32);
    await authRepository.createEmailToken({
      userId: user.id,
      type: 'reset_password',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000),
    });

    await this.deliver('reset_password', () =>
      emailSender.send(
        passwordResetEmail({
          to: user.email,
          token,
          locale: (user.locale === 'en' ? 'en' : 'es') as Locale,
        }),
      ),
    );

    await recordAudit({ ...context, userId: user.id, event: 'auth.password_reset_requested' });
  }

  async resetPassword(token: string, password: string, context: RequestContext): Promise<void> {
    const userId = await authRepository.consumeEmailToken(sha256(token), 'reset_password');
    if (!userId) {
      throw HttpError.badRequest('This link is invalid or has expired');
    }

    await authRepository.updatePasswordHash(userId, await hashPassword(password));
    // A password change invalidates every session, including the attacker's.
    await authRepository.revokeAllUserSessions(userId, 'password_changed');
    await recordAudit({ ...context, userId, event: 'auth.password_reset_completed' });
  }

  async changePassword(
    input: { userId: string; currentPassword: string; newPassword: string; sessionId: string },
    context: RequestContext,
  ): Promise<void> {
    const user = await authRepository.findUserById(input.userId);
    if (!user) {
      throw HttpError.notFound('User not found');
    }

    const identity = await authRepository.findEmailIdentity(user.email);
    if (!identity?.passwordHash) {
      throw HttpError.badRequest('This account signs in with Google. Link a password first.');
    }

    const valid = await verifyPassword(identity.passwordHash, input.currentPassword);
    if (!valid) {
      throw HttpError.badRequest('The current password is not correct');
    }

    await authRepository.updatePasswordHash(user.id, await hashPassword(input.newPassword));
    await authRepository.revokeAllUserSessions(user.id, 'password_changed', input.sessionId);
    await recordAudit({ ...context, userId: user.id, event: 'auth.password_changed' });
  }

  /** Re-authentication for destructive actions. */
  async assertPassword(userId: string, password: string): Promise<void> {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw HttpError.notFound('User not found');
    }

    const identity = await authRepository.findEmailIdentity(user.email);
    if (!identity?.passwordHash) {
      throw HttpError.badRequest('This account signs in with Google. Re-confirm with Google.');
    }

    const valid = await verifyPassword(identity.passwordHash, password);
    if (!valid) {
      throw HttpError.badRequest('The password is not correct');
    }
  }

  /**
   * Soft-deletes the account and revokes every session. Rows are removed for
   * real in Phase 9 together with storage cleanup; until then they stay so a
   * mistake is recoverable.
   */
  async deleteAccount(userId: string, context: RequestContext): Promise<void> {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw HttpError.notFound('User not found');
    }

    await authRepository.revokeAllUserSessions(userId, 'account_deleted');
    await authRepository.softDeleteUser(userId);
    await recordAudit({ ...context, userId, event: 'account.deleted' });
  }

  /**
   * Google sign-in.
   *
   * Linking is automatic only when Google proves the address and it matches a
   * verified local account. Anything else creates a new account, never a silent
   * merge.
   */
  async loginWithGoogle(
    input: { code: string; redirectUri?: string; codeVerifier?: string; device: DeviceInfo },
    context: RequestContext,
  ): Promise<Session> {
    let profile;
    try {
      profile = await exchangeGoogleCode({
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier,
        // 'unknown' is not a Google client, so it falls back to the web one and
        // fails loudly rather than guessing.
        platform: input.device.platform === 'ios' || input.device.platform === 'android'
          ? input.device.platform
          : 'web',
      });
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        if (error.reason === 'not_configured') {
          throw HttpError.notImplemented('Google sign-in is not configured on this server');
        }
        throw HttpError.unauthorized('Google sign-in could not be completed');
      }
      throw error;
    }

    const existingIdentity = await authRepository.findIdentity('google', profile.sub);
    let user: UserRow;

    if (existingIdentity) {
      const found = await authRepository.findUserById(existingIdentity.userId);
      if (!found) {
        throw HttpError.unauthorized('Google sign-in could not be completed');
      }
      user = found;
    } else {
      const byEmail = await authRepository.findUserByEmail(profile.email);
      const alreadyLinkedGoogle = byEmail
        ? await authRepository.findIdentity('google', profile.sub)
        : null;

      if (byEmail && !alreadyLinkedGoogle) {
        // Safe automatic link: Google verified the address and the local
        // account is verified too.
        if (!byEmail.emailVerified) {
          throw HttpError.conflict(
            'Verify this email address before signing in with Google',
          );
        }
        await authRepository.linkGoogleIdentity({
          userId: byEmail.id,
          subject: profile.sub,
          email: profile.email,
          emailVerified: true,
        });
        user = byEmail;
        await recordAudit({
          ...context,
          userId: user.id,
          event: 'auth.google_linked',
          metadata: { mode: 'automatic' },
        });
      } else {
        user = await authRepository.createUserWithGoogleIdentity({
          email: profile.email,
          displayName: profile.name ?? profile.email.split('@')[0] ?? 'OrbitHub',
          avatarUrl: profile.picture,
          subject: profile.sub,
        });
      }
    }

    const { session } = await this.buildSession(user, input.device, context);
    await recordAudit({ ...context, userId: user.id, event: 'auth.login', metadata: { provider: 'google' } });

    return session;
  }
}

export const authService = new AuthService();
