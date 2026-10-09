import { describe, expect, it } from 'vitest';

import { mentionIndicatorFor } from '@orbit-hub/contracts';

import type { MentionTarget } from '@/lib/journal/mentions';
import { CHIP_PAD, mentionChipFor, mentionNameFor, mentionsIn, nameOfRecord, renderMentions, routeForMention } from '@/lib/journal/mentions';
import { levelRows } from '@/lib/journal/mention-tree';
import type { MentionRecord } from '@/lib/journal/mention-model';

const LIST_ID = '6f1c0a2e-3b8d-4c1e-9a7f-2d5e8b9c0a11';
const NOTE_ID = '0b9e8d7c-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const MISSING_ID = '11111111-2222-4333-8444-555555555555';

const cache: Record<string, MentionTarget> = {
  [`list:${LIST_ID}`]: { name: 'Lista de la compra (nueva)', route: `/list/${LIST_ID}`, icon: '📋', colour: null },
  [`note:${NOTE_ID}`]: { name: 'Receta', route: `/(app)/note/${NOTE_ID}`, icon: '📝', colour: null },
};
const lookup = (type: string, id: string) => cache[`${type}:${id}`] ?? null;

const chip = (type: string, id: string, text: string) =>
  `<mention text="${text}" indicator="@" type="${type}" id="${id}">${text}</mention>`;

describe('renderMentions', () => {
  it('shows a chip with the name the target has now, not the one it was made with', () => {
    const html = `<p>Hoy: ${chip('list', LIST_ID, 'Lista de la compra')}</p>`;

    const shown = renderMentions(html, lookup, { mode: 'reading', unavailableLabel: 'no disponible' });

    expect(shown).toContain('>\u2002📋 Lista de la compra (nueva)\u2002</mention>');
  });

  it('keeps the attributes exactly as stored, so a chip still points where it did', () => {
    const html = chip('list', LIST_ID, 'Antes');

    const shown = renderMentions(html, lookup, { mode: 'reading', unavailableLabel: 'no disponible' });

    expect(shown).toContain(`type="list" id="${LIST_ID}"`);
  });

  it('says so when the target is gone, in reading', () => {
    const html = chip('list', MISSING_ID, 'Borrada');

    const shown = renderMentions(html, lookup, { mode: 'reading', unavailableLabel: 'no disponible' });

    expect(shown).toContain('>no disponible</mention>');
  });

  it('keeps the name it was made with when the target is gone, while editing', () => {
    const html = chip('list', MISSING_ID, 'Borrada');

    const shown = renderMentions(html, lookup, { mode: 'editing', unavailableLabel: 'no disponible' });

    expect(shown).toBe(html);
  });

  it('leaves a chip it does not know how to resolve exactly as it was', () => {
    const html = `<p>${chip('reminder', LIST_ID, 'Recordatorio')}</p>`;

    expect(renderMentions(html, lookup, { mode: 'reading', unavailableLabel: 'no disponible' })).toBe(html);
  });

  it('escapes a name so that it cannot open markup', () => {
    const hostile = { name: '<b>x</b> "y"', route: '/', icon: '📝', colour: null };
    const shown = renderMentions(chip('note', NOTE_ID, 'a'), () => hostile, {
      mode: 'reading',
      unavailableLabel: 'no disponible',
    });

    expect(shown).toContain('&lt;b&gt;x&lt;/b&gt; &quot;y&quot;');
    expect(shown).not.toContain('<b>x</b>');
  });

  it('does not change a document that has no chips', () => {
    const html = '<h2>Compra</h2><p>Leche</p>';
    expect(renderMentions(html, lookup, { mode: 'reading', unavailableLabel: '?' })).toBe(html);
  });
});

describe('mentionChipFor', () => {
  it('is born with the space colour, so a chip is painted as its space from the first moment', () => {
    const chip = mentionChipFor({ colour: 'slate', icon: '📋', name: 'Lista de la compra' });

    expect(chip.indicator).toBe(mentionIndicatorFor('slate'));
    expect(chip.indicator).not.toBe('@');
  });

  it('falls back to the plain trigger when the thing is in no space', () => {
    expect(mentionChipFor({ colour: null, icon: '🔖', name: 'Enlace' }).indicator).toBe('@');
  });

  it('is born with the icon and the name, not only the name', () => {
    const chip = mentionChipFor({ colour: 'slate', icon: '📋', name: 'Lista' });

    expect(chip.text).toContain('📋 Lista');
    expect(chip.text.startsWith(CHIP_PAD)).toBe(true);
  });

  it('looks the same before and after a re-read, which is the whole point of carrying the colour', () => {
    const born = mentionChipFor({ colour: 'slate', icon: '📋', name: 'Lista' });
    const html = `<p><mention text="Lista" indicator="${born.indicator}" type="list" id="${LIST_ID}">${born.text}</mention></p>`;
    const unchanged: MentionTarget = { name: 'Lista', route: `/list/${LIST_ID}`, icon: '📋', colour: 'slate' };

    const shown = renderMentions(html, () => unchanged, { mode: 'reading', unavailableLabel: 'no disponible' });

    expect(shown).toContain(`>${born.text}</mention>`);
  });
});

