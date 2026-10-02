import { ITEM_ICON_COLORS, isItemIcon, sanitiseTagColors } from "@orbit-hub/contracts";
import type { List, ListItem } from "@orbit-hub/contracts";

/**
 * Building and reading a row of a list.
 *
 * Both halves of the same problem. A row is written by hand into the cache and
 * read back by parsing a payload, and a field that exists in the contract but
 * is missing in one of those two places is not a type error anywhere: it is a
 * row that renders as a crash, and it only crashes for the people whose row it
 * is. So the row is built in one place, with every field, and read in one
 * place, where a missing field gets the value the contract gives it.
 */

/**
 * The colour an icon is drawn in, or the app's own.
 *
 * The column is free text and a future build can write a colour this one does
 * not have, so a row with a colour nobody can draw comes out in the neutral one
 * instead of not coming out.
 */
function iconColorOf(value: unknown): ListItem["iconColor"] {
  return (ITEM_ICON_COLORS as readonly string[]).includes(String(value))
    ? (value as ListItem["iconColor"])
    : "neutral";
}

export interface NewListItemInput {
  id: string;
  listId: string;
  title: string;
  position: number;
  createdAt?: string;
  updatedAt?: string;
  priority?: ListItem["priority"];
  icon?: string | null;
  /** Filled or outline, and which of the app's colours. */
  iconStyle?: "outline" | "fill";
  iconColor?: string;
  tags?: string[];
  externalId?: string | null;
  metadata?: Record<string, unknown> | null;
  annotation?: string | null;
}

/**
 * A row to write, with every field the contract has.
 *
 * The defaults are not decoration: a row written without them is a row the
 * screen cannot draw, and the field that is missing is whichever was added last.
 */
export function newListItem(input: NewListItemInput): ListItem {
  const now = input.updatedAt ?? new Date().toISOString();
  return {
    id: input.id,
    version: 0,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    listId: input.listId,
    title: input.title,
    position: input.position,
    completed: false,
    priority: input.priority ?? "none",
    // A fresh array and not a shared constant: one row's labels must not appear
    // on every other row the moment somebody types one.
    tags: input.tags ? [...input.tags] : [],
    // An icon the app cannot draw is no icon, and not a broken row: what
    // somebody typed by hand, or what a future build wrote, arrives here and the
    // row still opens.
    icon: isItemIcon(input.icon) ? input.icon : null,
    iconStyle: input.iconStyle ?? "outline",
    iconColor: iconColorOf(input.iconColor),
    externalId: input.externalId ?? null,
    metadata: input.metadata ?? null,
    annotation: input.annotation ?? null,
    /*
      Yours and editable, and again not a guess: a row only reaches here from a
      screen that could add it, which is only reachable where you can write. A row
      added to a list somebody lent you is still a row *you* added, so `shared` is
      false even though the list around it is somebody else's — the list is where
      the share lives, not here.
    */
    role: "editor",
    shared: false,
    deletedAt: null,
  };
}

/**
 * A row read from the cache or from the server, with what is missing filled in.
 *
 * The cache outlives the build that wrote it: a row written by an older version
 * of the app, or by a client that sends only what it knows, is missing whatever
 * the contract has grown since. It is read with the defaults rather than
 * trusted, because the alternative is a screen that breaks the first time
 * somebody opens the app after an update.
 */
export function withListItemDefaults(value: unknown): ListItem {
  const record = (value ?? {}) as Record<string, unknown>;

  return {
    id: typeof record.id === "string" ? record.id : "",
    version: typeof record.version === "number" ? record.version : 0,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    listId: typeof record.listId === "string" ? record.listId : "",
    title: typeof record.title === "string" ? record.title : "",
    position: typeof record.position === "number" ? record.position : 0,
    completed: record.completed === true,
    priority:
      record.priority === "low" ||
      record.priority === "medium" ||
      record.priority === "high"
        ? record.priority
        : "none",
    // `tags` has to be an array and not just present: a payload that carries a
    // string or a null where the contract says a list is a row that cannot be
    // counted, filtered or read.
    tags: Array.isArray(record.tags) ? (record.tags as string[]) : [],
    // Same here as on the way in: a key this build cannot draw is no icon, and
    // the row around it still reads. A cache from a future build, or a payload
    // somebody edited by hand, does not take a whole list down with it.
    icon: isItemIcon(record.icon) ? record.icon : null,
    iconStyle: record.iconStyle === "fill" ? "fill" : "outline",
    iconColor: iconColorOf(record.iconColor),
    externalId:
      typeof record.externalId === "string" ? record.externalId : null,
    metadata:
      record.metadata && typeof record.metadata === "object"
        ? (record.metadata as Record<string, unknown>)
        : null,
    annotation: typeof record.annotation === "string" ? record.annotation : null,
    // A row cached before this existed has no answer. "Viewer" would make every
    // list in the app read-only the morning after an update; "editor" is wrong only
    // for rows somebody was lent, and the next pull fixes it. It cannot grant
    // anything: what a person may really do is decided on the server on every write.
    role:
      record.role === "owner" || record.role === "editor" || record.role === "viewer"
        ? record.role
        : "editor",
    shared: record.shared === true,
    deletedAt: typeof record.deletedAt === "string" ? record.deletedAt : null,
  };
}

/**
 * A list read from the cache or from the server, with the colours of its labels
 * filled in.
 *
 * The same reason as `withListItemDefaults`, and the same hazard with a sharper
 * edge: `readRecord` in `use-lists.ts` is a cast, not a parse, so a list that
 * was cached before `tagColors` existed arrives with **no key at all** — not
 * with an empty map. Every colour lookup would then be reading `undefined`, and
 * the failure would show up as a row that paints no labels.
 *
 * **Only `tagColors`, and that is a real difference from the function above.**
 * That one names every field, so a required field added to `listItemSchema`
 * without being added here is a compile error. This one is a spread: it copies
 * whatever the row has and fills in nothing else, so it carries every field the
 * list has today and **will not notice the next required one** — it will just
 * ship it missing. The spread is still the right shape, because a hand-written
 * copy of a list's fields is a second place to forget one, and the failure here
 * is the kind that only shows up in somebody's own cache.
 */
export function withListDefaults(value: unknown): List {
  const record = (value ?? {}) as Record<string, unknown>;

  return {
    ...(record as unknown as List),
    tagColors: sanitiseTagColors(record.tagColors),
  };
}
