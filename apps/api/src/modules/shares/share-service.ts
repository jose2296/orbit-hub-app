import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { users } from '../../db/auth-schema.js';
import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { folders, listItems, lists, memberships, shareMounts, shares, workspaces } from '../../db/content-schema.js';
import { HttpError } from '../../lib/http-error.js';
import { accessOf, canRevoke, canShare } from './access.js';
import type { AccessFacts, ShareAccess } from './access.js';

/** What can be shared. A note is the `notes` column of an item, not a table. */
export type ShareNodeType = 'workspace' | 'folder' | 'list' | 'list_item';

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

    const membership = await this.roleIn(args.target.workspaceId, args.ownerUserId);
    if (!canShare({ membershipRole: membership, mountRole: null, grantRole: null })) {
      throw HttpError.forbidden('You cannot share something from a space you do not belong to');
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

    // A revoked grant is put back rather than duplicated: one row per person and
    // node, so the device that already knows the share id keeps knowing it.
    if (previa) {
      await db
        .update(shares)
        .set({ role: args.role, revokedAt: null, ownerUserId: args.ownerUserId, updatedAt: new Date() })
        .where(eq(shares.id, previa.id));
      return { ...paraEl, shareId: previa.id };
    }

    if (!creada) throw HttpError.badRequest('The share could not be created');
    return { ...paraEl, shareId: creada.id };
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
      .select({ ownerUserId: shares.ownerUserId, granteeUserId: shares.granteeUserId, revokedAt: shares.revokedAt })
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
      .select({ granteeUserId: shares.granteeUserId, nodeId: shares.nodeId, revokedAt: shares.revokedAt })
      .from(shares)
      .where(eq(shares.id, args.shareId))
      .limit(1);
    const encontrada = share[0];
    if (!encontrada || encontrada.revokedAt) throw HttpError.notFound('That share does not exist');
    if (encontrada.granteeUserId !== args.userId) {
      throw HttpError.forbidden('That share is not yours to place');
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
      ownerName: string | null;
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
      })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.ownerUserId))
      .leftJoin(shareMounts, and(eq(shareMounts.shareId, shares.id), eq(shareMounts.userId, userId)))
      .where(
        and(
          eq(shares.granteeUserId, userId),
          isNull(shares.revokedAt),
          isNull(shareMounts.id),
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
          ownerName: row.ownerName,
        };
      }),
    );
  }
}

export const shareService = new ShareService();
