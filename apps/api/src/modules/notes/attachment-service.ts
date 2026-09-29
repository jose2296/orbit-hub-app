import type {
  Attachment,
  ConfirmAttachmentRequest,
  CreateAttachmentTicketRequest,
  CreateAttachmentTicketResponse,
  ListAttachmentsResponse,
} from '@orbit-hub/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';

import { env } from '../../config/env.js';
import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { attachments, memberships, notes } from '../../db/schema.js';
import { MEMBERSHIP_ROLE_RANK, type MembershipRoleName } from '../../db/constants.js';
import { HttpError } from '../../lib/http-error.js';

import { isInlineImageMime, isImageMime } from '@orbit-hub/contracts';

import { newStorageKey, storage } from './storage.js';

function toAttachment(row: typeof attachments.$inferSelect): Attachment {
  return {
    id: row.id,
    noteId: row.noteId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    /**
     * Blank on the way out. The key is the server's business, and a client that
     * holds it can guess the shape of every other one; links come from
     * `linkFor` and expire.
     */
    storageKey: '',
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Files on a note.
 *
 * Uploads are two steps and deliberately do not go through the outbox, because a
 * failed upload must never block a text edit: the note is saved and readable while
 * the file is still on the phone, and the note says so. The same reason keeps files
 * out of the sync entities — a device pulls a note with its files rather than as
 * operations of their own.
 */
export class AttachmentService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
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

  private async readableNote(userId: string, noteId: string) {
    const db = await this.db();
    const [row] = await db.select().from(notes).where(eq(notes.id, noteId)).limit(1);
    // A note that is not there and a note you may not see are the same answer, so
    // nothing in this file can be used to find out whether an id exists.
    if (!row || row.deletedAt) throw HttpError.notFound('Note not found');

    const role = await this.roleIn(userId, row.workspaceId);
    if (role === null) throw HttpError.notFound('Note not found');
    return row;
  }

  private async writableNote(userId: string, noteId: string) {
    const row = await this.readableNote(userId, noteId);
    const role = await this.roleIn(userId, row.workspaceId);
    if (role !== null && MEMBERSHIP_ROLE_RANK[role] < MEMBERSHIP_ROLE_RANK.editor) {
      throw HttpError.forbidden('This space is read only for you');
    }
    return row;
  }

  /** The ceiling for this kind of file. Decided here, and told to the client. */
  private maxBytesFor(mimeType: string): number {
    return isImageMime(mimeType) ? env.ATTACHMENT_IMAGE_MAX_BYTES : env.ATTACHMENT_MAX_BYTES;
  }

  async createTicket(
    userId: string,
    noteId: string,
    input: CreateAttachmentTicketRequest,
  ): Promise<CreateAttachmentTicketResponse> {
    await this.writableNote(userId, noteId);
    this.assertAccepted(input.mimeType, input.sizeBytes);

    // The key is the server's and it sits inside the note's own prefix. That is
    // what makes a key belonging to another note unusable here without a second
    // lookup: the prefix is checked on confirm.
    const key = newStorageKey(noteId, input.mimeType);
    const ticket = await storage().createUpload(key, input.mimeType);

    return {
      uploadUrl: ticket.url,
      headers: ticket.headers,
      storageKey: ticket.key,
      expiresAt: ticket.expiresAt,
    };
  }

  private assertAccepted(mimeType: string, sizeBytes: number): void {
    const limit = this.maxBytesFor(mimeType);
    if (sizeBytes > limit) {
      throw HttpError.validation(
        `That file is larger than this kind of file is allowed to be (${Math.round(limit / 1024 / 1024)} MB)`,
      );
    }
  }

  /**
   * The bytes arrived, so the file becomes part of the note.
   *
   * The key has to sit inside this note's prefix, which is the only thing tying an
   * upload to the note it was started for. The object is also checked to be there:
   * a client that confirms a key it was given but never wrote to would otherwise
   * leave a note with a broken image and a row insisting there is a file.
   */
  async confirm(
    userId: string,
    noteId: string,
    input: ConfirmAttachmentRequest,
  ): Promise<Attachment> {
    await this.writableNote(userId, noteId);
    this.assertAccepted(input.mimeType, input.sizeBytes);

    if (!input.storageKey.startsWith(`${noteId.slice(0, 2)}/${noteId}/`)) {
      throw HttpError.notFound('That upload was not started for this note');
    }

    let stored;
    try {
      stored = await storage().confirm(input.storageKey, input.sizeBytes);
    } catch {
      throw HttpError.validation('The file did not arrive');
    }

    // The bytes are checked, not just their existence. A truncated upload — a
    // connection dropped halfway, a client that reported success too early —
    // leaves a file there, and "the file exists" would accept it and put a broken
    // image in somebody's note with a row saying it is fine.
    if (stored.sizeBytes !== input.sizeBytes) {
      await storage().remove(input.storageKey);
      throw HttpError.validation('The file that arrived is not the size that was declared');
    }

    const db = await this.db();
    const [row] = await db
      .insert(attachments)
      .values({
        noteId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.key,
        width: input.width,
        height: input.height,
        createdAt: new Date(),
      })
      .returning();

    if (!row) throw HttpError.internal('The attachment was not stored');
    await this.recount(noteId);
    return toAttachment(row);
  }

  async list(userId: string, noteId: string): Promise<ListAttachmentsResponse> {
    await this.readableNote(userId, noteId);
    const db = await this.db();
    const rows = await db
      .select()
      .from(attachments)
      .where(eq(attachments.noteId, noteId))
      .orderBy(asc(attachments.createdAt));

    return { items: rows.map(toAttachment) };
  }

  /**
   * A short-lived link to read a file.
   *
   * Never a public URL and never the key: the key stays on the server and the
   * client gets something that expires. That is the whole reason access is decided
   * per note — a link that leaked would be a permanent hole in somebody's space.
   */
  async linkFor(
    userId: string,
    attachmentId: string,
  ): Promise<{ url: string; fileName: string; mimeType: string }> {
    const db = await this.db();
    const [row] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1);
    if (!row) throw HttpError.notFound('Attachment not found');

    await this.readableNote(userId, row.noteId);
    const url = await storage().createDownload(row.storageKey, row.fileName, row.mimeType);
    return { url, fileName: row.fileName, mimeType: row.mimeType };
  }

  async remove(userId: string, attachmentId: string): Promise<void> {
    const db = await this.db();
    const [row] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1);
    if (!row) throw HttpError.notFound('Attachment not found');
    await this.writableNote(userId, row.noteId);

    await storage().remove(row.storageKey);
    await db.delete(attachments).where(eq(attachments.id, attachmentId));
    await this.recount(row.noteId);
  }

  /**
   * The number the note shows.
   *
   * Counted rather than incremented: an increment that runs twice is off by one for
   * ever, and this number is only ever read, so a count costs one query and cannot
   * drift.
   */
  async recount(noteId: string): Promise<number> {
    const db = await this.db();
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(attachments)
      .where(eq(attachments.noteId, noteId));

    const total = row?.total ?? 0;
    await db
      .update(notes)
      .set({ attachmentCount: total, updatedAt: new Date() })
      .where(eq(notes.id, noteId));
    return total;
  }

  /** Drawn inside the document, or offered beside it. */
  isInline(mimeType: string): boolean {
    return isInlineImageMime(mimeType);
  }
}

export const attachmentService = new AttachmentService();
