import type {
  CreateNoteTemplateRequest,
  ListNoteTemplatesQuery,
  ListNoteTemplatesResponse,
  Note,
  NoteTemplate,
  ShareNoteTemplateRequest,
  UpdateNoteTemplateRequest,
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
    /*
     * Three shelves, in this order, and the order is the feature.
     *
     * Twelve recipes in alphabetical order put "Book, film or series" above the
     * thing the person wrote five minutes ago, and the list they came for ends up
     * at the bottom of a screen nobody scrolls to. The catalogue is alphabetical
     * because it is a reference you look things up in; the shelf on top is not,
     * because it is theirs.
     */
    const mine: NoteTemplate[] = [];
    const catalogue: NoteTemplate[] = [];
    const theirs: NoteTemplate[] = [];

    if (filters.includeBuiltIn !== false) {
      const now = new Date().toISOString();
      for (const template of BUILT_IN_TEMPLATES) {
        // Validated here too, not only where they are written. These documents
        // go into a note a person will open, and a built-in that is not in the
        // format would produce a note the editor cannot render.
        const document = noteDocumentSchema.parse(template.document);
        catalogue.push({
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
    if (filters.scope) {
      conditions.push(eq(noteTemplates.scope, filters.scope));
    } else if (filters.workspaceId) {
      /*
       * A space offers two shelves and not one.
       *
       * The space's own — anything filed in it — and the caller's personal ones,
       * which are stored with no space and therefore never match `workspace_id`.
       * Not the personal templates of the other people in it: a private shape for
       * your notes is not something a team inherits by being in the same space,
       * and a picker full of other people's private shapes is a leak dressed as a
       * convenience.
       *
       * Nor the caller's templates that belong to *other* spaces. They were being
       * offered here through `created_by = you`, which made a space's picker
       * change when somebody created a template somewhere else entirely.
       *
       * Membership and not `assertCanWrite`, because listing is reading: a viewer
       * of a space reads its notes, and a template they may not read is a picker
       * that is empty for the people who are only looking. Asking about a space
       * you are not in is still a 404 rather than an empty list, because an empty
       * list is what a space with no templates looks like and the two should not
       * be the same answer.
       */
      if ((await this.roleIn(userId, filters.workspaceId)) === null) {
        throw HttpError.notFound('Workspace not found');
      }
      conditions.push(
        or(
          and(
            eq(noteTemplates.workspaceId, filters.workspaceId),
            inArray(noteTemplates.scope, ['workspace', 'public']),
          ),
          and(
            eq(noteTemplates.scope, 'personal'),
            eq(noteTemplates.createdBy, userId),
          ),
        )!,
      );
    } else {
      /*
       * No space asked for: the catalogue, and what is the caller's own and
       * travels with them.
       *
       * This is the request the templates screen makes when it is opened from
       * outside a space — from the notes list, or the header — which is where a
       * personal template has to be reachable, because a template that only exists
       * inside a space is not a template the person owns, it is one the space is
       * holding for them. And it is where the published ones have to be reachable,
       * because published means "everybody's" and a catalogue that needs a space
       * to be seen is not one.
       *
       * It was answering with every row in the table instead: somebody in three
       * spaces was offered a fourth space's templates, and the personal shape of
       * somebody they had never met came with it. So the two shelves are named
       * rather than left to whatever the table happens to contain.
       */
      conditions.push(
        or(
          eq(noteTemplates.scope, 'public'),
          and(eq(noteTemplates.scope, 'personal'), eq(noteTemplates.createdBy, userId))!,
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
      // because it belongs to them, and answering with it would make the whole of
      // personal scope mean nothing.
      if (row.scope === 'personal' && row.createdBy !== userId) continue;
      (row.createdBy === userId ? mine : theirs).push(toTemplate(row));
    }

    return { items: [...mine, ...catalogue, ...theirs] };
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
        /*
         * A personal template is stored with no space, whatever the caller sent.
         *
         * The space is what makes a template somebody else's; keeping it on a
         * personal one would make a private shape something the space holds, and
         * the day the person left, a template they had written would go with them.
         * This is also what makes "mis plantillas" mean the same thing in every
         * space and on every device, which is the whole of what the scope says.
         */
        workspaceId: input.scope === 'personal' ? null : input.workspaceId,
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
        tags: [],
        // Al final del orden de su carpeta, igual que una nota escrita a mano: una
        // plantilla no tiene por que saltar a la cabeza de un sitio que alguien ya
        // ha colocado.
        position: 0,
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
      tags: row.tags ?? [],
      position: row.position,
      attachmentCount: row.attachmentCount,
      // Yours and editable, and it is not a guess: `assertCanWrite` a few lines
      // above refused to get here unless you can write in that space, so this note
      // was born in a space of yours. It also came from a template somebody lent
      // you, which is a fact about the template and not about the note — the
      // document is copied, so nothing about it is shared.
      role: 'editor',
      shared: false,
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

  /**
   * One template, whole.
   *
   * Not folded into `list`: opening a template is a thing a person does from a
   * list they are already looking at, and refetching twelve recipes to draw one
   * of them is a request that exists only because the screen was written without
   * a place to keep what it had.
   *
   * The same visibility as the list, which is the point: reading a personal
   * template of somebody else answers "not found" rather than 403, because they
   * are not offered it either and two answers for one situation is one too many.
   */
  async read(userId: string, templateId: string): Promise<NoteTemplate> {
    if (templateId.startsWith('builtin:')) {
      const key = templateId.slice('builtin:'.length);
      const built = BUILT_IN_TEMPLATES.find((t) => t.key === key);
      if (!built) throw HttpError.notFound('Template not found');
      const document = noteDocumentSchema.parse(built.document);
      const now = new Date().toISOString();
      return {
        id: templateId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        workspaceId: null,
        name: built.name,
        description: built.description,
        icon: built.icon,
        scope: 'public',
        document,
        plainText: noteDocumentToPlainText(document),
        builtInKey: built.key,
        createdBy: null,
      };
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
    // Reading is not writing: a viewer of the space can read the team's templates
    // without being able to change one.
    if (row.scope === 'workspace' && row.workspaceId) {
      const role = await this.roleIn(userId, row.workspaceId);
      if (role === null) throw HttpError.notFound('Template not found');
    }
    return toTemplate(row);
  }

  /**
   * The row behind a template, and whether the caller may change it.
   *
   * Two rules, and they are not the same rule:
   *
   * - A **personal** template is its author's. Somebody else cannot see it, so
   *   somebody else cannot change it, and asking is answered with "not found"
   *   rather than "not yours" — telling a stranger that an id exists is a small
   *   thing to leak and there is no reason to leak it.
   * - A **workspace** template belongs to the space, so anybody who can write in
   *   the space can fix it. A team template only its author may repair is a
   *   template the team cannot maintain.
   */
  private async editable(
    userId: string,
    templateId: string,
  ): Promise<typeof noteTemplates.$inferSelect> {
    if (templateId.startsWith('builtin:')) {
      // The catalogue is the code. It arrives with the build and is replaced by
      // the build after it, so a person who edited one would watch their edit
      // disappear on the next update with no warning and no way to get it back.
      // Saying so plainly beats a save that succeeds and then loses.
      throw HttpError.forbidden('This template comes with the app and cannot be changed');
    }

    const db = await this.db();
    const [row] = await db
      .select()
      .from(noteTemplates)
      .where(eq(noteTemplates.id, templateId))
      .limit(1);

    if (!row || row.deletedAt) throw HttpError.notFound('Template not found');
    if (row.scope === 'personal') {
      if (row.createdBy !== userId) throw HttpError.notFound('Template not found');
      return row;
    }
    /*
     * A public template is nobody's but its author's, and that is the whole
     * bargain of publishing: everybody may use it, and one person's recipe is
     * not another person's to rewrite.
     *
     * It has no space, so the check that follows — "can this person write in the
     * space it belongs to" — had nothing to test and every signed-in person
     * passed. A public template was editable and deletable by anyone who found
     * its id.
     */
    if (row.scope === 'public') {
      if (row.createdBy !== userId) {
        throw HttpError.forbidden('This template belongs to somebody else');
      }
      return row;
    }
    if (row.workspaceId) await this.assertCanWrite(userId, row.workspaceId);
    return row;
  }

  /**
   * Publishing a template, and taking it back.
   *
   * To the catalogue, and the catalogue is everybody: anybody with the app can
   * find it and start a note from it, without being in a space or knowing the
   * person who wrote it. Which is why the author is the only one who can publish
   * it, and the only one who can take it back.
   *
   * Publishing is not sharing. Sharing puts a template in a space, where the
   * team can fix its words. Publishing puts it in front of strangers, where they
   * can use it and nothing else — so the two are separate words, separate routes
   * and separate rows in the menu, because "let my team see this" and "let the
   * world see this" are not the same decision at different sizes.
   */
  async publish(userId: string, templateId: string): Promise<NoteTemplate> {
    return this.setScope(userId, templateId, 'public');
  }

  /**
   * Back to the author's own shelf.
   *
   * Nobody else's copy changes: a published template is a copy a person can use,
   * and a note made from it is another copy still. A note somebody wrote last
   * year does not become a broken link because its shape went private again.
   */
  async unpublish(userId: string, templateId: string): Promise<NoteTemplate> {
    return this.setScope(userId, templateId, 'personal');
  }

  private async setScope(
    userId: string,
    templateId: string,
    scope: 'public' | 'personal',
  ): Promise<NoteTemplate> {
    const existing = await this.editable(userId, templateId);

    // `editable` already answers "no" for somebody else's public template, and
    // this is the second, louder answer for the case that matters: sharing is a
    // decision about other people's screens, and that is the author's alone.
    if (existing.createdBy !== userId) {
      throw HttpError.forbidden('Only the author can publish this template');
    }

    const db = await this.db();
    const [row] = await db
      .update(noteTemplates)
      .set({
        scope,
        // A published template is in no space, and neither is a private one. It
        // was filed in a space on the way out and the space would have claimed it
        // back the moment it was unshared, which is the opposite of taking it
        // out of everybody's hands.
        workspaceId: null,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(noteTemplates.id, templateId), isNull(noteTemplates.deletedAt)))
      .returning();

    if (!row) throw HttpError.notFound('Template not found');
    return toTemplate(row);
  }

  /**
   * Changing a template.
   *
   * Same optimistic concurrency as a note, for the same reason: two devices
   * editing the same template offline is the ordinary case and not the edge one,
   * and last-write-wins would quietly drop a paragraph somebody wrote.
   */
  async update(
    userId: string,
    templateId: string,
    input: UpdateNoteTemplateRequest,
  ): Promise<NoteTemplate> {
    const existing = await this.editable(userId, templateId);

    if (input.expectedVersion !== existing.version) {
      throw HttpError.conflict('This template changed somewhere else');
    }

    const document =
      input.document === undefined ? undefined : noteDocumentSchema.parse(input.document);

    const db = await this.db();
    const [row] = await db
      .update(noteTemplates)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(document === undefined
          ? {}
          : { document, plainText: noteDocumentToPlainText(document) }),
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(noteTemplates.id, templateId), isNull(noteTemplates.deletedAt)))
      .returning();

    if (!row) throw HttpError.notFound('Template not found');
    return toTemplate(row);
  }

  /**
   * Sharing a template, or taking it back.
   *
   * The author and only the author, because sharing is a decision about other
   * people's screens. An editor of the space can repair the words in a team's
   * template — that is maintenance, and it is why they are allowed — but moving
   * that template into their own space is a different act, and one that would
   * quietly take it away from the team it was shared with.
   *
   * Sharing into a space is the whole of "compartir con otra gente": everybody
   * there can start a note with it, and the editors among them can change it.
   * Taking it back returns it to the author's own shelf, in every space.
   */
  async share(
    userId: string,
    templateId: string,
    input: ShareNoteTemplateRequest,
  ): Promise<NoteTemplate> {
    const existing = await this.editable(userId, templateId);

    if (existing.createdBy !== userId) {
      // The same rule as a personal template somebody else asked for: not yours,
      // and the fact that it exists is not yours to pass on either.
      throw HttpError.forbidden('Only the author can share this template');
    }

    if (input.scope === 'workspace' && input.workspaceId) {
      await this.assertCanWrite(userId, input.workspaceId);
    }

    const db = await this.db();
    const [row] = await db
      .update(noteTemplates)
      .set({
        scope: input.scope,
        workspaceId: input.scope === 'workspace' ? (input.workspaceId ?? null) : null,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(noteTemplates.id, templateId), isNull(noteTemplates.deletedAt)))
      .returning();

    if (!row) throw HttpError.notFound('Template not found');
    return toTemplate(row);
  }

  /**
   * A tombstone, never a delete.
   *
   * For the same reason as a note: a phone that was offline has to be able to
   * learn that the template is gone, and a row that vanished is a template that
   * never existed. The notes it produced are untouched — they are copies, and a
   * copy that changed when the original was deleted would not be a copy.
   */
  async remove(userId: string, templateId: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.editable(userId, templateId);

    const db = await this.db();
    await db
      .update(noteTemplates)
      .set({ deletedAt: new Date(), version: existing.version + 1, updatedAt: new Date() })
      .where(and(eq(noteTemplates.id, templateId), isNull(noteTemplates.deletedAt)));

    return { id: templateId, deleted: true };
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
