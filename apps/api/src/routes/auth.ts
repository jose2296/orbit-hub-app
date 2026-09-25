import {
  changePasswordRequestSchema,
  deleteAccountRequestSchema,
  deviceSchema,
  forgotPasswordRequestSchema,
  googleAuthRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  uuidSchema,
  verifyEmailRequestSchema,
} from '@orbit-hub/contracts';
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';

import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { clientIp, createRateLimiter } from '../middleware/rate-limit.js';
import { authService } from '../modules/auth/auth-service.js';
import type { DeviceInfo, RequestContext } from '../modules/auth/auth-service.js';
import { authRepository } from '../modules/auth/auth-repository.js';
import { recordAudit } from '../modules/audit/audit.js';

import { sendData } from './respond.js';

export const authRouter = Router();

/** Every auth response carries the request id, like every other route. */
function contextFrom(req: Request): RequestContext {
  return { ip: clientIp(req), userAgent: req.header('user-agent') ?? null };
}

function deviceFrom(input: { label?: string; platform?: string } | undefined): DeviceInfo {
  const platform = deviceSchema.shape.platform.safeParse(input?.platform ?? 'unknown');
  return {
    label: (input?.label ?? 'Unknown device').slice(0, 80),
    platform: platform.success ? platform.data : 'unknown',
  };
}

/** Passwords and email addresses get a much tighter budget than reads. */
const perIp = createRateLimiter({
  name: 'auth-ip',
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  keyFn: clientIp,
});

const sensitivePerIp = createRateLimiter({
  name: 'auth-sensitive',
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: Math.max(2, Math.floor(env.AUTH_RATE_LIMIT_MAX / 4)),
  keyFn: clientIp,
});

const perAccount = (req: Request): string => {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : 'unknown';
};

const perAccountLimiter = createRateLimiter({
  name: 'auth-account',
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_ACCOUNT_RATE_LIMIT_MAX,
  keyFn: perAccount,
});

authRouter.post('/register', perIp, perAccountLimiter, async (req, res) => {
  const input = registerRequestSchema.parse(req.body);
  const result = await authService.register(
    {
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      locale: input.locale,
      device: deviceFrom(input.device),
    },
    contextFrom(req),
  );

  sendData(res, 201, result);
});

authRouter.post('/login', perIp, perAccountLimiter, async (req, res) => {
  const input = loginRequestSchema.parse(req.body);
  const result = await authService.login(
    {
      email: input.email,
      password: input.password,
      device: deviceFrom(input.device),
    },
    contextFrom(req),
  );

  sendData(res, 200, result);
});

authRouter.post('/refresh', perIp, async (req, res) => {
  const input = refreshRequestSchema.parse(req.body);
  const session = await authService.refresh(input.refreshToken, contextFrom(req));
  sendData(res, 200, session);
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();

  const input = req.body && typeof req.body === 'object' ? req.body : {};
  const allDevices = input['allDevices'] === true;

  await authService.logout(
    { userId: auth.userId, sessionId: auth.sessionId, allDevices },
    contextFrom(req),
  );

  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();
  sendData(res, 200, await authService.getUser(auth.userId));
});

authRouter.get('/devices', requireAuth, async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();
  sendData(res, 200, await authService.listDevices(auth.userId, auth.sessionId));
});

const deviceParams = z.object({ id: uuidSchema });

authRouter.delete('/devices/:id', requireAuth, async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();

  const { id } = deviceParams.parse(req.params);
  await authService.revokeDevice(auth.userId, id, contextFrom(req));
  res.status(204).end();
});

authRouter.post('/verify-email', perIp, async (req, res) => {
  const input = verifyEmailRequestSchema.parse(req.body);
  const result = await authService.verifyEmail(input.token, contextFrom(req));
  sendData(res, 200, result);
});

authRouter.post('/verify-email/resend', perIp, perAccountLimiter, async (req, res) => {
  const input = resendVerificationRequestSchema.parse(req.body);
  await authService.resendVerification(input.email, contextFrom(req));
  sendData(res, 202, { accepted: true });
});

authRouter.post('/password/forgot', perIp, perAccountLimiter, async (req, res) => {
  const input = forgotPasswordRequestSchema.parse(req.body);
  await authService.requestPasswordReset(input.email, contextFrom(req));
  // Identical answer whether or not the account exists.
  sendData(res, 202, { accepted: true });
});

authRouter.post('/password/reset', perIp, async (req, res) => {
  const input = resetPasswordRequestSchema.parse(req.body);
  await authService.resetPassword(input.token, input.password, contextFrom(req));
  sendData(res, 200, { reset: true });
});

authRouter.post('/password/change', requireAuth, sensitivePerIp, async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();

  const input = changePasswordRequestSchema.parse(req.body);
  await authService.changePassword(
    {
      userId: auth.userId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      sessionId: auth.sessionId,
    },
    contextFrom(req),
  );

  sendData(res, 200, { changed: true });
});

authRouter.post('/google', perIp, sensitivePerIp, async (req, res) => {
  const input = googleAuthRequestSchema.parse(req.body);
  const session = await authService.loginWithGoogle(
    {
      code: input.code,
      ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}),
      ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}),
      device: deviceFrom(input.device),
    },
    contextFrom(req),
  );

  sendData(res, 200, { status: 'authenticated', session });
});

authRouter.delete('/account', requireAuth, sensitivePerIp, async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();

  const input = deleteAccountRequestSchema.parse(req.body ?? {});

  // Deleting an account requires proving the password again, exactly like
  // changing it: a stolen access token must not be enough.
  if (input.password) {
    await authService.assertPassword(auth.userId, input.password);
  } else {
    throw HttpError.badRequest('Password confirmation is required');
  }

  await authService.deleteAccount(auth.userId, contextFrom(req));
  res.status(204).end();
});

/** Housekeeping endpoint, called on boot by the worker in Phase 6. */
export async function purgeExpiredTokens(): Promise<number> {
  const removed = await authRepository.deleteExpiredTokens();
  await recordAudit({ event: 'auth.logout', metadata: { purgedTokens: removed } });
  return removed;
}
