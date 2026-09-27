import { ITEM_ICONS } from "@orbit-hub/contracts";
import type { ItemIcon, ListItem, ListOrderMode } from "@orbit-hub/contracts";


/** Whether a value is an icon the app knows how to draw. */
export function isItemIcon(
  value: string | null | undefined,
): value is ItemIcon {
  return (
    typeof value === "string" &&
    (ITEM_ICONS as readonly string[]).includes(value)
  );
}

/**
 * How a list is read.
 *
 * `manual` is the order the items are in. The others are how to look at them,
 * and none of them renumber anything: the manual order is kept, so choosing an
 * order to look at something is not a way of losing it.
 */
export function orderItems(items: ListItem[], mode: ListOrderMode): ListItem[] {
  if (mode === "manual") {
    return [...items].sort((a, b) => a.position - b.position);
  }

  // The same copy on every comparison: a locale that sorts "Ñ" after "Z" is not
  // a bug to work around in the row, it is the order the person expects.
  const byText = new Intl.Collator("es", {
    sensitivity: "base",
    numeric: true,
  });
  const copy = [...items];

  switch (mode) {
    case "alphabetical":
      return copy.sort(
        (a, b) => byText.compare(a.title, b.title) || a.position - b.position,
      );
    case "alphabetical_desc":
      return copy.sort(
        (a, b) => byText.compare(b.title, a.title) || a.position - b.position,
      );
    case "created_asc":
      return copy.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.position - b.position,
      );
    case "created_desc":
      return copy.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.position - b.position,
      );
    case "updated_desc":
      return copy.sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.position - b.position,
      );
    case "priority":
      return copy.sort(
        (a, b) =>
          PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
          a.position - b.position,
      );
    default:
      return copy.sort((a, b) => a.position - b.position);
  }
}

const PRIORITY_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;

/**
 * Whether a row can be dragged.
 *
 * Only under the manual order. A row moved while the list is alphabetical
 * lands somewhere the order did not ask for, and the next re-sort puts it back
 * where it was, which looks like the drag did nothing.
 */
export function canReorder(mode: ListOrderMode): boolean {
  return mode === "manual";
}

/**
 * The labels of a list, most used first, for the filter.
 *
 * A label with more items is more worth filtering by, and an unused one is
 * offered last rather than hidden: someone who is about to use it is looking at
 * the list right now.
 */
export function tagsByFrequency(
  items: ListItem[],
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    // Once per item, not once per appearance: a label written twice on the same
    // row is one thing, and the count beside it in the filter is a number of
    // rows, not a number of letters.
    for (const tag of new Set(item.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The items a filter leaves.
 *
 * Empty filters mean everything: a filter panel that starts hiding things the
 * moment it opens is a panel nobody trusts.
 */
export function filterItems(
  items: ListItem[],
  filters: {
    tags?: string[];
    completed?: "all" | "pending" | "done";
    text?: string;
  },
): ListItem[] {
  const tags = filters.tags ?? [];
  const text = (filters.text ?? "").trim().toLowerCase();

  return items.filter((item) => {
    if (filters.completed === "pending" && item.completed) return false;
    if (filters.completed === "done" && !item.completed) return false;
    // Any of the chosen labels, not all of them: a person who picked Mercadona
    // and "urgente" wants both, not the intersection.
    if (tags.length > 0 && !tags.some((tag) => item.tags.includes(tag)))
      return false;
    if (text.length > 0 && !item.title.toLowerCase().includes(text))
      return false;
    return true;
  });
}
