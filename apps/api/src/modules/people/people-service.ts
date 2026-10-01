import { and, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm';

import type { Person, PersonMatch, PersonRelation } from '@orbit-hub/contracts';

import { users } from '../../db/auth-schema.js';
import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { memberships, peopleFollows, shares } from '../../db/content-schema.js';

/**
 * The people directory: everybody you have already had a transaction with.
 *
 * This is not a search over `users` and it is not a friends list, and both of
 * those are the same decision seen from two sides. See
 * [ADR 0032](../../../../../docs/architecture/adr/0032-personas.md).
 *
 * **Why it is built out of relations and not out of the users table.** The route
 * for a share answers the same 404 for "there is nobody with that id" and "there is
 * nobody with that address you may see" (`routes/shares.ts:164-170`), and that
 * sameness is what stops somebody enumerating who has an account. A global search
 * over `users` breaks that on purpose. So the answer to "who can I share with" is
 * not "everybody" but "everybody you have already done something with", and
 * showing those people their name and address reveals nothing, because you already
 * knew it: you typed it to send them a mail.
 *
 * **Why there is no acceptance step.** A friend request needs somebody to accept
 * it, and accepting needs a notification, and there is no notification table in
 * this database at all — mail is the only channel. A request nobody is told about
 * is a request that never happens. So there is nothing to accept and nothing that
 * can be lost.
 *
 * **Why this is not offline-first**, like `useShares` is not: it is a read of
 * other people, it is small, and a stale list of who you know is worse than
 * fetching it when the screen opens.
 */
export class PeopleService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  /**
   * Everyone reachable from three relations, merged into one list.
   *
   * The three queries are independent and run together. They are three round trips
   * rather than one `UNION` because a union of three differently-shaped selects is
   * a wall of SQL to read a directory out of, and this is a query whose *shape* is
   * the point: it is meant to be obvious that it never touches `users` except
   * through a join from something the caller already has a row in.
   */
  async directory(userId: string): Promise<Person[]> {
    /*
      The label travels **with its query**.

      It used to be a `Promise.all` destructured into four names, and then a second
      list pairing those names with labels. Two lists that have to agree is the bug:
      swapping them puts `shared_by` on everybody you shared with, and the list still
      looks perfectly right because both directions return real people. It got
      swapped twice before this was written down, and the three tests that name the
      direction are the only reason it was ever caught.

      So there is one list, each entry carrying its own label, and nothing to keep in
      step.
    */
    const fuentes = await Promise.all(
      (
        [
          ['shared_by', this.porQuienComparto(userId)],
          ['shared_with', this.conQuienComparti(userId)],
          ['space', this.genteEnMisEspacios(userId)],
          ['followed', this.genteQueSigo(userId)],
        ] as const
      ).map(async ([relacion, promesa]) => ({ relacion, filas: await promesa })),
    );

    // One person can be here three times over: shared with, shared by, and on the
    // same team. They are one row, because the picker offers a person and not a
    // relationship, and three rows for Marta in a list of six names is a list that
    // has to be deduplicated by whoever renders it.
    const juntos = new Map<string, Person>();

    for (const { relacion, filas } of fuentes) {
      for (const fila of filas) {
        const existente = juntos.get(fila.id);
        if (existente) {
          if (!existente.relations.includes(relacion)) {
            existente.relations.push(relacion);
          }
          if (fila.lastInteractionAt > existente.lastInteractionAt) {
            existente.lastInteractionAt = fila.lastInteractionAt;
          }
        } else {
          juntos.set(fila.id, {
            user: {
              id: fila.id,
              email: fila.email,
              displayName: fila.displayName,
              avatarUrl: fila.avatarUrl,
            },
            relations: [relacion],
            lastInteractionAt: fila.lastInteractionAt,
          });
        }
      }
    }

    // The person you use most at the top. Sorting by name instead puts Ana and
    // Berta at the top forever and buries the three people you actually share
    // with, which is the opposite of what a picker is for.
    return [...juntos.values()].sort((one, two) =>
      two.lastInteractionAt.localeCompare(one.lastInteractionAt),
    );
  }

  /**
   * The people this account has granted something to.
   *
   * Live grants only. A revoked one is not a relationship you still have: the
   * label would say "you shared with her" about something you took back, and a
   * person who appears in a list because of a grant you revoked is a person you
   * cannot get rid of.
   *
   * The timestamp is the grant's `updatedAt` rather than `createdAt` because
   * re-sharing after a revoke updates the row instead of inserting it — the unique
   * index on `(nodeType, nodeId, granteeUserId)` forbids a second row. `createdAt`
   * would keep the date of a share that was taken back months ago and put them
   * near the bottom of a list she is in the middle of using.
   */
  private async conQuienComparti(userId: string) {
    const db = await this.db();
    const filas = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        lastInteractionAt: shares.updatedAt,
      })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.granteeUserId))
      .where(
        and(
          eq(shares.ownerUserId, userId),
          isNull(shares.revokedAt),
          // A deleted account is not somebody to share with, and its row is still
          // there because the grant cascades to nothing rather than disappearing.
          isNull(users.deletedAt),
        ),
      );
    return filas.map(asFila);
  }

  /**
   * The people who have granted something to this account.
   *
   * The same live-grants rule, and `ownerUserId` is nullable (it is set to null
   * when an account is deleted), so the inner join drops those rows on its own:
   * there is nobody left to name.
   */
  private async porQuienComparto(userId: string) {
    const db = await this.db();
    const filas = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        lastInteractionAt: shares.updatedAt,
      })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.ownerUserId))
      .where(and(eq(shares.granteeUserId, userId), isNull(shares.revokedAt), isNull(users.deletedAt)));
    return filas.map(asFila);
  }

  /**
   * The people who are in a space this account is also in.
   *
   * Membership rather than an invitation: somebody who was invited and never
   * answered is not in the space, and putting them in the directory would offer
   * to share with an address that may belong to whoever forwarded the link.
   *
   * Two queries and not a self-join with an alias, because "my spaces, then
   * everyone in them" is the same question asked plainly, and the alias version
   * hides which of the two `user_id` columns is the caller's.
   */
  private async genteEnMisEspacios(userId: string) {
    const db = await this.db();

    const mios = await db
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    if (mios.length === 0) return [];

    const filas = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        // `createdAt` and not `updatedAt`: a role change in the space is something
        // an owner did, not something that happened between these two people.
        lastInteractionAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          inArray(memberships.workspaceId, mios.map((row) => row.workspaceId)),
          // You are not your own colleague. It costs one line to be sure and it
          // would be an embarrassing row at the top of your own directory.
          ne(memberships.userId, userId),
          isNull(users.deletedAt),
        ),
      );
    return filas.map(asFila);
  }
  /**
   * The people this account follows, for the directory.
   *
   * Ordered by when they were followed rather than by name: the person added last
   * is the one you added last because you needed them, and a picker that sorts
   * alphabetically buries them under somebody you stopped working with in March.
   */
  private async genteQueSigo(userId: string) {
    const db = await this.db();
    const filas = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        lastInteractionAt: peopleFollows.createdAt,
      })
      .from(peopleFollows)
      .innerJoin(users, eq(users.id, peopleFollows.followeeUserId))
      .where(and(eq(peopleFollows.followerUserId, userId), isNull(users.deletedAt)));
    return filas.map(asFila);
  }

  /**
   * Find somebody by what you already know of them, to follow them.
   *
   * **This is the only query in the app that reads `users` directly**, and ADR 0032
   * said the directory must never do it. The difference is aim: that one would list,
   * this one looks up the single person you typed. Three characters minimum, ten
   * results maximum, nothing when there is no match — so it cannot be walked a page
   * at a time.
   *
   * And the honest part, because the ADR overclaimed: this discloses nothing that was
   * not already disclosed. `resolveGrantee` answers "is there anybody with this
   * address" with a 404 against a 201, so whether an address has an account has
   * always been observable by trying to share to it. This is the same answer with a
   * name on it instead of an error code, which is strictly less information at
   * strictly less effort to read.
   */
  async search(userId: string, query: string, limit: number): Promise<PersonMatch[]> {
    const db = await this.db();
    const limpio = query.trim().toLowerCase().replace(/^@/, '');
    if (limpio.length < 3) return [];

    const filas = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(
        and(
          or(
            ilike(users.email, `%${limpio}%`),
            ilike(users.displayName, `%${limpio}%`),
            // "marta" finds "marta@example.com" through the local part alone, because
            // nobody remembers which domain the person they work with is on.
            ilike(users.email, `%@${limpio}`),
          ),
          // Not yourself: the database refuses that row, so offering it would be
          // offering a button that always fails.
          ne(users.id, userId),
          isNull(users.deletedAt),
          eq(users.status, 'active'),
        ),
      )
      .limit(limit);

    if (filas.length === 0) return [];

    // People already in the directory are not offered. Asking for Marta should not
    // also hand back the Carla already on the list, where the row would need a
    // button that does not apply to it.
    const yaTengo = new Set(
      (await this.directory(userId)).map((persona) => persona.user.id),
    );
    return filas.filter((fila) => !yaTengo.has(fila.id)).map((fila) => ({ user: fila }));
  }

  /**
   * Follow somebody, which puts them in the directory.
   *
   * `onConflictDoNothing` and not an upsert: following twice has to be a no-op that
   * still answers "yes you follow her", not a 409 the app has to special-case because
   * somebody pressed the button twice.
   */
  async follow(userId: string, followeeUserId: string): Promise<boolean> {
    if (userId === followeeUserId) return false;

    const db = await this.db();
    const existe = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, followeeUserId), isNull(users.deletedAt)))
      .limit(1);
    if (!existe[0]) return false;

    await db
      .insert(peopleFollows)
      .values({ followerUserId: userId, followeeUserId })
      .onConflictDoNothing();

    return true;
  }

  /** Stop following. The row goes rather than getting a flag nobody reads. */
  async unfollow(userId: string, followeeUserId: string): Promise<boolean> {
    const db = await this.db();
    const quitadas = await db
      .delete(peopleFollows)
      .where(
        and(
          eq(peopleFollows.followerUserId, userId),
          eq(peopleFollows.followeeUserId, followeeUserId),
        ),
      )
      .returning({ id: peopleFollows.id });
    return quitadas.length > 0;
  }
}

/** One row of any of the three, with its timestamp already a string. */
interface Fila {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  lastInteractionAt: string;
}

/**
 * Drizzle hands a `timestamp(..., { mode: 'date' })` back as a `Date`, and the
 * contract says `z.iso.datetime()`, which is a string.
 *
 * So it is converted here rather than at the edge, for two reasons that both bite
 * later if you move it: `Date` does not have `localeCompare`, so the sort in
 * `directory` is a method call on something that does not have it, and the merge
 * compares timestamps with `>`, which on `Date` compares instants and on strings
 * compares lexically. Both happen to agree for ISO-8601 in UTC, which is exactly
 * the kind of coincidence that survives until somebody's row is not UTC.
 */
function asFila(fila: Omit<Fila, 'lastInteractionAt'> & { lastInteractionAt: Date }): Fila {
  return { ...fila, lastInteractionAt: fila.lastInteractionAt.toISOString() };
}

export const peopleService = new PeopleService();

/** The relation labels, re-exported so the route does not import the enum twice. */
export type { PersonRelation };
