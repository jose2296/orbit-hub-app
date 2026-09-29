import { describe, expect, it } from 'vitest';

import {
  applyNoteFilters,
  newNote,
  notePreview,
  sortNotes,
  withNoteDefaults,
} from '../src/lib/notes/note-record';
import type { Note } from '@orbit-hub/contracts';

/**
 * A note, written and read.
 *
 * The same bug as `item-record.test.ts`, and worse here: a note that fails to
 * read is a document somebody cannot open, and the loss is silent because there
 * is no crash, only an empty page.
 */

const FULL: Note = {
  id: 'n1',
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  workspaceId: 'w1',
  folderId: 'f1',
  title: 'Salsa',
  document: '<p>Seis tomates</p>',
  plainText: 'Seis tomates',
  favorite: true,
  tags: ['cocina'],
  attachmentCount: 2,
  deletedAt: null,
};

describe('newNote', () => {
  it('fills in every field the contract has', () => {
    const note = newNote({
      id: 'n1',
      workspaceId: 'w1',
      folderId: 'f1',
      title: 'Salsa',
      document: '<p>Seis tomates</p>',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(note).toEqual({
      id: 'n1',
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      workspaceId: 'w1',
      folderId: 'f1',
      title: 'Salsa',
      document: '<p>Seis tomates</p>',
      plainText: '',
      favorite: false,
      tags: [],
      attachmentCount: 0,
      deletedAt: null,
    });
  });

  it('starts empty rather than with a template the caller did not ask for', () => {
    const note = newNote({ id: 'n', workspaceId: 'w', title: 'Blanca' });
    expect(note.document).toBe('');
    expect(note.folderId).toBeNull();
  });

  it('copies the tags instead of sharing one array between notes', () => {
    // The bug: one array shared by every note, so a label typed on one note
    // appears on all of them and nobody notices until there are fifty.
    const tags = ['cocina'];
    const a = newNote({ id: 'a', workspaceId: 'w', title: 'A', tags });
    const b = newNote({ id: 'b', workspaceId: 'w', title: 'B', tags });
    tags.push('invierno');
    expect(a.tags).toEqual(['cocina']);
    expect(b.tags).toEqual(['cocina']);
  });
});

describe('withNoteDefaults', () => {
  it('reads a complete record unchanged', () => {
    expect(withNoteDefaults(FULL)).toEqual(FULL);
  });

  it('reads a record missing everything rather than returning undefined fields', () => {
    // A cache from a build that knew nothing about notes, or a hand-edited
    // payload. The note has to open.
    const note = withNoteDefaults({ id: 'n1' });
    expect(note.id).toBe('n1');
    expect(note.workspaceId).toBe('');
    expect(note.document).toBe('');
    expect(note.title).toBe('');
    expect(note.tags).toEqual([]);
    expect(note.favorite).toBe(false);
    expect(note.attachmentCount).toBe(0);
    expect(note.deletedAt).toBeNull();
    expect(note.version).toBe(0);
  });

  it('survives no payload at all', () => {
    expect(() => withNoteDefaults(null)).not.toThrow();
    expect(() => withNoteDefaults(undefined)).not.toThrow();
  });

  it('turns tags that are not a list into a list, so filtering still works', () => {
    // A payload carrying a string where the contract says an array is a note
    // that cannot be filtered, counted or searched by label.
    expect(withNoteDefaults({ ...FULL, tags: 'cocina' }).tags).toEqual([]);
    expect(withNoteDefaults({ ...FULL, tags: null }).tags).toEqual([]);
  });

  it('derives the text of a note whose search text is missing', () => {
    // The alternative is a note that cannot be found by searching for it while
    // the document that would answer is right there.
    const { plainText, ...withoutText } = FULL;
    void plainText;
    expect(withNoteDefaults(withoutText).plainText).toContain('Seis tomates');
  });

  it('keeps a note whose body is not the format, rather than dropping it', () => {
    // A note is validated on the way in. One from an older cache or a hand-edited
    // payload is not, and the answer is to read it, not to hide it.
    const broken = withNoteDefaults({ ...FULL, document: '<p>hola</p><script>x</script>' });
    expect(broken.document).toBe('<p>hola</p><script>x</script>');
  });
});

describe('notePreview', () => {
  it('is empty for a note with no body', () => {
    expect(notePreview({ ...FULL, document: '' })).toBe('');
  });

  it('does not repeat the title when the body starts with it', () => {
    // A note whose first block is its own heading would show the same two words
    // twice on a card, which looks like a bug to whoever reads it.
    const note = { ...FULL, document: '<h2>Salsa</h2><p>Seis tomates</p>' };
    expect(notePreview(note)).toBe('Seis tomates');
  });

  it('shows the body when the title is not in it', () => {
    expect(notePreview({ ...FULL, document: '<p>Seis tomates</p>' })).toBe('Seis tomates');
  });
});

describe('filtering and ordering', () => {
  const other: Note = {
    ...FULL,
    id: 'n2',
    workspaceId: 'w2',
    folderId: null,
    title: 'Pan',
    favorite: false,
    tags: [],
    updatedAt: '2026-01-03T00:00:00.000Z',
  };
  const all = [FULL, other];

  it('by space', () => {
    expect(applyNoteFilters(all, { workspaceId: 'w1' }).map((n) => n.id)).toEqual(['n1']);
  });

  it('by folder, and can ask for the notes that are not in any folder', () => {
    // `null` here means "not filed", which is different from "no opinion about
    // the folder". Collapsing the two hides every loose note in a space.
    expect(applyNoteFilters(all, { folderId: 'f1' }).map((n) => n.id)).toEqual(['n1']);
    expect(applyNoteFilters(all, { folderId: null }).map((n) => n.id)).toEqual(['n2']);
    expect(applyNoteFilters(all, {}).map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('by favourite', () => {
    expect(applyNoteFilters(all, { favorite: true }).map((n) => n.id)).toEqual(['n1']);
  });

  it('by tag', () => {
    expect(applyNoteFilters(all, { tag: 'cocina' }).map((n) => n.id)).toEqual(['n1']);
    expect(applyNoteFilters(all, { tag: 'invierno' })).toEqual([]);
  });

  it('puts the most recently touched first, and does not reorder the caller', () => {
    expect(sortNotes([FULL, other]).map((n) => n.id)).toEqual(['n2', 'n1']);
    expect([FULL.id, other.id]).toEqual(['n1', 'n2']);
  });
});
