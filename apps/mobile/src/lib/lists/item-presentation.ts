import { Ionicons } from "@expo/vector-icons";

import { ITEM_ICONS } from "@orbit-hub/contracts";
import type { ItemIcon, ListItem, ListOrderMode } from "@orbit-hub/contracts";

import type { TranslationKey } from "@/lib/i18n";

/**
 * The glyph each icon is drawn with.
 *
 * The keys come from the contract, so there is one list of what an icon is and
 * the server refuses a key nobody can draw. Typed as the full set on purpose: an
 * icon the contract has and this map does not is a compile error and not a blank
 * space where the picture should be.
 */
export const ITEM_GLYPHS = {
  basket: { labelKey: "icon.basket", glyph: "basket-outline" },
  cart: { labelKey: "icon.cart", glyph: "cart-outline" },
  apple: { labelKey: "icon.apple", glyph: "nutrition-outline" },
  bread: { labelKey: "icon.bread", glyph: "cafe-outline" },
  milk: { labelKey: "icon.milk", glyph: "water-outline" },
  water: { labelKey: "icon.water", glyph: "water" },
  meat: { labelKey: "icon.meat", glyph: "restaurant-outline" },
  fish: { labelKey: "icon.fish", glyph: "fish-outline" },
  egg: { labelKey: "icon.egg", glyph: "egg-outline" },
  cheese: { labelKey: "icon.cheese", glyph: "disc-outline" },
  rice: { labelKey: "icon.rice", glyph: "fast-food-outline" },
  coffee: { labelKey: "icon.coffee", glyph: "cafe-outline" },
  cake: { labelKey: "icon.cake", glyph: "gift-outline" },
  pill: { labelKey: "icon.pill", glyph: "medkit-outline" },
  soap: { labelKey: "icon.soap", glyph: "sparkles-outline" },
  toothbrush: { labelKey: "icon.toothbrush", glyph: "brush-outline" },
  shirt: { labelKey: "icon.shirt", glyph: "shirt-outline" },
  shoe: { labelKey: "icon.shoe", glyph: "walk-outline" },
  book: { labelKey: "icon.book", glyph: "book-outline" },
  paper: { labelKey: "icon.paper", glyph: "document-text-outline" },
  gift: { labelKey: "icon.gift", glyph: "gift-outline" },
  tool: { labelKey: "icon.tool", glyph: "construct-outline" },
  box: { labelKey: "icon.box", glyph: "cube-outline" },
  leaf: { labelKey: "icon.leaf", glyph: "leaf-outline" },
  paw: { labelKey: "icon.paw", glyph: "paw-outline" },
  ball: { labelKey: "icon.ball", glyph: "football-outline" },
  plane: { labelKey: "icon.plane", glyph: "airplane-outline" },
  bed: { labelKey: "icon.bed", glyph: "bed-outline" },
  battery: { labelKey: "icon.battery", glyph: "battery-charging-outline" },
} as const satisfies Record<
  ItemIcon,
  { labelKey: TranslationKey; glyph: keyof typeof Ionicons.glyphMap }
>;

/** The icons in the order the picker shows them, grouped by what they are. */
export const ITEM_ICON_GROUPS: { key: string; icons: ItemIcon[] }[] = [
  {
    key: "icons.group.food",
    icons: [
      "apple",
      "bread",
      "milk",
      "water",
      "meat",
      "fish",
      "egg",
      "cheese",
      "rice",
      "coffee",
      "cake",
    ],
  },
  {
    key: "icons.group.home",
    icons: [
      "soap",
      "toothbrush",
      "paper",
      "tool",
      "box",
      "gift",
      "pill",
      "battery",
    ],
  },
  { key: "icons.group.clothes", icons: ["shirt", "shoe"] },
  {
    key: "icons.group.out",
    icons: ["basket", "cart", "leaf", "paw", "ball", "plane", "bed", "book"],
  },
];

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
