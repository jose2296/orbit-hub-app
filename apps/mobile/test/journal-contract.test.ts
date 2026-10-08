import { describe, expect, it } from 'vitest';

import {
  JOURNAL_NAMESPACE,
  isRealJournalDay,
  journalDaySchema,
  journalEntryIdFor,
  sha1,
  uuidV5,
  validateNoteDocument,
} from '@orbit-hub/contracts';

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const encoder = new TextEncoder();
const reasons = (html: string): string[] =>
  validateNoteDocument(html).map((problem) => problem.reason);

/*
 * The reference values come from Python's hashlib and uuid, which implement the
 * standards. If the hash here differs by one bit, two phones would name the same
 * day differently and a journal would quietly grow two rows for it.
 */
describe('sha1', () => {
  it('matches the standard vectors', () => {
    expect(hex(sha1(encoder.encode('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(new Uint8Array()))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('handles messages that span several blocks', () => {
    expect(hex(sha1(encoder.encode('a'.repeat(1000))))).toBe(
      '291e9a6c66994949b57ba5e650361e98fc36b1ba',
    );
  });
});

describe('uuidV5', () => {
  it('matches the RFC 4122 DNS namespace example', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  it('hashes non ASCII names as UTF-8', () => {
    expect(uuidV5('6f1c0a2e-3b8d-4c1e-9a7f-2d5e8b9c0a11', 'ñandú:2026-10-08')).toBe(
      '9eaee23f-0098-5c08-817d-c1747df58ca8',
    );
  });
});

describe('journalEntryIdFor', () => {
  const account = '6f1c0a2e-3b8d-4c1e-9a7f-2d5e8b9c0a11';

  it('is the same id for the same person and day, on any device', () => {
    expect(journalEntryIdFor(account, '2026-10-08')).toBe(journalEntryIdFor(account, '2026-10-08'));
    expect(journalEntryIdFor(account, '2026-10-08')).toBe(
      uuidV5(JOURNAL_NAMESPACE, `${account}:2026-10-08`),
    );
  });

  it('differs between days and between people', () => {
    expect(journalEntryIdFor(account, '2026-10-08')).not.toBe(journalEntryIdFor(account, '2026-10-09'));
    expect(journalEntryIdFor(account, '2026-10-08')).not.toBe(
      journalEntryIdFor('0b9e8d7c-1a2b-4c3d-8e9f-0a1b2c3d4e5f', '2026-10-08'),
    );
  });
});

describe('journal days', () => {
  it('accepts a day that exists', () => {
    expect(isRealJournalDay('2026-10-08')).toBe(true);
    expect(isRealJournalDay('2028-02-29')).toBe(true);
  });

  it('refuses a day that does not exist, or a date in another shape', () => {
    expect(isRealJournalDay('2026-02-29')).toBe(false);
    expect(isRealJournalDay('2026-13-01')).toBe(false);
    expect(isRealJournalDay('2026-1-01')).toBe(false);
    expect(isRealJournalDay('08/10/2026')).toBe(false);
    expect(journalDaySchema.safeParse('2026-10-08T00:00:00Z').success).toBe(false);
  });
});

describe('mention in a note document', () => {
  const id = '6f1c0a2e-3b8d-4c1e-9a7f-2d5e8b9c0a11';
  const mention = (attributes: string, text = 'Lista de la compra') =>
    `<p>Hoy toca <mention ${attributes}>${text}</mention>.</p>`;

  it('accepts the chip the editor writes', () => {
    expect(reasons(mention(`text="Lista de la compra" indicator="@" type="list" id="${id}"`))).toEqual([]);
  });

  it('accepts a chip without its copy of the name', () => {
    expect(reasons(mention(`indicator="@" type="note" id="${id}"`))).toEqual([]);
  });

  it('accepts the colour of a space as the indicator, and nothing else', () => {
    expect(reasons(mention(`indicator="@teal" type="list" id="${id}"`))).toEqual([]);
    expect(reasons(mention(`indicator="@nope" type="list" id="${id}"`)).length).toBeGreaterThan(0);
  });

  it('refuses a trigger other than @', () => {
    expect(reasons(mention(`indicator="#" type="list" id="${id}"`)).length).toBeGreaterThan(0);
  });

  it('refuses a type the app cannot open', () => {
    expect(reasons(mention(`indicator="@" type="reminder" id="${id}"`)).length).toBeGreaterThan(0);
  });

  it('refuses a target that is not a UUID', () => {
    expect(reasons(mention(`indicator="@" type="list" id="lista-1"`)).length).toBeGreaterThan(0);
  });

  it('refuses markup in the name', () => {
    expect(
      reasons(mention(`text="<img src=x>" indicator="@" type="list" id="${id}"`)).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a name longer than the limit', () => {
    expect(
      reasons(mention(`text="${'x'.repeat(121)}" indicator="@" type="list" id="${id}"`)).length,
    ).toBeGreaterThan(0);
  });

  it('refuses an attribute the chip does not take', () => {
    expect(
      reasons(mention(`indicator="@" type="list" id="${id}" style="color:red"`)).length,
    ).toBeGreaterThan(0);
  });

  it('refuses markup inside the chip, which holds only its name', () => {
    expect(
      reasons(`<p><mention indicator="@" type="list" id="${id}"><b>Lista</b></mention></p>`).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a chip inside a link', () => {
    expect(
      reasons(`<p><a href="https://example.com"><mention indicator="@" type="list" id="${id}">L</mention></a></p>`)
        .length,
    ).toBeGreaterThan(0);
  });
});
