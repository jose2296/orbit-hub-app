import type { DashboardWidget, List } from '@orbit-hub/contracts';

/**
 * Pinning a list to the dashboard.
 *
 * A pinned list is a widget, not a copy of the list: the widget says which list
 * it is and the dashboard reads it, so a list pinned from two places is one
 * card and deleting the list takes the card with it. A card per pinned list is
 * what the person asked for when they pinned it.
 *
 * The rules live here so they can be checked without a database, and so the two
 * screens that can pin a list agree on what pinning means.
 */

/** Where the next free cell of the grid is. */
const COLUMNS = 12;
const HEADER_ROWS = 4;

/** A card that says which list it is, which the dashboard needs and cannot guess. */
export function listWidget(list: List): DashboardWidget {
  return {
    id: `list:${list.id}`,
    kind: 'recent_lists',
    x: 0,
    y: 0,
    w: 3,
    h: 4,
    pinned: true,
    settings: { listId: list.id, title: list.title, kind: list.kind, emoji: list.emoji },
  };
}

export function isPinned(layout: DashboardWidget[], listId: string): boolean {
  return layout.some((widget) => widget.settings?.['listId'] === listId);
}

/**
 * The layout with a list pinned to it, or the same one when it already is.
 *
 * Placed after the cards that are already there, at the first free cell of the
 * row below them. A card that lands on top of another one hides it, and a
 * dashboard where half the cards are unreachable is worse than a long one.
 */
export function withPinnedList(layout: DashboardWidget[], list: List): DashboardWidget[] {
  if (isPinned(layout, list.id)) return layout;

  const widget = listWidget(list);
  const bottom = layout.reduce((lowest, row) => Math.max(lowest, row.y + row.h), HEADER_ROWS);
  return [...layout, { ...widget, x: 0, y: bottom }];
}

/** The layout without a list's card, and only that card. */
export function withoutPinnedList(
  layout: DashboardWidget[],
  listId: string,
): DashboardWidget[] {
  return layout.filter((widget) => widget.settings?.['listId'] !== listId);
}

/**
 * Whether a card still has somewhere to go.
 *
 * A grid of twelve columns and a card three wide always has room, and this says
 * so rather than letting the dashboard discover it with a card off the edge.
 */
export function fits(widget: DashboardWidget, taken: DashboardWidget[]): boolean {
  if (widget.x + widget.w > COLUMNS) return false;
  return !taken.some(
    (other) =>
      other.id !== widget.id &&
      widget.x < other.x + other.w &&
      other.x < widget.x + widget.w &&
      widget.y < other.y + other.h &&
      other.y < widget.y + widget.h,
  );
}
