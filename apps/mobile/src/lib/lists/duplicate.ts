import type {
  BoardStates,
  IconRef,
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
  icon: IconRef | null;
  tags: string[];
  position: number;
  /** How the list is read, copied so the copy reads the same way. */
  orderMode: ListOrderMode;
  /** The chosen colours of the labels, so the copy reads the same way. */
  tagColors: TagColors;
  /**
   * The columns of the board, when the list is one.
   *
   * Required and not optional because a list that is not a board carries the
   * empty array, which is a real value and not an absence: the same rule the
   * column on the server follows, so that "no board here" has one spelling in
   * both places.
   */
  states: BoardStates;
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
  icon: IconRef | null;
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

/**
 * The fields of a duplicated list the server is asked to write.
 *
 * `states` is named in the type rather than left to the index signature on
 * purpose: it is the field a hand-written payload drops without a word, and
 * naming it is what turns dropping it into a compile error instead of a board
 * that comes back empty.
 */
export type DuplicationListPayload = Record<string, unknown> & {
  states: BoardStates;
};

/** The same, one row down: the column a duplicated task is written in. */
export type DuplicationItemPayload = Record<string, unknown> & {
  stateId: string | null;
};

/**
 * One item's payload next to the id it is written under.
 *
 * Paired rather than two parallel arrays because the hook enqueues by position,
 * and a positional pairing with a fallback for a short array is a way to write an
 * empty payload without saying so.
 */
export interface DuplicationItemWrite {
  id: string;
  payload: DuplicationItemPayload;
}

export interface DuplicationOptions {
  newListId: string;
  newItemId: () => string;
  /**
   * Mints the ids of the copy's states.
   *
   * A parameter and not a `Crypto.randomUUID()` in here for the reason
   * `newItemId` is one: this function is the pure plan, and a generator that
   * comes from the outside is what lets a test say which column a task landed in.
   * Required rather than defaulted, because a caller that forgets it is then a
   * compile error instead of a copy whose columns come from somewhere the test
   * cannot see.
   */
  newStateId: () => string;
  now: string;
  title?: string;
}

/**
 * Builds the list and the items a duplicate is made of.
 *
 * Four decisions are deliberate and tested:
 *
 * - Deleted and foreign items are left out. A tombstone is not something you
 *   want resurrected in a new list.
 * - The copy is never a favourite. A favourite is a personal shortcut, and
 *   duplicating one should not take it away from the original.
 * - The completed state travels with each item, because a list duplicated
 *   half way through is usually duplicated *with* the progress.
 * - A board's columns are duplicated as **new** columns, new ids and all, and
 *   every task is moved to the new id of the column it was in. Copying the ids
 *   instead would tie two lists' tasks to the same columns, and the first rename
 *   in either of them would move the other one's tasks.
 */
export function planDuplication(
  source: DuplicationSource,
  allItems: DuplicableItem[],
  options: DuplicationOptions,
): DuplicationPlan {
  const { newListId, newItemId, newStateId, now } = options;
  const title = options.title?.trim() || source.title;

  const eligible = allItems
    .filter((item) => item.listId === source.id && item.deletedAt === null)
    .sort((a, b) => a.position - b.position);

  /*
    The copy's columns, with ids of their own, and the map that says which new id
    stands for which old one.

    By value, for the reason the tags and the label colours are: two lists that
    share an array share the objects in it, and renaming a column in the copy
    would rename it in the original while moving the original's tasks with it.
  */
  const remapeo = new Map<string, string>();
  const estados = source.states.map((estado) => {
    const id = newStateId();
    remapeo.set(estado.id, id);
    return { ...estado, id };
  });

  const items = eligible.map((item, index) => ({
    id: newItemId(),
    listId: newListId,
    title: item.title,
    position: index,
    completed: item.completed,
    /*
      The column of the copy, which is **not** the column of the original: the
      states above are new states, so an id carried over as it is points at a
      column that does not exist in the copy. That failure is invisible, because
      an unknown id is drawn in the first column — the board comes out looking
      plausible and with the tasks in the wrong place — and it only becomes real
      for somebody the day a column is renamed.

      Three cases, and the last two are not the same:
      - null stays null: "the first column" means the first column of each list,
        and the copy has a first column of its own;
      - an id the map knows becomes the new id of the same column, so a task
        keeps the column it was in and only its address changes;
      - an id the map does not know becomes null. It can only be a row that was
        already pointing at nothing in the original, and it stays that way: a
        dangling id draws in the first column just the same, while null says so
        and does not leave a task holding a reference to the original's board.
    */
    stateId: item.stateId === null ? null : (remapeo.get(item.stateId) ?? null),
    priority: item.priority,
    // The icon is one value, so a copy carries it whole: how it is drawn is
    // part of how the row is, and a copy looks the same. Spread, like the tags
    // below: a later write to the copy must not touch the original.
    icon: item.icon ? { ...item.icon } : null,
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
      // The icon is one value, so the copy carries it whole. Spread, like the
      // tags below: a later write to the copy must not touch the original.
      icon: source.icon ? { ...source.icon } : null,
        // Copied by value: a later push to the copy must not touch the original.
      tags: [...source.tags],
      position: source.position,
      // How the list is read is part of what the list is: a copy of a list
      // sorted by name that came out sorted by hand would be a different list.
      orderMode: source.orderMode,
      // Copied by value, same rule as the tags above: a later write to the copy's
      // map must not recolour the original.
      tagColors: { ...source.tagColors },
      // The columns the tasks above were just moved into. A copy of a board with
      // no columns is a board that draws nothing, and it draws nothing without
      // saying why: there is no first column to fall back to in an empty array.
      states: estados,
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

/**
 * What a duplication asks the server to write: the payload of the copy's create,
 * and the payload of each of its items.
 *
 * The second hand-written projection of the plan, and the first half of why a
 * duplicated board used to come back empty. `planDuplication` builds the whole
 * row — the copy the user sees — and the server only owns what is in
 * `SYNC_WRITABLE_FIELDS`, so the payload is a strict subset of it and has to be
 * named by hand somewhere. It used to be named in the middle of the hook, where
 * nothing could read it, and the two fields the plan had just invented were the
 * two it left out: the row looked right on the device until the next pull
 * replaced the payload with the server's, and a board with no columns and tasks on
 * ids that no longer exist is not an error anywhere in the chain.
 *
 * Every value comes from the plan and none is recomputed: a field derived twice is
 * a field that can disagree with itself, and the plan is where the state ids are
 * remapped.
 */
export function duplicationPayloads(plan: DuplicationPlan): {
  list: DuplicationListPayload;
  items: DuplicationItemWrite[];
} {
  return {
    list: {
      workspaceId: plan.list.workspaceId,
      title: plan.list.title,
      kind: plan.list.kind,
      ...(plan.list.folderId ? { folderId: plan.list.folderId } : {}),
      ...(plan.list.icon ? { icon: plan.list.icon } : {}),
      // Always, and not only when there is at least one column: this is the field
      // that says whether the list is a board, and a create that leaves it out
      // arrives as a board with nothing to draw and no way to know why.
      states: plan.list.states,
    },
    items: plan.items.map((item) => ({
      id: item.id,
      payload: {
        // The plan's own list id and not one passed in: they are the same value
        // and a second one is a second place for them to disagree.
        listId: plan.list.id,
        title: item.title,
        position: item.position,
        ...(item.completed ? { completed: true } : {}),
        // Same reason as the columns, one row down: without it every task arrives
        // in the first column, on the copy and on the original alike.
        stateId: item.stateId,
        ...(item.priority !== 'none' ? { priority: item.priority } : {}),
        ...(item.externalId ? { externalId: item.externalId } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
        ...(item.annotation ? { annotation: item.annotation } : {}),
      },
    })),
  };
}
