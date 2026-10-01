import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';

import type { ShareNodeType } from '@orbit-hub/contracts';
import { users } from '../../db/auth-schema.js';
import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { folders, listItems, lists, memberships, notes, shareMounts, shares, workspaces } from '../../db/content-schema.js';
import { HttpError } from '../../lib/http-error.js';
import { accessOf, canRevoke, canShare } from './access.js';
import type { AccessFacts, ShareAccess } from './access.js';

/**
 * What can be shared, taken from the contract instead of restated here.
 *
 * It used to be written out in this file, with a comment saying a note is the
 * `notes` column of an item and so is not a node of its own. Restating the union
 * is what let it drift away from the contract without anybody noticing, which is
 * how a note ended up unshareable and with no table. See
 * `docs/architecture/adr/0008-note-entity.md`.
 */
export type { ShareNodeType };

export interface ShareTarget {
  nodeType: ShareNodeType;
  nodeId: string;
  title: string;
  /** The space it lives in. A grant never grants a space, only what is inside it. */
  workspaceId: string;
}

export interface ShareGrantee {
  userId: string;
  email: string;
  displayName: string | null;
}

/**
 * Sharing, and the two things that have to be true before it happens.
 *
 * The order is the whole service and it is not a detail:
 *
 * 1. **The node has to exist and have a title.** You cannot share "something"; a
 *    share of a thing that is not there is a share of nothing, and the other person
 *    gets a notification about a title that does not resolve.
 * 2. **The person doing it has to be able to share, and that is about the space and
 *    not about the grant.** A grantee can edit fifty items and cannot decide that a
 *    sixth person sees them.
 * 3. **And they cannot share it with themselves**, which sounds obvious and is the
 *    one that would actually be a hole: with a self-grant and no ceiling, you could
 *    grant yourself an editor grant on a node in somebody else's space, and the
 *    ceiling logic is in `access.ts` and would not catch it because the ceiling
 *    looks at memberships and you have none.
 */
