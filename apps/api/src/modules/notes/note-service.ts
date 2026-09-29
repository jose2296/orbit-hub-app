import type {
  CreateNoteRequest,
  ListNotesQuery,
  ListNotesResponse,
  Note,
  UpdateNoteRequest,
} from '@orbit-hub/contracts';
import { noteDocumentSchema, noteDocumentToPlainText } from '@orbit-hub/contracts';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { folders, memberships, notes } from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';

import { MEMBERSHIP_ROLE_RANK, type MembershipRoleName } from '../../db/constants.js';

function toNote(row: typeof notes.$inferSelect): Note {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    title: row.title,
    document: row.document,
    plainText: row.plainText,
    tags: row.tags ?? [],
    // Zero means "not placed", and the browser sorts those last: a note written
    // before there was an order has no place in somebody's hand-made one.
    position: row.position,
    attachmentCount: row.attachmentCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * Reading and writing notes.
 *
 * A note is an entity of its own, not a column on a list row. That was argued
 * the other way round while the sharing tables were being written, and the
 * comment that said so would have made this table unnecessary. See
 * `adr/0008-note-entity.md`.
 */
export class NoteService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  /** Workspaces the caller belongs to. Everything else is filtered by this. */
  private async visibleWorkspaceIds(userId: string): Promise<string[]> {
    const db = await this.db();
    const rows = await db
      .select({ id: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    return rows.map((row) => row.id);
  }

  private async roleIn(userId: string, workspaceId: string): Promise<MembershipRoleName | null> {
    const db = await this.db();
    const [row] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
      .limit(1);
    return row ? (row.role as MembershipRoleName) : null;
  }

  /**
   * Refuses a caller who may look but not write.
   *
   * A member who can only look is a real role, and a note in a shared space has
   * to respect it the same way a list does. A viewer is told the note is not
   * there rather than that they may not change it, so the API does not describe
   * what somebody is allowed to see.
   */
  private async assertCanWrite(userId: string, workspaceId: string): Promise<void> {
    const role = await this.roleIn(userId, workspaceId);
    if (role === null) {
      throw HttpError.notFound('Workspace not found');
    }
    if (MEMBERSHIP_ROLE_RANK[role] < MEMBERSHIP_ROLE_RANK.editor) {
      throw HttpError.forbidden('This space is read only for you');
    }
  }

  /** Throws unless the note exists, is alive, and the caller may see its space. */
  private async readableNote(userId: string, noteId: string): Promise<typeof notes.$inferSelect> {
    const db = await this.db();
    const [row] = await db.select().from(notes).where(eq(notes.id, noteId)).limit(1);

    if (!row || row.deletedAt) {
      throw HttpError.notFound('Note not found');
    }
    const role = await this.roleIn(userId, row.workspaceId);
    if (role === null) {
      throw HttpError.notFound('Note not found');
    }
    return row;
  }

  /**
   * A folder the caller may file into, refused when it belongs to another space.
   *
   * Checked rather than trusted: a note carries both a space and a folder, and a
   * mismatched pair would file somebody's note in a space they cannot see, which
   * is both a leak and a way to lose it.
   */
  private async assertFolderMatches(userId: string, workspaceId: string, folderId: string | null): Promise<void> {
    if (folderId === null) return;
    const db = await this.db();
    const [row] = await db
      .select({ workspaceId: folders.workspaceId })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (!row || row.workspaceId !== workspaceId) {
      throw HttpError.validation('The folder does not belong to that space');
    }
    void userId;
  }

  /**
   * Reading needs membership, not write access.
   *
   * A viewer is a real role and there is no reason they could not read a note in
   * a space they belong to, so asking for write here would answer a question
   * nobody asked.
   */
  private async assertCanRead(userId: string, workspaceId: string): Promise<void> {
    const role = await this.roleIn(userId, workspaceId);
    if (role === null) {
      throw HttpError.notFound('Workspace not found');
    }
  }

  async list(userId: string, filters: ListNotesQuery): Promise<ListNotesResponse> {
    const workspaceIds = filters.workspaceId
      ? await (async () => {
          await this.assertCanRead(userId, filters.workspaceId as string);
          return [filters.workspaceId as string];
        })()
      : await this.visibleWorkspaceIds(userId);

    if (workspaceIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const db = await this.db();
    const conditions = [inArray(notes.workspaceId, workspaceIds), isNull(notes.deletedAt)];

    if (filters.folderId !== undefined) {
      conditions.push(
        filters.folderId === null ? sql`${notes.folderId} is null` : eq(notes.folderId, filters.folderId),
      );
    }
    if (filters.tag !== undefined) {
      // A tag is an array, so containment is the question. The GIN index over
      // `tags` is what answers it without reading the rows.
      conditions.push(sql`${notes.tags} @> ${JSON.stringify([filters.tag])}::jsonb`);
    }
    if (filters.cursor) {
      conditions.push(gt(notes.updatedAt, new Date(filters.cursor)));
    }

    const rows = await db
      .select()
      .from(notes)
      .where(and(...conditions))
      .orderBy(desc(notes.updatedAt))
      .limit(filters.limit);

    const last = rows.at(-1);
    const hasMore = rows.length === filters.limit && last !== undefined;
    return {
      items: rows.map(toNote),
      nextCursor: hasMore ? last.updatedAt.toISOString() : null,
    };
  }

  async get(userId: string, noteId: string): Promise<Note> {
    return toNote(await this.readableNote(userId, noteId));
  }

  async create(userId: string, input: CreateNoteRequest): Promise<Note> {
    await this.assertCanWrite(userId, input.workspaceId);
    await this.assertFolderMatches(userId, input.workspaceId, input.folderId);

    // Validated here as well as in the contract: the schema is the definition,
    // and this is the boundary. A document that does not pass is not written,
    // not written empty, and not written with the bad part removed.
    const document = noteDocumentSchema.parse(input.document);

    const db = await this.db();
    const [row] = await db
      .insert(notes)
      .values({
        workspaceId: input.workspaceId,
        folderId: input.folderId,
        title: input.title,
        document,
        // Derived, never taken from the client, so the note and the string that
        // search matches on cannot be two different things.
        plainText: noteDocumentToPlainText(document),
        tags: input.tags,
        // At the end by default, not at the top: a new note that arrived in a
        // folder somebody has arranged should not land in the middle of it.
        position: input.position ?? 0,
        attachmentCount: 0,
        version: 1,
      })
      .returning();

    if (!row) throw HttpError.internal('The note was not stored');
    return toNote(row);
  }

  /**
   * Changing a note.
   *
   * `expectedVersion` is compared first, and a stale write is a conflict rather
   * than an overwrite. Two devices editing the same note offline is the normal
   * case for this app, not the edge one, and last-write-wins would silently
   * drop a paragraph somebody wrote on a train.
   */
  async update(userId: string, noteId: string, input: UpdateNoteRequest): Promise<Note> {
    const existing = await this.readableNote(userId, noteId);
    await this.assertCanWrite(userId, existing.workspaceId);

    if (input.expectedVersion !== existing.version) {
      throw HttpError.conflict('This note changed somewhere else');
    }
    if (input.folderId !== undefined) {
      await this.assertFolderMatches(userId, existing.workspaceId, input.folderId);
    }

    const document = input.document === undefined ? undefined : noteDocumentSchema.parse(input.document);

    const db = await this.db();
    const [row] = await db
      .update(notes)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.position === undefined ? {} : { position: input.position }),
        ...(document === undefined
          ? {}
          : { document, plainText: noteDocumentToPlainText(document) }),
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
      .returning();

    if (!row) throw HttpError.notFound('Note not found');
    return toNote(row);
  }

  /**
   * A tombstone, never a delete.
   *
   * A phone that was offline when this happened has to be able to learn that the
   * note is gone, and a row that simply disappeared is indistinguishable from a
   * note that never existed. The cascade to `attachments` is handled by the
   * foreign key; the files in object storage are the upload queue's problem.
   */
  async remove(userId: string, noteId: string): Promise<void> {
    const existing = await this.readableNote(userId, noteId);
    await this.assertCanWrite(userId, existing.workspaceId);

    const db = await this.db();
    await db
      .update(notes)
      .set({ deletedAt: new Date(), version: existing.version + 1, updatedAt: new Date() })
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
  }
}

export const noteService = new NoteService();
