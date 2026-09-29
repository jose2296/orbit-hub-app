import type {
  CreateNoteTemplateRequest,
  ListNoteTemplatesQuery,
  ListNoteTemplatesResponse,
  Note,
  NoteTemplate,
} from '@orbit-hub/contracts';
import { noteDocumentSchema, noteDocumentToPlainText } from '@orbit-hub/contracts';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { memberships, noteTemplates, notes } from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';

import { BUILT_IN_TEMPLATES } from './built-in-templates.js';
import { MEMBERSHIP_ROLE_RANK, type MembershipRoleName } from '../../db/constants.js';

function toTemplate(row: typeof noteTemplates.$inferSelect): NoteTemplate {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    scope: row.scope,
    document: row.document,
    plainText: row.plainText,
    builtInKey: row.builtInKey,
    createdBy: row.createdBy,
  };
}

/**
 * Templates, and making notes out of them.
 *
 * A template is a document you can copy, and the copy is the point: applying one
 * writes a new note, and the note afterwards has nothing to do with the template.
 * Editing it does not change the template, deleting the template does not touch
 * the notes it produced, and using somebody else's template never hands it over.
 */
export class NoteTemplateService {
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

  private async assertCanWrite(userId: string, workspaceId: string): Promise<void> {
    const role = await this.roleIn(userId, workspaceId);
    if (role === null) throw HttpError.notFound('Workspace not found');
    if (MEMBERSHIP_ROLE_RANK[role] < MEMBERSHIP_ROLE_RANK.editor) {
      throw HttpError.forbidden('This space is read only for you');
    }
  }

  /**
   * The catalogue, plus whatever the caller has.
   *
   * The built-in ones are read from the code rather than the table, so a device
   * that has never synced still offers twelve templates instead of none, and an
   * update arrives as a new build rather than as a row that may never be pulled.
   */
  async list(userId: string, filters: ListNoteTemplatesQuery): Promise<ListNoteTemplatesResponse> {
    const items: NoteTemplate[] = [];

    if (filters.includeBuiltIn !== false) {
      const now = new Date().toISOString();
      for (const template of BUILT_IN_TEMPLATES) {
        // Validated here too, not only where they are written. These documents
        // go into a note a person will open, and a built-in that is not in the
        // format would produce a note the editor cannot render.
        const document = noteDocumentSchema.parse(template.document);
        items.push({
          id: `builtin:${template.key}`,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          workspaceId: null,
          name: template.name,
          description: template.description,
          icon: template.icon,
          scope: 'public',
          document,
          plainText: noteDocumentToPlainText(document),
          builtInKey: template.key,
          createdBy: null,
        });
      }
    }

    const conditions = [isNull(noteTemplates.deletedAt)];
    if (filters.workspaceId) {
      await this.assertCanWrite(userId, filters.workspaceId);
      conditions.push(eq(noteTemplates.workspaceId, filters.workspaceId));
    }
    if (filters.scope) {
      conditions.push(eq(noteTemplates.scope, filters.scope));
    } else if (filters.workspaceId) {
      // A space shows its own templates and the public catalogue, plus the
      // caller's own personal ones. It does not show the personal templates of
      // the other people in it: a private shape for your notes is not something a
      // team inherits by being in the same space, and a picker full of other
      // people's private shapes is a leak dressed as a convenience.
      conditions.push(
        or(
          inArray(noteTemplates.scope, ['workspace', 'public']),
          eq(noteTemplates.createdBy, userId),
        )!,
      );
    }

    const db = await this.db();
    const rows = await db
      .select()
      .from(noteTemplates)
      .where(and(...conditions))
      .orderBy(asc(noteTemplates.name))
      .limit(filters.limit);

    for (const row of rows) {
      // Somebody else's personal template is not offered. It is in the table
      // because it belongs to them, and answering with it would be the whole
      // thing personal scope means nothing.
      if (row.scope === 'personal' && row.createdBy !== userId) continue;
      items.push(toTemplate(row));
    }

    return { items };
  }

  async create(userId: string, input: CreateNoteTemplateRequest): Promise<NoteTemplate> {
    if (input.workspaceId) {
      await this.assertCanWrite(userId, input.workspaceId);
    }
    if (input.scope === 'workspace' && !input.workspaceId) {
      throw HttpError.validation('A workspace template needs a workspace');
    }

    const document = noteDocumentSchema.parse(input.document);
    const db = await this.db();
    const [row] = await db
      .insert(noteTemplates)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description ?? '',
        icon: input.icon ?? 'document-text-outline',
        scope: input.scope,
        document,
        plainText: noteDocumentToPlainText(document),
        // Only the app's own catalogue carries a key. Letting a person set one
        // would let them collide with a built-in and the next update would
        // replace their template with a recipe.
        builtInKey: null,
        createdBy: userId,
        version: 1,
      })
      .returning();

    if (!row) throw HttpError.internal('The template was not stored');
    return toTemplate(row);
  }

  /**
   * A new note from a template.
   *
   * The document is copied rather than referenced. A note that pointed at a
   * template would change underneath the person reading it the moment somebody
   * else edited the template, which is not what anybody expects from a document
   * they wrote.
   */
  async applyToNote(
    userId: string,
    templateId: string,
    input: { workspaceId: string; folderId?: string | null; title?: string },
  ): Promise<Note> {
    const document = await this.documentOf(userId, templateId);
    await this.assertCanWrite(userId, input.workspaceId);

    const db = await this.db();
    const name = input.title?.trim() || (await this.nameOf(templateId));
    const [row] = await db
      .insert(notes)
      .values({
        workspaceId: input.workspaceId,
        folderId: input.folderId ?? null,
        title: name,
        document,
        plainText: noteDocumentToPlainText(document),
        favorite: false,
        tags: [],
        attachmentCount: 0,
        version: 1,
      })
      .returning();

    if (!row) throw HttpError.internal('The note was not stored');
    return {
      id: row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: null,
      workspaceId: row.workspaceId,
      folderId: row.folderId,
      title: row.title,
      document: row.document,
      plainText: row.plainText,
      favorite: row.favorite,
      tags: row.tags ?? [],
      attachmentCount: row.attachmentCount,
    };
  }

  private async documentOf(userId: string, templateId: string): Promise<string> {
    if (templateId.startsWith('builtin:')) {
      const key = templateId.slice('builtin:'.length);
      const built = BUILT_IN_TEMPLATES.find((t) => t.key === key);
      if (!built) throw HttpError.notFound('Template not found');
      return noteDocumentSchema.parse(built.document);
    }

    const db = await this.db();
    const [row] = await db
      .select()
      .from(noteTemplates)
      .where(eq(noteTemplates.id, templateId))
      .limit(1);

    if (!row || row.deletedAt) throw HttpError.notFound('Template not found');
    if (row.scope === 'personal' && row.createdBy !== userId) {
      throw HttpError.notFound('Template not found');
    }
    if (row.scope === 'workspace' && row.workspaceId) {
      await this.assertCanWrite(userId, row.workspaceId);
    }
    return row.document;
  }

  private async nameOf(templateId: string): Promise<string> {
    if (templateId.startsWith('builtin:')) {
      const key = templateId.slice('builtin:'.length);
      return BUILT_IN_TEMPLATES.find((t) => t.key === key)?.name ?? 'Note';
    }
    const db = await this.db();
    const [row] = await db
      .select({ name: noteTemplates.name })
      .from(noteTemplates)
      .where(eq(noteTemplates.id, templateId))
      .limit(1);
    return row?.name ?? 'Note';
  }
}

export const noteTemplateService = new NoteTemplateService();
