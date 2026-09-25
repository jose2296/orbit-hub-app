import { z } from 'zod';
import { emailSchema, isoDateTimeSchema, localeSchema, uuidSchema } from './common';

export const authProviderSchema = z.enum(['email', 'google']);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(80),
  avatarUrl: z.url().nullable().default(null),
  emailVerified: z.boolean(),
  locale: localeSchema.default('es'),
  providers: z.array(authProviderSchema).min(1),
  createdAt: isoDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;

/** A device the user has signed in from. Revocable from settings. */
export const deviceSchema = z.object({
  id: uuidSchema,
  label: z.string().min(1).max(80),
  platform: z.enum(['ios', 'android', 'web', 'unknown']),
  userAgent: z.string().max(400).nullable().default(null),
  lastSeenAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  current: z.boolean().default(false),
});
export type Device = z.infer<typeof deviceSchema>;

/**
 * OrbitHub owns the session. Access tokens are short lived, refresh tokens are
 * rotated on every use and stored hashed server side.
 */
export const sessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Access token lifetime in seconds, so the client can refresh proactively. */
  expiresIn: z.number().int().positive(),
  tokenType: z.literal('Bearer').default('Bearer'),
  user: userSchema,
  device: deviceSchema.optional(),
});
export type Session = z.infer<typeof sessionSchema>;

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(80),
  locale: localeSchema.default('es'),
  acceptedTermsAt: isoDateTimeSchema,
  device: deviceSchema.pick({ label: true, platform: true }).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  device: deviceSchema.pick({ label: true, platform: true }).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Result of register/login. `email_verification_required` means no session yet. */
export const authResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('authenticated'), session: sessionSchema }),
  z.object({
    status: z.literal('email_verification_required'),
    email: emailSchema,
    verificationResentAt: isoDateTimeSchema,
  }),
]);
export type AuthResult = z.infer<typeof authResultSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = z.object({
  /** Omit to revoke only the current device session. */
  allDevices: z.boolean().default(false),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(1).max(200),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const verifyEmailRequestSchema = z.object({ token: z.string().min(10) });
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const resendVerificationRequestSchema = z.object({ email: emailSchema });
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

/** Google sign-in: the app obtains an auth code (PKCE) and posts it here. */
export const googleAuthRequestSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.url().optional(),
  device: deviceSchema.pick({ label: true, platform: true }).optional(),
});
export type GoogleAuthRequest = z.infer<typeof googleAuthRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Account deletion requires recent re-authentication. */
export const deleteAccountRequestSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  confirmation: z.literal('DELETE'),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
