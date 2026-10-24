import { getLocalStoreReady } from "@/lib/offline";
import { todayKey } from "@/lib/journal/days";

/** How many lines of the day a widget keeps: the launcher cuts what does not fit anyway. */
const MAX_LINES = 8;

export interface JournalToday {
  day: string;
  lines: string[];
  uri: string;
}

/**
 * Today's page of the journal, from the local copy. The entry is found by its day, not by user:
 * the widget runs headless, with no session, and the cache only holds the signed-in user's rows.
 */
export async function loadJournalToday(
  now: Date = new Date(),
): Promise<JournalToday> {
  const day = todayKey(now);
  const store = await getLocalStoreReady();
  const rows = await store.listCached("journal_entry");

  let text = "";
  for (const row of rows) {
    if (row.deletedAt !== null) continue;
    try {
      const server = JSON.parse(row.payload) as {
        day?: string;
        plainText?: string;
      };
      const pending = row.pending
        ? (JSON.parse(row.pending) as { day?: string; plainText?: string })
        : {};
      const merged = { ...server, ...pending };
      if (merged.day === day) {
        text = merged.plainText ?? "";
        break;
      }
    } catch {
      // A row that does not parse is skipped, not fatal for the widget.
    }
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_LINES);
  return { day, lines, uri: "orbithub://journal" };
}