describe('routeForMention', () => {
  it('opens a list as a list and a board as a board', () => {
    expect(routeForMention('list', LIST_ID, { kind: 'tasks' })).toBe(`/list/${LIST_ID}`);
    expect(routeForMention('list', LIST_ID, { kind: 'board' })).toBe(`/board/${LIST_ID}`);
  });

  it('opens a folder inside its space', () => {
    expect(routeForMention('folder', LIST_ID, { workspaceId: NOTE_ID })).toBe(
      `/(app)/workspace/${NOTE_ID}/folder/${LIST_ID}`,
    );
  });

  it('opens a note, a bookmark and a space at their own screens', () => {
    expect(routeForMention('note', NOTE_ID)).toBe(`/(app)/note/${NOTE_ID}`);
    expect(routeForMention('bookmark', NOTE_ID)).toBe(`/(app)/bookmark/${NOTE_ID}`);
    expect(routeForMention('workspace', NOTE_ID)).toBe(`/(app)/workspace/${NOTE_ID}`);
  });
});

describe('mentionsIn', () => {
  it('lists the chips of a document once each, in the order they were written', () => {
    const html = `<p>${chip('list', LIST_ID, 'A')} y ${chip('note', NOTE_ID, 'B')} y ${chip('list', LIST_ID, 'A')}</p>`;
    expect(mentionsIn(html)).toEqual([
      { type: 'list', id: LIST_ID },
      { type: 'note', id: NOTE_ID },
    ]);
  });

  it('ignores a chip of a type it does not know', () => {
    expect(mentionsIn(`<p>${chip('reminder', LIST_ID, 'R')}</p>`)).toEqual([]);
  });
});

describe('mentionNameFor', () => {
  it('drops the characters a chip cannot carry, and keeps it within the limit', () => {
    expect(mentionNameFor('Lista "de" <la> compra')).toBe('Lista de la compra');
    expect(mentionNameFor('x'.repeat(200))).toHaveLength(120);
  });
});

describe('nameOfRecord', () => {
  it('reads a space and a folder by name, and a list, a note and a bookmark by title', () => {
    expect(nameOfRecord('workspace', { name: 'Casa' })).toBe('Casa');
    expect(nameOfRecord('folder', { name: 'Compras' })).toBe('Compras');
    expect(nameOfRecord('list', { title: 'Lista de la compra' })).toBe('Lista de la compra');
    expect(nameOfRecord('note', { title: 'Receta' })).toBe('Receta');
    expect(nameOfRecord('bookmark', { title: 'Artículo' })).toBe('Artículo');
  });

  it('gives an empty name rather than inventing one', () => {
    expect(nameOfRecord('list', { name: 'Lo que no es su campo' })).toBe('');
  });
});

describe('levelRows', () => {
  const rec = (type: MentionRecord['type'], id: string, name: string, extra: Partial<MentionRecord> = {}): MentionRecord => ({
    type, id, name, workspaceId: null, folderId: null, kind: null, emoji: null, icon: null, colour: null, ...extra,
  });
  const SPACE = 'aaaaaaaa-0000-4000-8000-000000000001';
  const OTHER = 'aaaaaaaa-0000-4000-8000-000000000004';
  const FOLDER = 'aaaaaaaa-0000-4000-8000-000000000002';
  const SUB = 'aaaaaaaa-0000-4000-8000-000000000003';
  const records: MentionRecord[] = [
    rec('workspace', SPACE, 'WorkspaceX', { workspaceId: SPACE, colour: 'teal' }),
    rec('workspace', OTHER, 'Casa', { workspaceId: OTHER }),
    rec('list', 'l1', 'Lista de la compra', { workspaceId: SPACE }),
    rec('folder', FOLDER, 'Cine', { workspaceId: SPACE }),
    rec('folder', SUB, 'Marvel', { workspaceId: SPACE, folderId: FOLDER }),
    rec('list', 'l2', 'Películas de Marvel', { workspaceId: SPACE, folderId: SUB, kind: 'board' }),
    rec('note', 'n1', 'Apuntes', { workspaceId: SPACE }),
  ];

  it('starts with the spaces only, in name order, and every one is entered rather than picked', () => {
    const rows = levelRows(records, null);
    expect(rows.map((row) => row.name)).toEqual(['Casa', 'WorkspaceX']);
    expect(rows.every((row) => row.enters)).toBe(true);
  });

  it('opens one space at its top level: folders, then lists, notes and bookmarks', () => {
    expect(levelRows(records, `space:${SPACE}`).map((row) => [row.name, row.enters])).toEqual([
      ['Cine', true],
      ['Lista de la compra', false],
      ['Apuntes', false],
    ]);
  });

  it('goes into a folder and shows only what is inside it', () => {
    expect(levelRows(records, `folder:${FOLDER}`).map((row) => row.name)).toEqual(['Marvel']);
    expect(levelRows(records, `folder:${SUB}`).map((row) => row.name)).toEqual(['Películas de Marvel']);
  });

  it('draws a board with its own icon', () => {
    expect(levelRows(records, `folder:${SUB}`)[0]?.icon).toBe('🗂️');
  });

  it('carries a vector icon as it is, so the row can draw it instead of the emoji', () => {
    const vector = { type: 'vector', value: 'cart-outline', style: 'outline', library: 'ionicons', color: 'auto' } as const;
    const withVector = [rec('list', 'l9', 'Compra verde', { workspaceId: SPACE, icon: vector })];

    const row = levelRows(withVector, `space:${SPACE}`)[0];

    expect(row?.iconRef).toEqual(vector);
    // The chip still needs an emoji, so the emoji text stays available next to the icon.
    expect(row?.icon).toBe('📋');
  });

  it('shows a thing whose folder is gone at the top of its space', () => {
    const orphan = [...records, rec('list', 'l3', 'Huérfana', { workspaceId: SPACE, folderId: 'no-existe' })];
    expect(levelRows(orphan, `space:${SPACE}`).map((row) => row.name)).toContain('Huérfana');
  });
});
