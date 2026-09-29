import type { AttachmentDraft } from "./attachments";

/**
 * Files that are on the device and not yet on the server.
 *
 * The promise in `notes-editor.md` is that a note shows a badge until its upload
 * completes, and that promise has to survive the app being closed: a photo taken
 * in the mountains and uploaded from a hotel is the case this exists for, and a
 * queue that lives in memory forgets it at exactly the wrong moment.
 *
 * The drafts are kept in the key-value store rather than in the outbox, because a
 * file is not an operation — it is too big for a row, it goes straight to storage,
 * and a half-finished upload is not something a replay can finish. What is kept is
 * the description of the file, not the file: the bytes stay where they are, on the
 * device, and a local uri points at them.
 *
 * The store is a parameter and not a direct call, for the same reason `LocalStore`
 * is an interface. This file has rules worth testing — that the same file queued
 * twice is one file, that a corrupted store reads as empty — and a rule that can
 * only be reached by booting a database cannot be tested at all. Reaching for
 * `keyValueStore` at import time would drag `expo-sqlite` into every test that
 * wants to check a line of array logic.
 */

const KEY = "orbithub:pending-uploads";

/** The two operations this needs. Anything that can do them will do. */
export interface PendingUploadStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface PendingEntry {
  noteId: string;
  draft: AttachmentDraft;
  /** How many times it has been tried, so the app can stop saying "retrying". */
  attempts: number;
  lastError: string | null;
  queuedAt: string;
}

function readAll(store: PendingUploadStore): PendingEntry[] {
  const raw = store.get(KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as PendingEntry[]) : [];
  } catch {
    // A queue that cannot be read is a queue that is empty as far as the app is
    // concerned. Throwing here would take the note screen down with it, and a note
    // is readable whether or not its pictures are on the phone.
    return [];
  }
}

function writeAll(store: PendingUploadStore, entries: PendingEntry[]): void {
  store.set(KEY, JSON.stringify(entries));
}

export function pendingFor(noteId: string, store: PendingUploadStore): PendingEntry[] {
  return readAll(store).filter((entry) => entry.noteId === noteId);
}

/**
 * Adds a file to the queue.
 *
 * The identity is the `localId` and not the name: two different photos can be
 * called `foto.png`, and a person who picks the same picture twice should not end
 * up with it twice.
 */
export function queueUpload(
  noteId: string,
  draft: AttachmentDraft,
  store: PendingUploadStore,
): void {
  const entries = readAll(store).filter(
    (entry) => !(entry.noteId === noteId && entry.draft.localId === draft.localId),
  );
  entries.push({
    noteId,
    draft,
    attempts: 0,
    lastError: null,
    queuedAt: new Date().toISOString(),
  });
  writeAll(store, entries);
}

export function markAttempt(
  noteId: string,
  localId: string,
  error: string | null,
  store: PendingUploadStore,
): void {
  const entries = readAll(store).map((entry) =>
    entry.noteId === noteId && entry.draft.localId === localId
      ? {
          ...entry,
          attempts: entry.attempts + 1,
          // The last reason is kept so the note can say what went wrong rather than
          // showing a dot with nothing behind it.
          lastError: error,
        }
      : entry,
  );
  writeAll(store, entries);
}

export function dequeueUpload(
  noteId: string,
  localId: string,
  store: PendingUploadStore,
): void {
  writeAll(
    store,
    readAll(store).filter(
      (entry) => !(entry.noteId === noteId && entry.draft.localId === localId),
    ),
  );
}

/** The drafts of one note, in the order they were chosen. */
export function pendingDrafts(noteId: string, store: PendingUploadStore): AttachmentDraft[] {
  return pendingFor(noteId, store)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    .map((entry) => entry.draft);
}

export function pendingCount(noteId: string, store: PendingUploadStore): number {
  return pendingFor(noteId, store).length;
}

/**
 * Whether the bytes are still where the uri says they are.
 *
 * Derived rather than stored, because it is a fact about the runtime and a stored
 * copy of a fact like that goes stale: a draft written by one version of the app
 * and read by another has no such field, and guessing "yes" would offer a button
 * that uploads forty characters of a path.
 *
 * The two runtimes genuinely differ, and pretending otherwise would be the bug. On
 * a phone the file is a path in the sandbox and is still there after a restart. On
 * the web it is a `File` object owned by a document that no longer exists, and what
 * the queue has left of it is `{}` — so the person still sees that they chose a
 * picture, which is true, and is not offered a retry that cannot work, which is
 * also true.
 */
export function isStillReadable(draft: AttachmentDraft): boolean {
  return typeof draft.uri === 'string' && draft.uri.startsWith('file://');
}
