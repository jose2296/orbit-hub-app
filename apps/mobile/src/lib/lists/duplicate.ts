import type { ListItem, ListKind, ListOrderMode } from '@orbit-hub/contracts';

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
  favorite: boolean;
  tags: string[];
  position: number;
  /** How the list is read, copied so the copy reads the same way. */
  orderMode: ListOrderMode;
}

export interface DuplicableItem {
  id: string;
  listId: string;
  title: string;
  position: number;
  completed: boolean;
  favorite: boolean;
  priority: ListItemPriority;
  icon: string | null;
  tags: string[];
  externalId: string | null;
  metadata: Record<string, unknown> | null;
  notes: string | null;
  deletedAt: string | null;
}

export interface DuplicationPlan {
  list: DuplicationSource & {
    id: string;
    favorite: false;
    itemCount: number;
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
    favorite: item.favorite,
    priority: item.priority,
    icon: item.icon,
    // Copied by value: a later push to the copy must not touch the original.
    tags: [...item.tags],
    externalId: item.externalId,
    metadata: item.metadata ? { ...item.metadata } : null,
    notes: item.notes,
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
      favorite: false,
      // Copied by value: a later push to the copy must not touch the original.
      tags: [...source.tags],
      position: source.position,
      // How the list is read is part of what the list is: a copy of a list
      // sorted by name that came out sorted by hand would be a different list.
      orderMode: source.orderMode,
      itemCount: items.length,
      version: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    items,
  };
}
