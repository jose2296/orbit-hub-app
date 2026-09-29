import type {
  NoteTemplate,
  ShareNoteTemplateRequest,
  UpdateNoteTemplateRequest,
} from "@orbit-hub/contracts";
import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

/**
 * Templates on the client.
 *
 * The built-in ones come from the API rather than being bundled, so twelve
 * recipes arrive in one request instead of twelve that have to be updated with
 * every build. A device that cannot reach the API gets an empty list and says so
 * rather than pretending there is nothing to offer: a picker that is empty and a
 * picker that failed look the same on a phone, and only one of them is true.
 *
 * Applying a template is a request, not a local copy, for the same reason: the
 * document is validated on the way in and a template that cannot be opened
 * produces a note that opens empty.
 */

export interface TemplateState {
  templates: NoteTemplate[];
  isLoading: boolean;
  /** True when the list could not be read, which is not the same as being empty. */
  failed: boolean;
  reload: () => Promise<void>;
}

export function useNoteTemplates(workspaceId?: string): TemplateState {
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const query = new URLSearchParams();
      if (workspaceId) query.set("workspaceId", workspaceId);
      const response = await api.get<{ items: NoteTemplate[] }>(
        `/notes/templates?${query.toString()}`,
      );
      setTemplates(response.items);
      setFailed(false);
    } catch {
      // Left empty on purpose, and `failed` set, so a screen can say "could not
      // load" rather than showing a picker with nothing in it.
      setTemplates([]);
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { templates, isLoading, failed, reload };
}

export interface ApplyResult {
  noteId: string;
  title: string;
}

/**
 * The name a note gets when it is made from a template.
 *
 * The person renames it the moment they open it, and the name that comes back from
 * a template is the only one there is until then — so the template's own name, and
 * not an empty one and not "Sin título".
 */
export function titleForTemplate(template: NoteTemplate): string {
  return template.name;
}

/**
 * Saves the note that is on screen as a template somebody can reuse.
 *
 * A **personal** template is sent with no space at all, whatever space the note
 * was written in. That is the difference between a template that is mine and one
 * the space is keeping for me: the first follows me into every space and is still
 * there after I leave; the second is offered to the team and disappears with the
 * membership. The server nulls it as well, so the rule is not a client's promise.
 */
export async function saveTemplateFromNote(input: {
  workspaceId: string;
  name: string;
  document: string;
  description?: string;
  scope?: "personal" | "workspace";
}): Promise<NoteTemplate> {
  const scope = input.scope ?? "workspace";
  return api.post<NoteTemplate>("/notes/templates", {
    workspaceId: scope === "personal" ? null : input.workspaceId,
    name: input.name,
    description: input.description ?? "",
    scope,
    document: input.document,
  });
}

/**
 * Gives a template to a space, or takes it back.
 *
 * Sharing into a space is the whole of "share it with other people" here: every
 * member can start a note from it, and the editors among them can change it.
 * Taking it back returns it to the author's own shelf, in every space.
 */
export async function shareNoteTemplate(
  templateId: string,
  input: ShareNoteTemplateRequest,
): Promise<NoteTemplate> {
  return api.post<NoteTemplate>(`/notes/templates/${templateId}/share`, input);
}
/** The line a template shows under its name. */
export function templateSubtitle(template: NoteTemplate): string {
  return noteDocumentToPlainText(template.document).replace(/\n/g, " · ");
}

/* ------------------------------------------------------ cambiar una plantilla ---- */

export interface OneTemplateState {
  template: NoteTemplate | null;
  isLoading: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

/**
 * One template, on its own.
 *
 * Its own request and not "the list, then find it in there", because opening a
 * template from a list means twelve recipes are already on screen and refetching
 * them to draw one is a network round trip that exists only because the screen
 * had nowhere to keep what it had been given.
 */
export function useNoteTemplate(templateId?: string): OneTemplateState {
  const [template, setTemplate] = useState<NoteTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (!templateId) {
      setTemplate(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setTemplate(await api.get<NoteTemplate>(`/notes/templates/${templateId}`));
      setFailed(false);
    } catch {
      setTemplate(null);
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { template, isLoading, failed, reload };
}

/**
 * Whether a template can be changed by this person, and it takes two things to
 * answer.
 *
 * **The catalogue that comes with the app is code.** An edit would be replaced by
 * the next build, silently, with no way to get it back.
 *
 * **And a published template is its author's.** Everybody may use one — that is
 * what publishing means — and nobody but the person who wrote it may change it.
 * One person's recipe offered to the world is still that person's recipe, and a
 * world where anyone can rewrite it is a world where the recipe is worth nothing.
 *
 * So: not the built-in ones, and your own whatever scope they are in. The server
 * draws the same line and is the one that has to, because a client that says "no"
 * is a courtesy.
 */
export function canEditTemplate(
  template: NoteTemplate | null,
  userId?: string | null,
): boolean {
  if (!template || template.builtInKey !== null) return false;
  if (userId) return template.createdBy === userId;
  // Without a session there is nobody to compare against, and the conservative
  // answer is the wrong one: it hides the toolbar on a template that is yours.
  // The server refuses anything that is not, so the worst case is an error line.
  return true;
}

/**
 * Changes a template and hands back what the server now thinks it is.
 *
 * The **returned** template and not the one that was sent, because the server
 * owns the version and the plain text: the row that comes back is the one the
 * next save has to be based on, and a screen that kept its own copy would send a
 * version that no longer exists and be told so by its own account.
 */
export async function updateNoteTemplate(
  templateId: string,
  changes: Omit<UpdateNoteTemplateRequest, "expectedVersion">,
  expectedVersion: number,
): Promise<NoteTemplate> {
  return api.patch<NoteTemplate>(`/notes/templates/${templateId}`, {
    ...changes,
    expectedVersion,
  });
}

/** Takes a template off the list for good. The notes it made are not touched. */
export async function removeNoteTemplate(templateId: string): Promise<void> {
  await api.delete(`/notes/templates/${templateId}`);
}

/**
 * Publishes a template to the catalogue, and takes it back.
 *
 * Publishing puts it in front of anybody with the app: no space, no invitation,
 * no knowing the author. Only the author can do it, and only the author can undo
 * it — the same person, because it is the same decision.
 */
export async function publishNoteTemplate(templateId: string): Promise<NoteTemplate> {
  return api.post<NoteTemplate>(`/notes/templates/${templateId}/publish`, {});
}

export async function unpublishNoteTemplate(templateId: string): Promise<NoteTemplate> {
  return api.delete<NoteTemplate>(`/notes/templates/${templateId}/publish`);
}
