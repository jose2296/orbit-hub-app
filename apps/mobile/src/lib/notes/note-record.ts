import type { Note } from "@orbit-hub/contracts";
import { noteDocumentToPlainText, notePreviewBelowTitle } from "@orbit-hub/contracts";

/**
 * Building and reading a note.
 *
 * Same shape as `item-record.ts` and for the same reason: a note is written by
 * hand into the cache and read back by parsing a payload, and a field that is in
 * the contract but missing in one of those two places is not a type error. It is
 * a note that opens as a blank page, and only for the people whose note it is.
 * So it is built in one place with every field, and read in one place where a
 * missing field gets the value the contract gives it.
 */

export interface NewNoteInput {
  id: string;
  workspaceId: string;
  folderId?: string | null;
  title: string;
  document?: string;
  tags?: string[];
  /** Where it sits in its folder's hand-made order. Absent means the end. */
  position?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** A brand new note: empty body, version 0, not yet on the server. */
export function newNote(input: NewNoteInput): Note {
  const now = input.updatedAt ?? new Date().toISOString();
  return {
    id: input.id,
    version: 0,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    workspaceId: input.workspaceId,
    folderId: input.folderId ?? null,
    title: input.title,
    document: input.document ?? "",
    // Derived from the document and not carried separately, because a note and
    // the text that search matches on cannot be allowed to disagree. The server
    // derives it again on write, so this is the local copy of the same rule.
    plainText: "",
    position: input.position ?? 0,
    // A fresh array, not a shared constant: one note's labels must not appear on
    // every other note the moment somebody types one.
    tags: input.tags ? [...input.tags] : [],
    attachmentCount: 0,
    deletedAt: null,
  };
}

/**
 * A note read from the cache or from the server, with what is missing filled in.
 *
 * The cache outlives the build that wrote it. A note written by an older version
 * of the app, or a payload from a client that sends only what it knows, is
 * missing whatever the contract has grown since. It is read with the defaults
 * rather than trusted, because the alternative is a note that breaks the first
 * time somebody opens the app after an update.
 */
export function withNoteDefaults(value: unknown): Note {
  const record = (value ?? {}) as Record<string, unknown>;

  const document = typeof record.document === "string" ? record.document : "";

  return {
    id: typeof record.id === "string" ? record.id : "",
    version: typeof record.version === "number" ? record.version : 0,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : "",
    folderId: typeof record.folderId === "string" ? record.folderId : null,
    title: typeof record.title === "string" ? record.title : "",
    document,
    // A cached note whose text is missing is a note that cannot be found by
    // searching for it, and the document is right there, so it is derived rather
    // than left empty.
    plainText:
      typeof record.plainText === "string"
        ? record.plainText
        : noteDocumentToPlainText(document),
    // An array and not just present: a payload carrying a string where the
    // contract says a list is a note that cannot be filtered or counted.
    tags: Array.isArray(record.tags) ? (record.tags as string[]) : [],
    attachmentCount:
      typeof record.attachmentCount === "number" ? record.attachmentCount : 0,
    // Cero y no "sin valor": una nota guardada antes de que existiera el orden
    // tiene que poder leerse igual, y el navegador pone las que valen cero al
    // final para que no salten a la cabeza de un sitio ya colocado.
    position: typeof record.position === "number" ? Math.max(0, record.position) : 0,
    deletedAt: typeof record.deletedAt === "string" ? record.deletedAt : null,
  };
}

/**
 * The line a note shows on a card.
 *
 * A thin name for the shared one, so a screen reads `notePreview(note)` and does
 * not have to know that the title is cut off the front. The rule itself lives in
 * the contract, because the API has to answer the same thing for a search hit
 * and two implementations of it would drift.
 */
export function notePreview(note: Note): string {
  return notePreviewBelowTitle(note.document, note.title);
}

export interface NoteFilters {
  workspaceId?: string;
  folderId?: string | null;
  tag?: string;
}

/**
 * Which notes a screen is asking for.
 *
 * Exported and pure because "no opinion about the folder" and "in no folder" are
 * two different questions and only one of them is `undefined`. Getting that
 * backwards hides every loose note in a space, and nothing says so, because a
 * screen with no notes in it looks exactly like a screen with nothing to show.
 */
export function applyNoteFilters(notes: Note[], filters: NoteFilters): Note[] {
  return notes.filter((note) => {
    if (filters.workspaceId !== undefined && note.workspaceId !== filters.workspaceId) {
      return false;
    }
    if (filters.folderId !== undefined && note.folderId !== filters.folderId) {
      return false;
    }
    if (filters.tag !== undefined && !note.tags.includes(filters.tag)) {
      return false;
    }
    return true;
  });
}

/** Notes for a list, most recently touched first. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
  );
}
