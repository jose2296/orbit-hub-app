import type { Note } from "@orbit-hub/contracts";

import { getLocalStoreReady, readRecord } from "@/lib/offline";

/** How many lines of the note a widget keeps: the launcher cuts what does not fit anyway. */
const MAX_LINES = 14;

export interface PinnedNoteData {
  id: string;
  title: string;
  lines: string[];
  uri: string;
}

/** The notes of one place (a space's root, or a folder), for the picker. */
export async function listNotesIn(
  workspaceId: string,
  folderId: string | null,
): Promise<Array<{ id: string; title: string }>> {
  const store = await getLocalStoreReady();
  return (await store.listCached("note"))
    .map((row) => readRecord<Note>(row))
    .filter(
      (note) =>
        note.deletedAt == null &&
        note.workspaceId === workspaceId &&
        (note.folderId ?? null) === folderId,
    )
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(({ id, title }) => ({ id, title }));
}

/** The note as the widget draws it, from the local copy; `null` if it is gone. */
export async function loadPinnedNote(
  noteId: string,
): Promise<PinnedNoteData | null> {
  const store = await getLocalStoreReady();
  const cached = await store.getCached("note", noteId);
  if (!cached || cached.deletedAt) return null;
  const note = readRecord<Note>(cached);
  const pending = cached.pending
    ? (JSON.parse(cached.pending) as { plainText?: string })
    : {};
  const text = pending.plainText ?? note.plainText ?? "";
  return {
    id: note.id,
    title: note.title,
    lines: text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, MAX_LINES),
    uri: `orbithub://note/${note.id}`,
  };
}
