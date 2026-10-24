import type { List, ListItem } from "@orbit-hub/contracts";

import { getLocalStoreReady, readRecord } from "@/lib/offline";
import { routeForList } from "@/lib/lists/route";

import { loadJournalToday } from "./journal-data";

/** How many lists the summary names: the ones with most to do. */
const TOP_LISTS = 3;

export interface DashboardSummary {
  pendingTotal: number;
  top: Array<{ id: string; title: string; pending: number; uri: string }>;
  wroteToday: boolean;
  /** Saved links that are in no collection yet. */
  unclassified: number;
}

/** The numbers of the day, from the local copy: what is left to do and whether today has an entry. */
export async function loadDashboard(
  now: Date = new Date(),
): Promise<DashboardSummary> {
  const store = await getLocalStoreReady();
  const lists = (await store.listCached("list"))
    .map((row) => readRecord<List>(row))
    .filter((list) => list.deletedAt == null && list.kind === "tasks");

  const counted = await Promise.all(
    lists.map(async (list) => {
      const items = (await store.listCachedItems(list.id))
        .map((row) => readRecord<ListItem>(row))
        .filter((item) => item.deletedAt == null && !item.completed);
      return {
        id: list.id,
        title: list.title,
        pending: items.length,
        uri: `orbithub:/${routeForList(list)}`,
      };
    }),
  );

  const unclassified = (await store.listCached("bookmark"))
    .map((row) =>
      readRecord<{ collectionId?: string | null; deletedAt?: string | null }>(
        row,
      ),
    )
    .filter(
      (bookmark) => bookmark.deletedAt == null && bookmark.collectionId == null,
    ).length;

  const withWork = counted
    .filter((list) => list.pending > 0)
    .sort((a, b) => b.pending - a.pending);
  const journal = await loadJournalToday(now);
  return {
    pendingTotal: withWork.reduce((sum, list) => sum + list.pending, 0),
    top: withWork.slice(0, TOP_LISTS),
    wroteToday: journal.lines.length > 0,
    unclassified,
  };
}
