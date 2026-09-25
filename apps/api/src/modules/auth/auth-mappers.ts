import type { AuthProviderName, DevicePlatform } from '../../db/constants.js';
import type { SessionRow, UserRow } from '../../db/schema.js';

/**
 * Mappers turn database rows into the shapes declared in `@orbit-hub/contracts`.
 *
 * The boundary is ISO-8601 strings on purpose: the client never sees a `Date`,
 * and a timezone mistake cannot hide in a serialised payload.
 */
export interface MappedUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  locale: 'es' | 'en';
  providers: AuthProviderName[];
  createdAt: string;
}

export interface MappedDevice {
  id: string;
  label: string;
  platform: DevicePlatform;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export function toContractUser(user: UserRow, providers: AuthProviderName[]): MappedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerified,
    locale: user.locale === 'en' ? 'en' : 'es',
    providers: providers.length > 0 ? providers : ['email'],
    createdAt: user.createdAt.toISOString(),
  };
}

export function toContractDevice(session: SessionRow, currentSessionId?: string): MappedDevice {
  return {
    id: session.id,
    label: session.deviceLabel,
    platform: session.platform,
    userAgent: session.userAgent,
    lastSeenAt: session.lastUsedAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    current: currentSessionId !== undefined && session.id === currentSessionId,
  };
}
