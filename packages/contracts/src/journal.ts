/**
 * The journal: one note per calendar day, owned by the account and not by a space.
 *
 * A day is the local date of the person who writes it, as `YYYY-MM-DD`, and never
 * a timestamp: "the 8th of October" stays the 8th wherever the phone is. The entry
 * uses the note document format, so the editor, the validator and the search are
 * the ones notes already have. See `docs/architecture/adr/0033-diario.md`.
 */

import { z } from 'zod';

import { deletedAtSchema, isoDateTimeSchema, uuidSchema, versionSchema } from './common';
import { noteDocumentSchema } from './note-document';
import { uuidV5 } from './uuid-v5';

/**
 * The namespace every journal id is derived in. Fixed for ever: changing it moves
 * every entry to a new id, and a phone that wrote offline would then create a
 * second row for each day.
 */
export const JOURNAL_NAMESPACE = '5ff05d11-ed54-4cc9-8048-c57b088f7e20';

const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `day` is `YYYY-MM-DD` and names a day that exists. */
export function isRealJournalDay(day: string): boolean {
  const match = DAY_SHAPE.exec(day);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, date));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === date
  );
}

/** A calendar day, `YYYY-MM-DD`. Strings that look like dates but are not days are refused. */
export const journalDaySchema = z
  .string()
  .regex(DAY_SHAPE, 'a journal day is written YYYY-MM-DD')
  .refine(isRealJournalDay, 'that is not a day of the calendar');
export type JournalDay = z.infer<typeof journalDaySchema>;

/**
 * The id of the entry for `day` in the account `userId`.
 *
 * Computed by the phone when it creates the entry and recomputed by the API before
 * it accepts a create, so an id that does not match the person and the day is
 * refused: a client cannot write a day that is not its own, and cannot write the
 * same day twice under two ids.
 */
export function journalEntryIdFor(userId: string, day: JournalDay): string {
  return uuidV5(JOURNAL_NAMESPACE, `${userId}:${day}`);
}

/** An entry as the API and the sync protocol carry it. */
export const journalEntrySchema = z.object({
  id: uuidSchema,
  day: journalDaySchema,
  document: noteDocumentSchema,
  plainText: z.string().max(512_000),
  version: versionSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: deletedAtSchema,
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

/**
 * What a write of an entry carries in the sync payload.
 *
 * The id is not here: it is derived from the account and the day by the server,
 * and the operation's `entityId` is checked against that derivation.
 */
export const journalEntryPayloadSchema = z.object({
  day: journalDaySchema,
  document: noteDocumentSchema,
});
export type JournalEntryPayload = z.infer<typeof journalEntryPayloadSchema>;
