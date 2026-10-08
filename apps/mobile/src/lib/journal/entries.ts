/**
 * Reading and writing the journal, locally first.
 *
 * The same rule as the notes: a write lands in the cache and in the outbox, and
 * nothing here waits for the network. The id of a day's entry is derived from the
 * account and the day, so the phone can create it offline and a second device
 * arrives at the same row. See `docs/architecture/adr/0033-diario.md`.
 */

import {
  journalEntryIdFor,
  noteDocumentToPlainText,
  type JournalDay,
  type ListKind,
  type MentionType,
} from "@orbit-hub/contracts";

import type { MentionLookup, MentionTarget } from "./mentions";
import { nameOfRecord, routeForMention } from "./mentions";
import {
  enqueueOperation,
  getLocalStoreReady,
  localUpdate,
  type CachedEntity,
  type LocalStore,
} from "@/lib/offline";

export interface JournalEntryRecord {
  id: string;
  day: string;
  document: string;
  plainText: string;
  version: number;
  deletedAt: string | null;
}

/** The record as the cache holds it: the server's copy with any pending edit over it. */
function recordOf(row: CachedEntity): JournalEntryRecord {
  const server = JSON.parse(row.payload) as Partial<JournalEntryRecord>;
  const pending = row.pending
    ? (JSON.parse(row.pending) as Partial<JournalEntryRecord>)
    : {};
  const merged = { ...server, ...pending };
  return {
    id: row.entityId,
    day: String(merged.day ?? ""),
    document: String(merged.document ?? ""),
    plainText: String(merged.plainText ?? ""),
    version: row.version,
    deletedAt: row.deletedAt,
  };
}

/** The day's entry as the phone has it, or null when nothing was ever written for it. */
export async function readJournalEntry(
  userId: string,
  day: JournalDay,
  store?: LocalStore,
): Promise<JournalEntryRecord | null> {
  const local = store ?? (await getLocalStoreReady());
  const row = await local.getCached("journal_entry", journalEntryIdFor(userId, day));
  if (!row || row.deletedAt !== null) return null;
  return recordOf(row);
}

/**
 * Writes the day's document.
 *
 * The first write of a day is a create and carries the day; every later one is an
 * update from the version the phone last saw. Opening a day writes nothing: the
 * page calls this only when the person has typed something, so a week of swiping
 * does not leave a week of empty rows behind.
 */
export async function writeJournalEntry(
  userId: string,
  day: JournalDay,
  document: string,
): Promise<void> {
  const store = await getLocalStoreReady();
  const id = journalEntryIdFor(userId, day);
  const plainText = noteDocumentToPlainText(document);
  const cached = await store.getCached("journal_entry", id);

  if (cached) {
    await localUpdate("journal_entry", id, { document, plainText });
    return;
  }

  await store.upsertCached([
    {
      entity: "journal_entry",
      entityId: id,
      version: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      payload: JSON.stringify({ id, day, document, plainText }),
      pending: null,
    },
  ]);
  await enqueueOperation({
    kind: "create",
    entity: "journal_entry",
    entityId: id,
    baseVersion: 0,
    payload: { day, document },
  });
}

/** Every day that has words in it, for the dots on the calendar. */
export async function journalDaysWithText(userId: string): Promise<Set<string>> {
  const store = await getLocalStoreReady();
  const rows = await store.listCached("journal_entry");
  const days = new Set<string>();
  for (const row of rows) {
    if (row.deletedAt !== null) continue;
    const record = recordOf(row);
    if (record.plainText.trim().length === 0) continue;
    // A row that is not this account's cannot be in this cache; the check is cheap
    // and keeps a shared device from showing somebody else's days in the calendar.
    if (journalEntryIdFor(userId, record.day as JournalDay) !== row.entityId) continue;
    days.add(record.day);
  }
  return days;
}

const MENTION_ENTITIES: readonly MentionType[] = [
  "workspace",
  "folder",
  "list",
  "note",
  "bookmark",
];

/**
 * Every target a chip could point at, as the cache knows them, keyed by
 * `type:id`.
 *
 * Built once per change of the cache rather than per chip: a document with a
 * dozen chips would otherwise read the cache a dozen times while it draws.
 */
export async function mentionTargetIndex(): Promise<Map<string, MentionTarget>> {
  const store = await getLocalStoreReady();
  const index = new Map<string, MentionTarget>();

  for (const type of MENTION_ENTITIES) {
    const rows = await store.listCached(type);
    for (const row of rows) {
      if (row.deletedAt !== null) continue;
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const pending = row.pending ? (JSON.parse(row.pending) as Record<string, unknown>) : {};
      const merged = { ...payload, ...pending };
      const name = nameOfRecord(type, merged);
      if (name.length === 0) continue;
      index.set(`${type}:${row.entityId}`, {
        name,
        route: routeForMention(type, row.entityId, {
          workspaceId: (merged["workspaceId"] as string | null | undefined) ?? null,
          kind: (merged["kind"] as ListKind | undefined) ?? null,
        }),
      });
    }
  }
  return index;
}

/** A lookup over an index built by `mentionTargetIndex`. Synchronous, for drawing. */
export function lookupIn(index: Map<string, MentionTarget>): MentionLookup {
  return (type, id) => index.get(`${type}:${id}`) ?? null;
}
