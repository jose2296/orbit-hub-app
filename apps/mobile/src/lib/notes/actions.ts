import * as Crypto from "expo-crypto";

import { noteDocumentToPlainText } from "@orbit-hub/contracts";

import { newNote } from "./note-record";
import { enqueueOperation, getLocalStoreReady, localUpdate } from "@/lib/offline";

/**
 * Writing a note.
 *
 * Plain functions and not hook actions, because two different places need them
 * and one of them is a screen that has a single note: making it call `useNotes`
 * just to reach `saveNote` would subscribe the editor to every note in the app
 * and re-read the cache on every keystroke it flushes.
 *
 * Every one of these writes locally first and enqueues second. None of them
 * waits for the network, and none of them can fail because of it.
 */

export interface NewNoteInput {
  workspaceId: string;
  folderId?: string | null;
  title: string;
  document?: string;
  tags?: string[];
}

/** Creates a note locally and queues it. Returns the id it will have. */
export async function createNoteAction(input: NewNoteInput): Promise<string> {
  const id = Crypto.randomUUID();
  const note = newNote({ id, ...input });

  await localUpdate("note", id, { ...note });
  await enqueueOperation({
    kind: "create",
    entity: "note",
    entityId: id,
    baseVersion: 0,
    // The space travels in the payload because a note cannot be placed without
    // one. It is not in `base`: the server owns that field, and a client that
    // could move a note between spaces through a sync payload could file it
    // where the owner never put it.
    payload: {
      workspaceId: note.workspaceId,
      title: note.title,
      document: note.document,
      folderId: note.folderId,
      tags: note.tags,
    },
  });
  return id;
}

export interface NoteChanges {
  title?: string;
  document?: string;
  folderId?: string | null;
  tags?: string[];
}

/**
 * Saves a note.
 *
 * `base` carries what the note looked like before this edit, which is what lets
 * the server merge two devices that changed different fields instead of asking
 * somebody to choose between two whole documents. Without it a stale save is a
 * conflict, which is safe but annoying, and this is the case the merge is for.
 */
export async function saveNoteAction(noteId: string, changes: NoteChanges): Promise<void> {
  const store = await getLocalStoreReady();
  const cached = await store.getCached("note", noteId);
  const base = cached ? (JSON.parse(cached.payload) as Record<string, unknown>) : null;

  const values: Record<string, unknown> = { ...changes };
  if (changes.document !== undefined) {
    // Derived on the way in for the same reason the server derives it: the note
    // and the string that search matches on are not allowed to disagree, and this
    // local copy is what offline search reads.
    values["plainText"] = noteDocumentToPlainText(changes.document);
  }

  await localUpdate("note", noteId, values);
  await enqueueOperation({
    kind: "update",
    entity: "note",
    entityId: noteId,
    baseVersion: cached?.version ?? 0,
    payload: values,
    base,
  });
}

/**
 * A tombstone, locally too.
 *
 * The cache row is marked rather than removed, so the note leaves the list and a
 * device that had it can still be told it is gone when it comes back. Removing
 * the row would make an unsynced delete indistinguishable from a note that never
 * existed.
 */
export async function deleteNoteAction(noteId: string): Promise<void> {
  const store = await getLocalStoreReady();
  const cached = await store.getCached("note", noteId);
  const baseVersion = cached?.version ?? 0;
  const now = new Date().toISOString();

  await store.upsertCached([
    {
      entity: "note",
      entityId: noteId,
      version: baseVersion,
      updatedAt: now,
      deletedAt: now,
      payload: cached?.payload ?? JSON.stringify({ id: noteId }),
      pending: null,
    },
  ]);
  await enqueueOperation({
    kind: "delete",
    entity: "note",
    entityId: noteId,
    baseVersion,
  });
}
