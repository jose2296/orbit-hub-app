import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import type { EmailTokenType, DevicePlatform, SessionRevokeReason } from '../../db/constants.js';
import { authIdentities, emailTokens, sessions, users } from '../../db/schema.js';
import type { AuthIdentityRow, SessionRow, UserRow } from '../../db/schema.js';

export interface CreateUserInput {
  email: string;
  displayName: string;
  locale: string;
  passwordHash: string;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  previousTokenHash?: string | null;
  tokenFamilyId?: string;
  deviceLabel: string;
  platform: DevicePlatform;
  userAgent: string | null;
  expiresAt: Date;
}

export interface SessionWithUser extends SessionRow {
  user: UserRow;
}

export class AuthRepository {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  async softDeleteUser(userId: string): Promise<void> {
    const db = await this.db();
    const now = new Date();
    await db
      .update(users)
      .set({ status: 'deleted', deletedAt: now, updatedAt: now })
      .where(eq(users.id, userId));
  }

  async listProviders(userId: string): Promise<('email' | 'google')[]> {
    const db = await this.db();
    const rows = await db
      .select({ provider: authIdentities.provider })
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));

    return rows.map((row) => row.provider);
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const db = await this.db();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const db = await this.db();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async findEmailIdentity(email: string): Promise<AuthIdentityRow | null> {
    const db = await this.db();
    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(
        and(eq(authIdentities.provider, 'email'), eq(authIdentities.providerSubject, email)),
      )
      .limit(1);
    return identity ?? null;
  }

  /** Creates the user and its email identity atomically. */
  async createUserWithEmailIdentity(input: CreateUserInput): Promise<UserRow> {
    const db = await this.db();

    return db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          displayName: input.displayName,
          locale: input.locale,
        })
        .returning();

      if (!user) {
        throw new Error('The user insert returned no row');
      }

      await tx.insert(authIdentities).values({
        userId: user.id,
        provider: 'email',
        providerSubject: input.email,
        email: input.email,
        passwordHash: input.passwordHash,
        linkedAt: new Date(),
      });

      return user;
    });
  }

  /** A Google-only account: no email identity, so no password can be guessed. */
  async createUserWithGoogleIdentity(input: {
    email: string;
    displayName: string;
    avatarUrl: string | null;
    subject: string;
  }): Promise<UserRow> {
    const db = await this.db();

    return db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          emailVerified: true,
        })
        .returning();

      if (!user) {
        throw new Error('The user insert returned no row');
      }

      await tx.insert(authIdentities).values({
        userId: user.id,
        provider: 'google',
        providerSubject: input.subject,
        email: input.email,
        emailVerified: true,
        linkedAt: new Date(),
      });

      return user;
    });
  }

  async findIdentity(provider: 'email' | 'google', subject: string): Promise<AuthIdentityRow | null> {
    const db = await this.db();
    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.provider, provider), eq(authIdentities.providerSubject, subject)))
      .limit(1);
    return identity ?? null;
  }

  async linkGoogleIdentity(input: {
    userId: string;
    subject: string;
    email: string;
    emailVerified: boolean;
  }): Promise<void> {
    const db = await this.db();
    await db
      .insert(authIdentities)
      .values({
        userId: input.userId,
        provider: 'google',
        providerSubject: input.subject,
        email: input.email,
        emailVerified: input.emailVerified,
        linkedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    const db = await this.db();
    await db
      .update(authIdentities)
      .set({ passwordHash })
      .where(
        and(eq(authIdentities.userId, userId), eq(authIdentities.provider, 'email')),
      );
  }

  async markEmailVerified(userId: string): Promise<void> {
    const db = await this.db();
    const now = new Date();
    await db
      .update(users)
      .set({ emailVerified: true, updatedAt: now })
      .where(eq(users.id, userId));
    await db
      .update(authIdentities)
      .set({ emailVerified: true })
      .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, 'email')));
  }

  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    const db = await this.db();
    const [session] = await db
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        previousTokenHash: input.previousTokenHash ?? null,
        ...(input.tokenFamilyId ? { tokenFamilyId: input.tokenFamilyId } : {}),
        deviceLabel: input.deviceLabel,
        platform: input.platform,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
      })
      .returning();

    if (!session) {
      throw new Error('The session insert returned no row');
    }
    return session;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const db = await this.db();
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    return row ? { ...row.session, user: row.user } : null;
  }

  async findSessionByPreviousTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const db = await this.db();
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.previousTokenHash, tokenHash))
      .limit(1);

    return row ? { ...row.session, user: row.user } : null;
  }

  async rotateSession(
    sessionId: string,
    nextTokenHash: string,
    expiresAt: Date,
  ): Promise<SessionRow> {
    const db = await this.db();
    const [updated] = await db
      .update(sessions)
      .set({
        previousTokenHash: sql`token_hash`,
        tokenHash: nextTokenHash,
        rotatedAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt,
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    if (!updated) {
      throw new Error('The session update returned no row');
    }
    return updated;
  }

  async touchSession(sessionId: string): Promise<void> {
    const db = await this.db();
    await db
      .update(sessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async revokeSession(sessionId: string, reason: SessionRevokeReason): Promise<void> {
    const db = await this.db();
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Replay response: kill every session in the family, current one included. */
  async revokeFamily(tokenFamilyId: string, reason: SessionRevokeReason): Promise<void> {
    const db = await this.db();
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.tokenFamilyId, tokenFamilyId), isNull(sessions.revokedAt)));
  }

  async revokeAllUserSessions(
    userId: string,
    reason: SessionRevokeReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const db = await this.db();
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptSessionId) {
      conditions.push(sql`${sessions.id} <> ${exceptSessionId}`);
    }

    const revoked = await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(...conditions))
      .returning({ id: sessions.id });

    return revoked.length;
  }

  async listActiveSessions(userId: string): Promise<SessionRow[]> {
    const db = await this.db();
    return db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          or(isNull(sessions.expiresAt), sql`${sessions.expiresAt} > now()`),
        ),
      )
      .orderBy(sql`${sessions.lastUsedAt} desc`);
  }

  async findSessionById(sessionId: string, userId: string): Promise<SessionRow | null> {
    const db = await this.db();
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .limit(1);
    return session ?? null;
  }

  async deleteExpiredTokens(): Promise<number> {
    const db = await this.db();
    const deleted = await db
      .delete(emailTokens)
      .where(lt(emailTokens.expiresAt, new Date()))
      .returning({ id: emailTokens.id });
    return deleted.length;
  }

  async createEmailToken(input: {
    userId: string;
    type: EmailTokenType;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const db = await this.db();

    // One live token per user and type: requesting a new one invalidates the old.
    await db
      .update(emailTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(emailTokens.userId, input.userId),
          eq(emailTokens.type, input.type),
          isNull(emailTokens.consumedAt),
        ),
      );

    await db.insert(emailTokens).values(input);
  }

  /** Consumes a single-use token, returning its owner when it was still valid. */
  async consumeEmailToken(tokenHash: string, type: EmailTokenType): Promise<string | null> {
    const db = await this.db();
    const [row] = await db
      .update(emailTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(emailTokens.tokenHash, tokenHash),
          eq(emailTokens.type, type),
          isNull(emailTokens.consumedAt),
          sql`${emailTokens.expiresAt} > now()`,
        ),
      )
      .returning({ userId: emailTokens.userId });

    return row?.userId ?? null;
  }
}

export const authRepository = new AuthRepository();
