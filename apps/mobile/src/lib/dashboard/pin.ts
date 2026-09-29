import type { DashboardWidget, Folder, List } from "@orbit-hub/contracts";

import { MIN_CARD_COLUMNS, MIN_CARD_ROWS, pageCount, pageForNewCard } from "./panel";

/**
 * Pinning a thing to the dashboard.
 *
 * A pinned thing is a widget, not a copy of it: the widget says which thing it is
 * and the dashboard reads it, so a list pinned from two places is one card and
 * deleting the list takes the card with it.
 *
 * Lists and folders are the same kind of widget, distinguished by `kind`. That is
 * deliberate: a folder is a place and a list is a place with things in it, and the
 * panel treats both as "a place you can jump to". Two functions per kind would
 * differ only in three strings, and the third string is where the bugs are.
 *
 * The rules live here so they can be checked without a database, and so the places
 * that can pin something agree on what pinning means.
 */

/** The size a new card is, in cells. A quarter of the screen: the smallest there is. */
export const NEW_CARD = {
  w: MIN_CARD_COLUMNS,
  h: MIN_CARD_ROWS,
} as const;

/** The default card: a quarter of the panel, at the top left until it is moved. */
export function listWidget(list: List): DashboardWidget {
  return {
    id: `list:${list.id}`,
    kind: "recent_lists",
    x: 0,
    y: 0,
    w: NEW_CARD.w,
    h: NEW_CARD.h,
    page: 0,
    pinned: true,
    settings: {
      listId: list.id,
      title: list.title,
      kind: list.kind,
      emoji: list.emoji,
    },
  };
}

/** The default card for a folder, which opens the folder rather than a list. */
export function folderWidget(folder: Folder): DashboardWidget {
  return {
    id: `folder:${folder.id}`,
    kind: "folder",
    x: 0,
    y: 0,
    w: NEW_CARD.w,
    h: NEW_CARD.h,
    page: 0,
    pinned: true,
    settings: {
      folderId: folder.id,
      title: folder.name,
      emoji: folder.emoji,
      workspaceId: folder.workspaceId,
    },
  };
}

/** Whether a widget is a folder's card, whatever the payload is called. */
export function isFolderWidget(widget: DashboardWidget): boolean {
  return (
    widget.kind === "folder" ||
    widget.id.startsWith("folder:") ||
    typeof widget.settings?.["folderId"] === "string"
  );
}

/** Whether a widget points at a list, however it was written. */
export function isListWidget(widget: DashboardWidget): boolean {
  return typeof widget.settings?.["listId"] === "string";
}

export function isPinned(layout: DashboardWidget[], listId: string): boolean {
  return layout.some((widget) => widget.settings?.["listId"] === listId);
}

export function isFolderPinned(
  layout: DashboardWidget[],
  folderId: string,
): boolean {
  return layout.some((widget) => widget.settings?.["folderId"] === folderId);
}

/**
 * The layout with a list pinned to it, or the same one when it already is.
 *
 * It goes on the first screen that still has room, and past that on the last
 * screen there is. A card that landed on top of another one hides it, and a
 * panel where half the cards are unreachable is worse than a long one.
 */
export function withPinnedList(
  layout: DashboardWidget[],
  list: List,
): DashboardWidget[] {
  if (isPinned(layout, list.id)) return layout;

  const page = pageForNewCard(layout, NEW_CARD);
  return [...layout, { ...listWidget(list), page }];
}

/**
 * The layout with a folder pinned to it, or the same one when it already is.
 *
 * The same rules as a list, and the same function underneath. A folder is a place
 * you can jump to, exactly like a list, and a panel that pinned one but not the
 * other would be saying that a folder is somehow less worth reaching.
 */
export function withPinnedFolder(
  layout: DashboardWidget[],
  folder: Folder,
): DashboardWidget[] {
  if (isFolderPinned(layout, folder.id)) return layout;

  const page = pageForNewCard(layout, NEW_CARD);
  return [...layout, { ...folderWidget(folder), page }];
}

/** The layout without a list's card, and only that card. */
export function withoutPinnedList(
  layout: DashboardWidget[],
  listId: string,
): DashboardWidget[] {
  return layout.filter((widget) => widget.settings?.["listId"] !== listId);
}

/** The layout without a folder's card, and only that card. */
export function withoutPinnedFolder(
  layout: DashboardWidget[],
  folderId: string,
): DashboardWidget[] {
  return layout.filter((widget) => widget.settings?.["folderId"] !== folderId);
}

export { pageCount };
