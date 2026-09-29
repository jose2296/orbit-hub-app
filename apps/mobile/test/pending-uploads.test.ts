import { beforeEach, describe, expect, it } from 'vitest';

import {
  dequeueUpload,
  isStillReadable,
  markAttempt,
  pendingCount,
  pendingDrafts,
  pendingFor,
  queueUpload,
} from '../src/lib/notes/pending-uploads';
import type { AttachmentDraft } from '../src/lib/notes/attachments';

/**
 * The queue of files that are on the device and not on the server.
 *
 * The promise in `notes-editor.md` is that a note carries a badge until its upload
 * completes, and that has to survive the app being closed. A photo taken in the
 * mountains and uploaded from a hotel is the case, so anything held only in memory
 * forgets it at exactly the wrong moment.
 *
 * The identity of a queued file is its `localId`, not its name: a person who picks
 * the same picture twice should not end up with it twice.
 */
function draft(over: Partial<AttachmentDraft> = {}): AttachmentDraft {
  return {
    localId: 'a',
    fileName: 'salsa.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    uri: 'file:///tmp/salsa.png',
    width: 800,
    height: 600,
    ...over,
  };
}

/**
 * A store in a map, which is the whole point of the parameter: the rules in this
 * file are about the queue, not about where it is kept, and reaching them through
 * a real key-value store would mean booting a database to test three lines of
 * array manipulation.
 */
let backing = new Map<string, string>();
const store = {
  get: (key: string) => backing.get(key) ?? null,
  set: (key: string, value: string) => {
    backing.set(key, value);
  },
};

beforeEach(() => {
  backing = new Map();
});

describe('the pending upload queue', () => {
  it('starts empty', () => {
    expect(pendingCount('n1', store)).toBe(0);
    expect(pendingDrafts('n1', store)).toEqual([]);
  });

  it('keeps a file that has not been sent yet', () => {
    queueUpload('n1', draft(), store);

    expect(pendingCount('n1', store)).toBe(1);
    expect(pendingDrafts('n1', store)[0]?.fileName).toBe('salsa.png');
  });

  it('keeps the local uri, because the bytes do not move', () => {
    queueUpload('n1', draft({ uri: 'file:///fotos/2026/cena.png' }), store);
    expect(pendingDrafts('n1', store)[0]?.uri).toBe('file:///fotos/2026/cena.png');
  });

  it('survives being read again, which is the whole point', () => {
    queueUpload('n1', draft(), store);
    // A second read is what a relaunch does, and an in-memory queue would be empty.
    expect(pendingDrafts('n1', store)).toHaveLength(1);
    expect(pendingFor('n1', store)[0]?.queuedAt).toBeTruthy();
  });

  it('does not queue the same file twice', () => {
    queueUpload('n1', draft(), store);
    queueUpload('n1', draft(), store);

    expect(pendingCount('n1', store)).toBe(1);
  });

  it('treats a different file as a different file', () => {
    queueUpload('n1', draft({ localId: 'a' }), store);
    queueUpload('n1', draft({ localId: 'b', fileName: 'pan.png' }), store);

    expect(pendingCount('n1', store)).toBe(2);
  });

  it('keeps each note apart', () => {
    queueUpload('n1', draft({ localId: 'a' }), store);
    queueUpload('n2', draft({ localId: 'a' }), store);

    expect(pendingCount('n1', store)).toBe(1);
    expect(pendingCount('n2', store)).toBe(1);
    expect(pendingDrafts('n1', store)[0]?.fileName).toBe('salsa.png');
  });

  it('forgets a file once the server has it', () => {
    queueUpload('n1', draft(), store);
    dequeueUpload('n1', 'a', store);

    expect(pendingCount('n1', store)).toBe(0);
  });

  it('only forgets the file it was told about', () => {
    queueUpload('n1', draft({ localId: 'a' }), store);
    queueUpload('n1', draft({ localId: 'b' }), store);
    dequeueUpload('n1', 'a', store);

    expect(pendingDrafts('n1', store).map((d) => d.localId)).toEqual(['b']);
  });

  it('remembers how many times it has been tried and why it failed', () => {
    // A dot with nothing behind it is the thing this replaces: a person needs to
    // know whether to tap again or to give up on the picture.
    queueUpload('n1', draft(), store);
    markAttempt('n1', 'a', 'sin conexión', store);
    markAttempt('n1', 'a', 'sin conexión', store);

    const entry = pendingFor('n1', store)[0];
    expect(entry?.attempts).toBe(2);
    expect(entry?.lastError).toBe('sin conexión');
  });

  it('keeps the files in the order they were chosen', () => {
    queueUpload('n1', draft({ localId: 'a', fileName: 'primera.png' }), store);
    queueUpload('n1', draft({ localId: 'b', fileName: 'segunda.png' }), store);

    expect(pendingDrafts('n1', store).map((d) => d.fileName)).toEqual([
      'primera.png',
      'segunda.png',
    ]);
  });

  it('offers a retry only where the bytes are still there', () => {
    // A phone keeps the file as a path in the sandbox, and the path is still valid
    // after a restart. A browser keeps it as a `File` owned by a document that is
    // gone, so what the queue has is `{}` — the person still sees that they chose
    // a picture, and is not offered a retry that cannot work.
    expect(isStillReadable(draft({ uri: 'file:///fotos/cena.png' }))).toBe(true);
    expect(isStillReadable(draft({ uri: { name: 'cena.png' } as unknown as string }))).toBe(
      false,
    );
    expect(isStillReadable(draft({ uri: 'https://example.com/cena.png' }))).toBe(false);
    expect(isStillReadable(draft({ uri: '' }))).toBe(false);
  });

  it('reads as empty when what is stored is not readable', () => {
    // Corrupted storage must not take the note screen down: a note is readable
    // whether or not its pictures made it.
    store.set('orbithub:pending-uploads', '{esto no es json');
    expect(pendingCount('n1', store)).toBe(0);
  });

  it('reads as empty when what is stored is not a list', () => {
    store.set('orbithub:pending-uploads', '{"not":"a list"}');
    expect(pendingDrafts('n1', store)).toEqual([]);
  });
});
