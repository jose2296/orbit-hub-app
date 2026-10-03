import type {
  ListItem,
  ListKind,
  ListOrderMode,
  TagColors,
} from '@orbit-hub/contracts';

type ListItemPriority = ListItem['priority'];

/**
 * Duplicating a list, as a pure plan.
 *
 * Kept out of the hook so the rules can be checked without a database: which
 * items travel, in what order, and which fields are deliberately not copied.
 */

export interface DuplicationSource {
  id: string;
  workspaceId: string;
  folderId: string | null;
  kind: ListKind;
  title: string;
  description: string | null;
  emoji: string | null;
  tags: string[];
  position: number;
  /** How the list is read, copied so the copy reads the same way. */
  orderMode: ListOrderMode;
  /** The chosen colours of the labels, so the copy reads the same way. */
  tagColors: TagColors;
}

export interface DuplicableItem {
  id: string;
  listId: string;
  title: string;
  position: number;
  completed: boolean;
  /**
   * The board column the task is drawn in, and it travels with the task.
   *
   * Copied rather than reset: a duplicate that appears in the first column
   * instead of the one the original was in is a silent wrong answer — the row
   * shows up, and in the wrong place.
   */
  stateId: string | null;
  priority: ListItemPriority;
  icon: ListItem["icon"];
  iconStyle: ListItem["iconStyle"];
  iconColor: ListItem["iconColor"];
  tags: string[];
  externalId: string | null;
  metadata: Record<string, unknown> | null;
  annotation: string | null;
  deletedAt: string | null;
}

export interface DuplicationPlan {
  list: DuplicationSource & {
    id: string;
    itemCount: number;
    /**
     * The copy is yours and editable, stated here rather than defaulted from the
     * contract. `role` has no default on purpose: a missing role that defaulted to
     * `editor` would let a payload without one claim write access, and the default
     * that is safe is the one that makes a legacy cache read-only.
     */
    role: "editor";
    shared: false;
    version: 0;
    createdAt: string;
    updatedAt: string;
    deletedAt: null;
  };
  items: (Omit<ListItem, 'listId' | 'version'> & { listId: string; version: 0 })[];
}

export interface DuplicationOptions {
  newListId: string;
  newItemId: () => string;
  now: string;
  title?: string;
}

/**
 * Builds the list and the items a duplicate is made of.
 *
 * Three decisions are deliberate and tested:
 *
 * - Deleted and foreign items are left out. A tombstone is not something you
 *   want resurrected in a new list.
 * - The copy is never a favourite. A favourite is a personal shortcut, and
 *   duplicating one should not take it away from the original.
 * - The completed state travels with each item, because a list duplicated
 *   half way through is usually duplicated *with* the progress.
 */
export function planDuplication(
  source: DuplicationSource,
  allItems: DuplicableItem[],
  options: DuplicationOptions,
): DuplicationPlan {
  const { newListId, newItemId, now } = options;
  const title = options.title?.trim() || source.title;

  const eligible = allItems
    .filter((item) => item.listId === source.id && item.deletedAt === null)
    .sort((a, b) => a.position - b.position);

  const items = eligible.map((item, index) => ({
    id: newItemId(),
    listId: newListId,
    title: item.title,
    position: index,
    completed: item.completed,
    // Same rule as `completed` above, and for the same reason: the column is
    // where the task is, and a copy that lands in the first one is a copy that
    // looks right and is not.
    stateId: item.stateId,
    priority: item.priority,
    icon: item.icon,
    // How it is drawn is part of how the row is, so a copy looks the same.
    iconStyle: item.iconStyle,
    iconColor: item.iconColor,
    // Copied by value: a later push to the copy must not touch the original.
    tags: [...item.tags],
    externalId: item.externalId,
    metadata: item.metadata ? { ...item.metadata } : null,
    annotation: item.annotation,
    // Same as the list: the copy is in a space of yours, so it is not "shared" no
    // matter how shared the original was, and you can edit what you just made.
    role: "editor" as const,
    shared: false,
    version: 0 as const,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));

  return {
    list: {
      id: newListId,
      workspaceId: source.workspaceId,
      folderId: source.folderId,
      kind: source.kind,
      title,
      description: source.description,
      emoji: source.emoji,
        // Copied by value: a later push to the copy must not touch the original.
      tags: [...source.tags],
      position: source.position,
      // How the list is read is part of what the list is: a copy of a list
      // sorted by name that came out sorted by hand would be a different list.
      orderMode: source.orderMode,
      // Copied by value, same rule as the tags above: a later write to the copy's
      // map must not recolour the original.
      tagColors: { ...source.tagColors },
      itemCount: items.length,
      /*
        Yours and editable, and it does not inherit from the source.

        The copy is a new list in a space of yours, so it is not "shared" however
        shared the original was — copying somebody else's list is how you get one
        you can edit, and carrying `shared` over would leave a list of your own
        wearing somebody else's badge. Whether the server accepts the copy at all
        is decided there, as always.
      */
      role: "editor",
      shared: false,
      version: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    items,
  };
}
