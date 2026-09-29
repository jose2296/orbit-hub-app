import type { NoteTemplate } from "@orbit-hub/contracts";
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

/** Saves the note that is on screen as a template somebody can reuse. */
export async function saveTemplateFromNote(input: {
  workspaceId: string;
  name: string;
  document: string;
  description?: string;
  scope?: "personal" | "workspace";
}): Promise<NoteTemplate> {
  return api.post<NoteTemplate>("/notes/templates", {
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description ?? "",
    scope: input.scope ?? "workspace",
    document: input.document,
  });
}
/** The line a template shows under its name. */
export function templateSubtitle(template: NoteTemplate): string {
  return noteDocumentToPlainText(template.document).replace(/\n/g, " · ");
}
