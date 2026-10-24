import type { List, ListItem, Workspace } from "@orbit-hub/contracts";

import { getLocalStoreReady, localUpdate, readRecord } from "@/lib/offline";
import { tasksInState } from "@/lib/lists/board";
import { orderItems } from "@/lib/lists/item-presentation";
import { routeForList } from "@/lib/lists/route";

/** How many pending rows a widget keeps: more than fits is cut by the launcher anyway. */
const MAX_ROWS = 12;
/** A board shows its first columns, and a couple of tasks under each. */
const MAX_COLUMNS = 4;
const COLUMN_TASKS = 2;

/** One column of a board as the widget shows it: its name, its colour and its first tasks. */
export interface PinnedColumn {
  id: string;
  title: string;
  /** A `#rrggbb` the person chose, or `null` for the widget's own accent. */
  color: string | null;
  count: number;
  tasks: string[];
}

export interface PinnedListData {
  id: string;
  title: string;
  uri: string;
  pending: Array<{ id: string; title: string }>;
  pendingTotal: number;
  /** Only for a board: its columns, in order. A task list has none. */
  columns: PinnedColumn[] | null;
}

/** The lists a widget can be pinned to: task lists, ticked off item by item, and boards, shown by column. The media lists have their own screens. */
export async function listPinnableLists(): Promise<
  Array<Pick<List, "id" | "title" | "kind">>
> {
  const store = await getLocalStoreReady();
  const rows = await store.listCached("list");
  return rows
    .map((row) => readRecord<List>(row))
    .filter(
      (list) =>
        list.deletedAt == null &&
        (list.kind === "tasks" || list.kind === "board"),
    )
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(({ id, title, kind }) => ({ id, title, kind }));
}

/** The list as the widget draws it, from the local copy; `null` if it is gone. */
export async function loadPinnedList(
  listId: string,
): Promise<PinnedListData | null> {
  const store = await getLocalStoreReady();
  const cached = await store.getCached("list", listId);
  if (!cached || cached.deletedAt) return null;
  const list = readRecord<List>(cached);
  const items = (await store.listCachedItems(listId))
    .map((row) => readRecord<ListItem>(row))
    .filter((item) => item.deletedAt == null);
  const pending = orderItems(items, list.orderMode ?? "manual").filter(
    (item) => !item.completed,
  );
  const columns =
    list.kind === "board"
      ? (list.states ?? []).slice(0, MAX_COLUMNS).map((state) => {
          const inColumn = tasksInState(pending, list.states ?? [], state.id);
          return {
            id: state.id,
            title: state.title,
            color: /^#[0-9A-Fa-f]{6}$/.test(state.color ?? "")
              ? (state.color as string)
              : null,
            count: inColumn.length,
            tasks: inColumn.slice(0, COLUMN_TASKS).map((item) => item.title),
          };
        })
      : null;
  return {
    id: list.id,
    title: list.title,
    // The scheme's host is the route without its group: `orbithub://list/<id>`.
    uri: `orbithub:/${routeForList(list)}`,
    pending: pending
      .slice(0, MAX_ROWS)
      .map((item) => ({ id: item.id, title: item.title })),
    pendingTotal: pending.length,
    columns,
  };
}

/** Ticks a task from the widget: the same local write plus queued operation the app makes. */
export async function completeItem(itemId: string): Promise<void> {
  await localUpdate("list_item", itemId, { completed: true });
}

/** The spaces a "New note" button can be pinned to. */
export async function listPinnableWorkspaces(): Promise<
  Array<Pick<Workspace, "id" | "name">>
> {
  const store = await getLocalStoreReady();
  const rows = await store.listCached("workspace");
  return rows
    .map((row) => readRecord<Workspace>(row))
    .filter((workspace) => workspace.deletedAt == null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}

export interface CaptureTargets {
  task: { title: string; uri: string } | null;
  note: { name: string; uri: string } | null;
}

/** What the quick-capture buttons open, from the choices made when the widget was set up. */
export async function loadCaptureTargets(config: {
  listId?: string;
  workspaceId?: string;
}): Promise<CaptureTargets> {
  const store = await getLocalStoreReady();
  let task: CaptureTargets["task"] = null;
  let note: CaptureTargets["note"] = null;

  if (config.listId) {
    const cached = await store.getCached("list", config.listId);
    if (cached && !cached.deletedAt) {
      const list = readRecord<List>(cached);
      task = {
        title: list.title,
        uri: `orbithub:/${routeForList(list)}?new=1`,
      };
    }
  }
  if (config.workspaceId) {
    const cached = await store.getCached("workspace", config.workspaceId);
    if (cached && !cached.deletedAt) {
      const workspace = readRecord<Workspace>(cached);
      note = {
        name: workspace.name,
        uri: `orbithub://workspace/${workspace.id}?create=note`,
      };
    }
  }
  return { task, note };
}
