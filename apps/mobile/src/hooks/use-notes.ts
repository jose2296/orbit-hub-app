import type { Note } from "@orbit-hub/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyNoteFilters,
  sortNotes,
  withNoteDefaults,
} from "@/lib/notes/note-record";
import type { NoteFilters } from "@/lib/notes/note-record";
import {
  createNoteAction,
  deleteNoteAction,
  saveNoteAction,
} from "@/lib/notes/actions";
import { getLocalStoreReady, subscribeToLocalStore } from "@/lib/offline";
import type { CachedEntity } from "@/lib/offline";

/**
 * Reading notes out of the cache.
 *
 * The screen reads from here and never from the API, which is what makes the app
 * work with no connectivity. The writing lives in `lib/notes/actions.ts` as plain
 * functions, so a screen that has one note open does not have to subscribe to all
 * of them to be able to save it.
 *
 * The difference against a list item is the body. A document is a string the size
 * of a page rather than a title, so it is written whole on every save instead of
 * being patched field by field. That is fine here, where the whole document is
 * one column and conflicts are decided per record. It would not be fine for a
 * document of a hundred pages, which is the open question in `notes-editor.md`.
 */

export function readNoteFromRow(row: CachedEntity): Note {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending
    ? (JSON.parse(row.pending) as Record<string, unknown>)
    : null;

  // The pending copy wins, so a note shows what was just written rather than the
  // last thing that reached the network.
  return withNoteDefaults({
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  });
}

export function useNotes(filters: NoteFilters = {}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // The filters as a key rather than as a dependency: this object is rebuilt on
  // every render, and depending on it would re-read the cache every time a screen
  // that owns it types in a search field.
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    const store = await getLocalStoreReady();
    const rows = await store.listCached("note");
    const read = rows.map(readNoteFromRow).filter((note) => note.deletedAt === null);
    setNotes(sortNotes(applyNoteFilters(read, JSON.parse(filterKey) as NoteFilters)));
    setIsLoading(false);
  }, [filterKey]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return useMemo(
    () => ({
      notes,
      isLoading,
      reload: load,
      createNote: createNoteAction,
      saveNote: saveNoteAction,
      deleteNote: deleteNoteAction,
    }),
    [notes, isLoading, load],
  );
}

/** One note, or null. Same rule: read from the cache, never from the network. */
export function useNote(noteId: string | null) {
  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!noteId) {
      setNote(null);
      setIsLoading(false);
      return;
    }
    const store = await getLocalStoreReady();
    const row = await store.getCached("note", noteId);
    // A tombstoned row reads as no note at all, which is what the person wanted
    // when they deleted it and what a device that missed the delete also needs.
    setNote(!row || row.deletedAt ? null : readNoteFromRow(row));
    setIsLoading(false);
  }, [noteId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return { note, isLoading, reload: load };
}