export class ShareService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  /**
   * What a node is, and which space it is in.
   *
   * One query per kind, and no guessing: a share that points at a node from
   * another kind would be a grant that resolves to nothing, and the recipient
   * would be told about a list that turns out to be a folder.
   */
  async resolveTarget(nodeType: ShareNodeType, nodeId: string): Promise<ShareTarget> {
    const db = await this.db();

    if (nodeType === 'workspace') {
      const row = await db
        .select({ title: workspaces.name, workspaceId: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, nodeId))
        .limit(1);
      const found = row[0];
      if (!found) throw HttpError.notFound('That does not exist');
      return { nodeType, nodeId, title: found.title, workspaceId: found.workspaceId };
    }

    if (nodeType === 'folder') {
      const row = await db
        .select({ title: folders.name, workspaceId: folders.workspaceId })
        .from(folders)
        .where(eq(folders.id, nodeId))
        .limit(1);
      const found = row[0];
      if (!found) throw HttpError.notFound('That does not exist');
      return { nodeType, nodeId, title: found.title, workspaceId: found.workspaceId };
    }

    if (nodeType === 'list') {
      const row = await db
        .select({ title: lists.title, workspaceId: lists.workspaceId })
        .from(lists)
        .where(eq(lists.id, nodeId))
        .limit(1);
      const found = row[0];
      if (!found) throw HttpError.notFound('That does not exist');
      return { nodeType, nodeId, title: found.title, workspaceId: found.workspaceId };
    }

    /*
     * A note is its own table and its own sync entity (ADR 0008), and it carries
     * its own `workspace_id`, so it resolves in one query with no join.
     *
     * It did not have a branch here, and the `else` below swallowed it: a share of
     * a note went looking for a list row with that id, found nothing, and answered
     * 404. Worse, `assertCanWrite` in sync-service calls this same function and
     * turns the throw into "workspace not found", so the person a note was shared
     * with could not edit it. The pull side got this right from the start
     * (`cadenasDeCompartido` in sync-repository) and this one did not, which is how
     * a note ended up shareable on the way in and unopenable on the way back.
     */
    if (nodeType === 'note') {
      const row = await db
        .select({ title: notes.title, workspaceId: notes.workspaceId })
        .from(notes)
        .where(eq(notes.id, nodeId))
        .limit(1);
      const found = row[0];
      if (!found) throw HttpError.notFound('That does not exist');
      return { nodeType, nodeId, title: found.title, workspaceId: found.workspaceId };
    }

    const row = await db
      .select({ title: listItems.title, workspaceId: lists.workspaceId })
      .from(listItems)
      .innerJoin(lists, eq(listItems.listId, lists.id))
      .where(eq(listItems.id, nodeId))
      .limit(1);
    const found = row[0];
    if (!found) throw HttpError.notFound('That does not exist');
    return { nodeType, nodeId, title: found.title, workspaceId: found.workspaceId };
  }

  /** Their role in a space, or null when they are not in it. */
  private async roleIn(workspaceId: string, userId: string): Promise<string | null> {
    const db = await this.db();
    const row = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .limit(1);
    return row[0]?.role ?? null;
  }

  /**
   * The strongest live grant that reaches this node, or null.
   *
   * "Reaches" means this node or anything above it, which is what makes a shared
   * folder carry its lists: a grant on the folder is a grant on everything inside
   * it. A grant deeper down does not reach upwards, because a list inside a folder
   * you cannot see is not yours by way of that list.
   */
  private async grantReaching(
    target: ShareTarget,
    userId: string,
  ): Promise<{ role: string; shareId: string } | null> {
    const db = await this.db();
    const ancestors = await this.ancestorsOf(target);

    const rows = await db
      .select({ role: shares.role, shareId: shares.id })
      .from(shares)
      .where(
        and(
          eq(shares.granteeUserId, userId),
          isNull(shares.revokedAt),
          inArray(shares.nodeId, ancestors),
        ),
      )
      .orderBy(desc(shares.createdAt))
      .limit(1);

    return rows[0] ? { role: rows[0].role, shareId: rows[0].shareId } : null;
  }

  /**
   * The node and every folder above it, so one `in` covers the whole chain.
   *
   * A space is included because sharing a space is one of the four things you can
   * share, and it is the node that holds everything.
   */
  /**
   * Whether this person already reaches this node by something shared above it.
   *
   * "Above it" is a live grant on the node itself, on any folder above it, or on the
   * space it lives in — the three ways of already having something. Membership is
   * **not** one of them and is deliberately not counted: a colleague who is in your
   * space is there because you invited them, and sharing a single list with them on
   * top of that is a normal thing to want to do. It narrows their role on that one
   * list, which is the point of it.
   *
   * A grant *on the node itself* is in the list because `whoHas` counts it, and the
   * picker greys the person out on that basis. If this and `whoHas` disagreed, the
   * same person would be unselectable in one screen and accepted by another.
   */
  private async alcanzaPorEncima(target: ShareTarget, userId: string): Promise<boolean> {
    const db = await this.db();
    const ancestors = await this.ancestorsOf(target);
    const row = await db
      .select({ id: shares.id })
      .from(shares)
      .where(
        and(
          eq(shares.granteeUserId, userId),
          isNull(shares.revokedAt),
          inArray(shares.nodeId, ancestors),
        ),
      )
      .limit(1);
    return row.length > 0;
  }

  private async ancestorsOf(target: ShareTarget): Promise<string[]> {
    const db = await this.db();
    const ids = [target.nodeId, target.workspaceId];

    if (target.nodeType === 'folder') {
      let actual: string | null = target.nodeId;
      // Bounded by the depth anybody can actually build, and not recursive: a
      // cycle in the folder tree would otherwise spin here forever.
      for (let nivel = 0; nivel < 32 && actual; nivel += 1) {
        const row = await db
          .select({ parentId: folders.parentId })
          .from(folders)
          .where(eq(folders.id, actual))
          .limit(1);
        actual = row[0]?.parentId ?? null;
        if (actual) ids.push(actual);
      }
    }

    if (target.nodeType === 'list' || target.nodeType === 'list_item') {
      const listId =
        target.nodeType === 'list'
          ? target.nodeId
          : (
              await db
                .select({ listId: listItems.listId })
                .from(listItems)
                .where(eq(listItems.id, target.nodeId))
                .limit(1)
            )[0]?.listId;
      if (listId) {
        // La lista misma, y no solo su carpeta: una concesion sobre una lista tiene
        // que llegar a los elementos de dentro, o "comparte esta lista" y "comparte
        // esta lista vacia" serian lo mismo y el que la recibio no puede tachar nada.
        ids.push(listId);
        const row = await db
          .select({ folderId: lists.folderId })
          .from(lists)
          .where(eq(lists.id, listId))
          .limit(1);
        const folderId = row[0]?.folderId;
        if (folderId) ids.push(folderId);
      }
    }

    return ids;
  }

  /** The facts that decide what somebody can do with a node. */
  async accessFor(target: ShareTarget, userId: string): Promise<ShareAccess> {
    const [membership, grant, mount] = await Promise.all([
      this.roleIn(target.workspaceId, userId),
      this.grantReaching(target, userId),
      this.mountRoleOf(target.nodeId, userId),
    ]);

    const facts: AccessFacts = {
      membershipRole: membership,
      mountRole: mount,
      grantRole: grant?.role ?? null,
    };
    return accessOf(facts);
  }

  /** Their role in the space they filed it in, or null if not filed or not a member. */
  private async mountRoleOf(nodeId: string, userId: string): Promise<string | null> {
    const db = await this.db();
    const row = await db
      .select({ workspaceId: shareMounts.workspaceId })
      .from(shares)
      .innerJoin(shareMounts, eq(shareMounts.shareId, shares.id))
      .where(and(eq(shares.nodeId, nodeId), eq(shareMounts.userId, userId)))
      .limit(1);
    if (!row[0]) return null;
    return this.roleIn(row[0].workspaceId, userId);
  }

  /**
   * Hands a node to somebody.
   *
   * Throws before writing anything if the node is not there, if the caller cannot
   * share, or if they are sharing with themselves. The self-share is the one worth
   * naming: `access.ts` looks at memberships for the ceiling, and a person with no
   * membership anywhere has no ceiling, so a self-grant would be the one way to get
   * editor on a list in somebody else's space.
   */
  async createShare(args: {
    ownerUserId: string;
    target: ShareTarget;
    grantee: ShareGrantee;
    role: 'editor' | 'viewer';
  }): Promise<{
    shareId: string;
    /** Who to write to, and how. The mail needs both and the service is where they are. */
    address: string;
    locale: 'es' | 'en';
    title: string;
    spaceName: string | null;
    ownerName: string;
  }> {
    const db = await this.db();

    if (args.grantee.userId === args.ownerUserId) {
      throw HttpError.badRequest('You cannot share something with yourself');
    }

    /*
     * Only the owner of the space. See `canShare` in `./access.ts` for the whole
     * argument and for the case this costs.
     *
     * Two different people get refused here — somebody who is not a member, and
     * somebody who is a member but not the owner — and they used to get the same
     * sentence, which told an editor of the space that they did not belong to it.
     * They do. So they are told what is actually true.
     */
    const membership = await this.roleIn(args.target.workspaceId, args.ownerUserId);
    if (!canShare({ membershipRole: membership, mountRole: null, grantRole: null })) {
      throw HttpError.forbidden(
        membership === null
          ? 'You cannot share something from a space you do not belong to'
          : 'Only the owner of the space can share what is in it',
      );
    }

    const existing = await db
      .select({ id: shares.id, revokedAt: shares.revokedAt })
      .from(shares)
      .where(
        and(
          eq(shares.nodeType, args.target.nodeType),
          eq(shares.nodeId, args.target.nodeId),
          eq(shares.granteeUserId, args.grantee.userId),
        ),
      )
      .limit(1);

    const previa = existing[0];
    if (previa && !previa.revokedAt) {
      throw HttpError.conflict('That is already shared with that person');
    }

    /*
     * The same node, twice, is above and says so. This one is **different**: they
     * already reach this node through something else, most often the whole space was
     * shared with them, and a new grant gives them nothing.
     *
     * It is not refused because it is forbidden but because it is **pointless**, and
     * pointless is worse than forbidden here because it leaves two things behind. The
     * grant gives them nothing and then sits in their "shared with me" as an item to
     * file that they cannot file: the node is in a space they are not a member of, and
     * `placeShare` asks exactly that. So the report was: the space stopped showing as
     * shared, two items appeared that could not be put anywhere, and both were echoes
     * of the space grant itself.
     *
     * After the check above and not before, so that "you already shared this exact
     * thing" keeps its own sentence. One rule covering both cases said "already has
     * this through something else" about the thing itself, which is not what happened.
     *
     * The client already greyed these people out, from `whoHas`. But the client is not
     * the boundary, and a rule that only lives in the picker is a rule the API does
     * not have: share by typed email and the duplicate goes straight in.
     */
    const yaLoTiene = await this.alcanzaPorEncima(args.target, args.grantee.userId);
    if (yaLoTiene) {
      throw HttpError.conflict(
        'That person already has this through something else that was shared with them',
      );
    }

    // Who writes it, and in which language. Read once here so the route does not have
    // to go back for it after the row is already written, and so the two places that
    // can fail (this read and the insert) fail before anything is half-done.
    const paraQuien = await db
      .select({ email: users.email, locale: users.locale, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, args.grantee.userId))
      .limit(1);

    const para = paraQuien[0];
    if (!para) throw HttpError.notFound('There is nobody with that id');

    const delDueno = await db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, args.ownerUserId))
      .limit(1);

    const paraEl = {
      shareId: '',
      address: para.email,
      locale: (para.locale === 'en' ? 'en' : 'es') as 'es' | 'en',
      title: args.target.title,
      // A shared space has no space above it, and the mail says so by dropping the
      // second half of the subject instead of naming itself.
      spaceName:
        args.target.nodeType === 'workspace'
          ? null
          : await this.spaceName(args.target.workspaceId),
      ownerName: delDueno[0]?.name ?? para.email,
    };

    // A revoked grant is put back rather than duplicated: one row per person and
    // node, so the device that already knows the share id keeps knowing it.
    //
    // This branch comes **before** the insert and not after, and that ordering is
    // the whole point. There is a unique index on (node, person), so inserting
    // first and updating afterwards looks equivalent and is not: it walks straight
    // into the constraint. The tell is that the code below had the same comment and
    // the comment was right about the *design* and nobody ever ran the path — share,
    // revoke, share again — because every test shared once and stopped.
    if (previa) {
      await db
        .update(shares)
        .set({
          role: args.role,
          revokedAt: null,
          ownerUserId: args.ownerUserId,
          updatedAt: new Date(),
        })
        .where(eq(shares.id, previa.id));
      await this.tocaElNodo(args.target);
      return { ...paraEl, shareId: previa.id };
    }

    const [creada] = await db
      .insert(shares)
      .values({
        ownerUserId: args.ownerUserId,
        nodeType: args.target.nodeType,
        nodeId: args.target.nodeId,
        granteeUserId: args.grantee.userId,
        role: args.role,
      })
      .returning({ id: shares.id });

    if (!creada) throw HttpError.badRequest('The share could not be created');
    await this.tocaElNodo(args.target);
    return { ...paraEl, shareId: creada.id };
  }

  /**
   * Moves the node's own clock forward when a grant starts or stops.
   *
   * The pull is a walk through time and the cursor is a date, so the only way a
   * device hears about a node is if the node's `updatedAt` is after where it left
   * off. Sharing a list that has not been touched since last Tuesday would
   * therefore send nothing: the row is not newer than the cursor, the cursor does
   * not move, and the phone that just received a tombstone for that list — or
   * that never had it — never learns it exists. The share row is new and nobody is
   * looking at it.
   *
   * The node is stamped, not the grant, because the grant's timestamp is not in
   * the stream the client reads. And it is not a lie: the node's set of readers
   * really did change at this moment, which is the only thing `updatedAt` is
   * supposed to mean.
   *
   * The owner gets a re-send of a row they already have. That is free and it is
   * better than the alternative, which is a person who shared a list and never
   * saw it arrive.
   */
  private async tocaElNodo(target: ShareTarget): Promise<void> {
    const db = await this.db();
    const ahora = new Date();

    if (target.nodeType === 'workspace') {
      await db.update(workspaces).set({ updatedAt: ahora }).where(eq(workspaces.id, target.nodeId));
    } else if (target.nodeType === 'folder') {
      await db.update(folders).set({ updatedAt: ahora }).where(eq(folders.id, target.nodeId));
    } else if (target.nodeType === 'list') {
      await db.update(lists).set({ updatedAt: ahora }).where(eq(lists.id, target.nodeId));
    } else if (target.nodeType === 'note') {
      // The note's own table, for the reason `resolveTarget` has a branch for it:
      // falling through here stamped a list row that does not exist, so the pull
      // cursor never moved and the grantee was never told anything had arrived.
      await db.update(notes).set({ updatedAt: ahora }).where(eq(notes.id, target.nodeId));
    } else {
      await db.update(listItems).set({ updatedAt: ahora }).where(eq(listItems.id, target.nodeId));
    }
  }

  /** The name of a space, for the mail that says where the thing came from. */
  private async spaceName(workspaceId: string): Promise<string | null> {
    const db = await this.db();
    const row = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row[0]?.name ?? null;
  }

  /**
   * Takes a share back.
   *
   * Revoked and not deleted, so the other device hears about it. And only by the
   * person who granted it: two people editing the same list does not make the
   * second one the owner of who else sees it.
   */
  async revokeShare(args: { userId: string; shareId: string }): Promise<void> {
    const db = await this.db();
    const row = await db
      .select({
        ownerUserId: shares.ownerUserId,
        granteeUserId: shares.granteeUserId,
        revokedAt: shares.revokedAt,
        nodeType: shares.nodeType,
        nodeId: shares.nodeId,
      })
      .from(shares)
      .where(eq(shares.id, args.shareId))
      .limit(1);

    const found = row[0];
    if (!found) throw HttpError.notFound('That share does not exist');
    if (!canRevoke({ grantOwnerId: found.ownerUserId, userId: args.userId })) {
      throw HttpError.forbidden('Only the person who shared it can take it back');
    }
    if (found.revokedAt) return;

    await db.update(shares).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(shares.id, args.shareId));
    // The mount goes with it: a filing that points at a share nobody has any more
    // is a list in a folder that cannot be opened.
    await db.delete(shareMounts).where(eq(shareMounts.shareId, args.shareId));

    // The node's clock moves too, for the same reason it moves on sharing: the
    // tombstone is keyed by `revokedAt`, and a device whose cursor is already past
    // the node's own `updatedAt` would never be sent it.
    // `found`, not `row`: `row` is the array, and `row[0].nodeType` is a property
    // of an array that does not exist. It type-errors, which is the good case.
    const target = await this.resolveTarget(found.nodeType, found.nodeId).catch(() => null);
    if (target) await this.tocaElNodo(target);
  }

  /**
   * Who has this node right now, and what may they do with it.
   *
   * The one question a delete has to ask before it does anything: "you are about to
   * delete this from four places". It counts live grants, because a revoked one is
   * not affected by a delete.
   */
  async whoHas(
    target: ShareTarget,
  ): Promise<{ count: number; people: { userId: string; email: string; role: string }[] }> {
    const db = await this.db();
    const ancestors = await this.ancestorsOf(target);

    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        role: shares.role,
      })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.granteeUserId))
      .where(and(isNull(shares.revokedAt), inArray(shares.nodeId, ancestors)))
      .orderBy(desc(shares.createdAt));

    return { count: rows.length, people: rows };
  }

  /**
   * Files a received thing somewhere, which is what takes it out of "shared with
   * me". The space has to be one of theirs and the folder, if given, has to be in
   * it: a mount into somebody else's space would be sharing by the back door.
   */
  async placeShare(args: {
    userId: string;
    shareId: string;
    workspaceId: string;
    folderId: string | null;
    position?: number;
  }): Promise<void> {
    const db = await this.db();

    const share = await db
      .select({ granteeUserId: shares.granteeUserId, nodeType: shares.nodeType, nodeId: shares.nodeId, revokedAt: shares.revokedAt })
      .from(shares)
      .where(eq(shares.id, args.shareId))
      .limit(1);
    const encontrada = share[0];
    if (!encontrada || encontrada.revokedAt) throw HttpError.notFound('That share does not exist');
    if (encontrada.granteeUserId !== args.userId) {
      throw HttpError.forbidden('That share is not yours to place');
    }

    /*
     * Said plainly rather than as the membership question below.
     *
     * A space is not filed inside another space, so this used to answer the one thing
     * that was never the problem — "you can only file it in one of your own spaces" —
     * while the real one was that there was nothing to file.
     */
    if (encontrada.nodeType === 'workspace') {
      throw HttpError.badRequest('A shared space is already in your spaces: there is nothing to file');
    }

    if (!(await this.roleIn(args.workspaceId, args.userId))) {
      throw HttpError.forbidden('You can only file it in one of your own spaces');
    }

    if (args.folderId) {
      const folder = await db
        .select({ workspaceId: folders.workspaceId })
        .from(folders)
        .where(eq(folders.id, args.folderId))
        .limit(1);
      if (!folder[0] || folder[0].workspaceId !== args.workspaceId) {
        throw HttpError.badRequest('That folder is not in that space');
      }
    }

    const now = new Date();
    await db
      .insert(shareMounts)
      .values({
        shareId: args.shareId,
        userId: args.userId,
        workspaceId: args.workspaceId,
        folderId: args.folderId,
        position: args.position ?? 0,
        placedAt: now,
      })
      .onConflictDoUpdate({
        target: [shareMounts.shareId, shareMounts.userId],
        set: {
          workspaceId: args.workspaceId,
          folderId: args.folderId,
          position: args.position ?? 0,
          placedAt: now,
          updatedAt: now,
        },
      });
  }

  /**
   * Todo lo que me han compartido y sigue vivo, con su fecha.
   *
   * Es **otra cosa** que `inbox`, y la distincion es el motivo de que exista:
   *
   * - `inbox` son las cosas que **hay que colocar** en un espacio tuyo. Por eso no
   *   incluye los espacios compartidos: un espacio no se coloca dentro de otro.
   * - `incoming` son las cosas que **te han llegado**, para saber si ha llegado algo
   *   nuevo. Y un espacio compartido es exactamente eso: ha llegado, aparece en tu
   *   lista de espacios, y merece decirselo.
   *
   * Si se reutilizara `inbox` para avisar, un espacio compartido no notified nunca —
   * que es justo uno de los tres tipos que el sitio pide avisar (item, carpeta y
   * workspace). Y si `inbox` volviera a incluir los espacios, se reintroducia el
   * "colgar un espacio dentro de otro" que se acaba de quitar.
   *
   * Incluye lo ya colocado a proposito: "te ha llegado" no deja de ser cierto por
   * haberlo-archivado, y el badge se limpia al abrir el menu, asi que aqui no
   * engorda una lista que nadie mira.
   */
  async incoming(userId: string): Promise<
    {
      shareId: string;
      nodeType: ShareNodeType;
      title: string;
      ownerName: string | null;
      createdAt: Date;
    }[]
  > {
    const db = await this.db();

    const rows = await db
      .select({
        shareId: shares.id,
        nodeType: shares.nodeType,
        nodeId: shares.nodeId,
        ownerName: users.displayName,
        createdAt: shares.createdAt,
      })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.ownerUserId))
      .where(and(eq(shares.granteeUserId, userId), isNull(shares.revokedAt)))
      .orderBy(desc(shares.createdAt));

    // The title is one query per node, on purpose not a join, for the same reason
    // `inbox` does it that way: the node can be a workspace, a folder, a list, an
    // item or a note, and four joins to get one string is four chances to get a join
    // wrong. A grant whose node has since been deleted cannot be titled, and it is
    // dropped rather than sent as a blank row.
    const out: {
      shareId: string;
      nodeType: ShareNodeType;
      title: string;
      ownerName: string | null;
      createdAt: Date;
    }[] = [];

    for (const row of rows) {
      const target = await this.resolveTarget(row.nodeType, row.nodeId).catch(() => null);
      if (!target) continue;
      out.push({
        shareId: row.shareId,
        nodeType: row.nodeType,
        title: target.title,
        ownerName: row.ownerName,
        createdAt: row.createdAt,
      });
    }

    return out;
  }

  /**
   * "Shared with me": what has been given to this person and not filed yet.
   *
   * Only unplaced ones. Once somebody chooses where it goes it belongs to that
   * space and the screen has done its job, and a list that keeps showing up in the
   * inbox after you have filed it is a list you cannot get rid of.
   */
  async inbox(userId: string): Promise<
    {
      shareId: string;
      nodeType: ShareNodeType;
      nodeId: string;
      role: string;
      title: string;
      /** Which space it came from, from the node itself. */
      workspaceId: string;
      ownerName: string | null;
      /** Null until it is filed. */
      placedAt: string | null;
    }[]
  > {
    const db = await this.db();

    const rows = await db
      .select({
        shareId: shares.id,
        nodeType: shares.nodeType,
        nodeId: shares.nodeId,
        role: shares.role,
        ownerName: users.displayName,
        // Null by construction — the query below excludes anything mounted — but read
        // rather than assumed. "In practice" is how a field becomes a lie the day the
        // query changes.
        placedAt: shareMounts.placedAt,
      })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.ownerUserId))
      .leftJoin(shareMounts, and(eq(shareMounts.shareId, shares.id), eq(shareMounts.userId, userId)))
      .where(
        and(
          eq(shares.granteeUserId, userId),
          isNull(shares.revokedAt),
          isNull(shareMounts.id),
          /*
           * A shared **space** is not in here, and it was a bug that it was.
           *
           * Everything in this list is something the person has to *put somewhere*:
           * it arrived from somebody else's space and it has no home in yours until
           * you choose one. A space is not that. It arrives whole, with its folders,
           * lists and notes, and it is already in the list of your spaces marked as
           * shared — there is nothing to file and nowhere it could be filed that would
           * mean anything.
           *
           * Listing it anyway produced the worst of the three: a row that said
           * "Compartido conmigo · 2", a panel offering to put a space inside another
           * space, and `403 You can only file it in one of your own spaces` — which is
           * true and useless, because the problem was never the space they picked.
           */
          ne(shares.nodeType, 'workspace'),
        ),
      )
      .orderBy(desc(shares.createdAt));

    // The titles are one query per node, on purpose not a join: the node can be a
    // workspace, a folder, a list or an item, and a union of four joins to get one
    // string is four chances to get a join wrong.
    return Promise.all(
      rows.map(async (row) => {
        const target = await this.resolveTarget(row.nodeType, row.nodeId);
        return {
          shareId: row.shareId,
          nodeType: row.nodeType,
          nodeId: row.nodeId,
          role: row.role,
          title: target.title,
          // `resolveTarget` already walked up to the space, and it is the only place
          // that can: `shares` has no `workspace_id`, because a grant is on a node and
          // the space is wherever that node happens to live.
          workspaceId: target.workspaceId,
          ownerName: row.ownerName,
          placedAt: row.placedAt ? row.placedAt.toISOString() : null,
        };
      }),
    );
  }
}

export const shareService = new ShareService();
