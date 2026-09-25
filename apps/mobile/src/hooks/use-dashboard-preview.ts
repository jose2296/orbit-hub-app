import { useCallback, useEffect, useState } from 'react';

import type { List, ListItem } from '@orbit-hub/contracts';

import type { CachedEntity } from '@/lib/offline/local-store';
import { getLocalStoreReady, subscribeToLocalStore } from '@/lib/offline/local-store';
import { localUpdate } from '@/lib/offline';

import { useLists } from './use-lists';

export interface TaskPreviewRow {
  item: ListItem;
  listTitle: string;
  listId: string;
}

export interface TaskPreview {
  rows: TaskPreviewRow[];
  /** Task lists that had something to show. */
  listsWithPending: number;
  isLoading: boolean;
  /**
   * Ticks a task off from the home screen.
   *
   * The same write the list screen does, because a checkbox that cannot be
   * pressed is a lie about what the screen can do. It is a local write plus the
   * outbox, so it works offline and syncs on its own.
   */
  toggle: (item: ListItem) => Promise<void>;
}

function readItem(row: CachedEntity): ListItem | null {
  try {
    const record = JSON.parse(row.payload) as ListItem;
    return {
      ...record,
      id: row.entityId,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  } catch {
    // A row that cannot be read is skipped rather than taking the screen with
    // it: the cache is written by two places and one bad row is not worth a
    // blank home.
    return null;
  }
}

/**
 * The tasks that are waiting, for the home screen.
 *
 * Only a few rows of a few lists are read. A preview of five hundred tasks is
 * not a preview, and the list query is the one that narrows to a single list
 * instead of reading every cached item in the app, so it is asked per list with
 * a limit rather than once for everything.
 */
export function useTaskPreview(perList = 4, maxLists = 3): TaskPreview {
  const { lists, isLoading: listsLoading } = useLists({ kind: 'tasks' });
  const [rows, setRows] = useState<TaskPreviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const store = await getLocalStoreReady();
    const collected: TaskPreviewRow[] = [];

    for (const list of lists.slice(0, maxLists)) {
      const found = await store.listCachedItems(list.id, {
        includeCompleted: false,
        limit: perList,
      });

      for (const row of found) {
        const item = readItem(row);
        if (item) {
          collected.push({ item, listTitle: list.title, listId: list.id });
        }
      }
    }

    setRows(collected);
    setIsLoading(false);
  }, [lists, maxLists, perList]);

  useEffect(() => {
    if (listsLoading) return;
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load, listsLoading]);

  const listsWithPending = new Set(rows.map((row) => row.listId)).size;

  const toggle = useCallback(
    async (item: ListItem) => {
      await localUpdate('list_item', item.id, { completed: !item.completed });
    },
    [],
  );

  return { rows, listsWithPending, isLoading, toggle };
}

/** The lists a person worked on last, newest first. */
export function useRecentLists(limit = 4): { lists: List[]; isLoading: boolean } {
  const { lists, isLoading } = useLists({});
  return { lists: lists.slice(0, limit), isLoading };
}
