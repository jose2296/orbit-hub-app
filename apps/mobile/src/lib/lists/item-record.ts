import type { ListItem } from "@orbit-hub/contracts";

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

export interface NewListItemInput {
  id: string;
  listId: string;
  title: string;
  position: number;
  createdAt?: string;
  updatedAt?: string;
  priority?: ListItem["priority"];
  icon?: string | null;
  tags?: string[];
  externalId?: string | null;
  metadata?: Record<string, unknown> | null;
  notes?: string | null;
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
    favorite: false,
    priority: input.priority ?? "none",
    // A fresh array and not a shared constant: one row's labels must not appear
    // on every other row the moment somebody types one.
    tags: input.tags ? [...input.tags] : [],
    icon: input.icon ?? null,
    externalId: input.externalId ?? null,
    metadata: input.metadata ?? null,
    notes: input.notes ?? null,
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
    favorite: record.favorite === true,
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
    icon: typeof record.icon === "string" ? record.icon : null,
    externalId:
      typeof record.externalId === "string" ? record.externalId : null,
    metadata:
      record.metadata && typeof record.metadata === "object"
        ? (record.metadata as Record<string, unknown>)
        : null,
    notes: typeof record.notes === "string" ? record.notes : null,
    deletedAt: typeof record.deletedAt === "string" ? record.deletedAt : null,
  };
}
