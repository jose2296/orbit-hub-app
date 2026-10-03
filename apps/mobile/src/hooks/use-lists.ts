import type {
  ItemIconColor,
  List,
  ListItem,
  ListKind,
  ListOrderMode,
  Note,
  Priority,
  SearchResult,
} from "@orbit-hub/contracts";
import { notePreviewBelowTitle } from "@orbit-hub/contracts";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";

import { duplicationPayloads, planDuplication } from "@/lib/lists/duplicate";
import { nextPosition, planAddToList } from "@/lib/lists/add-to-list";
import { planTagColorChange } from "@/lib/lists/tag-colors";
import {
  newListItem,
  withListDefaults,
  withListItemDefaults,
} from "@/lib/lists/item-record";
import { reorderItems } from "@/lib/lists/reorder";
import {
  enqueueOperation,
  enqueueOperations,
  getLocalStoreReady,
  localUpdate,
  pullIntoCache,
  readCachedWorkspaces,
  subscribeToLocalStore,
} from "@/lib/offline";
import type { CachedEntity } from "@/lib/offline";

/**
 * Lists and items follow the same local-first rule as the rest of the content:
 * the screen reads the cache, the write is local, and the outbox does the rest.
 */

function readRecord<T>(row: CachedEntity): T {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending
    ? (JSON.parse(row.pending) as Record<string, unknown>)
    : null;

  return {
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  } as T;
}

export interface ListFilters {
  workspaceId?: string;
  folderId?: string;
  kind?: ListKind;
}

export function useLists(filters: ListFilters = {}) {
  const [lists, setLists] = useState<List[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { workspaceId, folderId, kind } = filters;

  const load = useCallback(async () => {
    const store = await getLocalStoreReady();
    const rows = await store.listCached("list");

    const visible = rows
      // With the defaults filled in: a list cached by a build that predates
      // `tagColors` arrives with no key at all, and every colour read would be
      // reading `undefined` from it.
      .map((row) => withListDefaults(readRecord<List>(row)))
      .filter((list) => list.deletedAt === null)
      .filter((list) => (workspaceId ? list.workspaceId === workspaceId : true))
      .filter((list) =>
        folderId !== undefined ? list.folderId === folderId : true,
      )
      .filter((list) => (kind ? list.kind === kind : true));

    visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setLists(visible);
    setIsLoading(false);
  }, [folderId, kind, workspaceId]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  const createList = useCallback(
    async (input: {
      workspaceId: string;
      title: string;
      kind: ListKind;
      /** `null` is the space itself, which is the root folder. */
      folderId?: string | null;
      emoji?: string;
    }) => {
      const store = await getLocalStoreReady();
      const id = Crypto.randomUUID();
      const now = new Date().toISOString();

      await store.upsertCached([
        {
          entity: "list",
          entityId: id,
          version: 0,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify({
            id,
            workspaceId: input.workspaceId,
            // A list is never floating: `null` is the space itself, which is the
            // root folder of the tree.
            folderId: input.folderId ?? null,
            kind: input.kind,
            title: input.title,
            description: null,
            emoji: input.emoji ?? null,
            tags: [],
            position: 0,
            version: 0,
            itemCount: 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }),
          pending: null,
        },
      ]);

      await enqueueOperation({
        kind: "create",
        entity: "list",
        entityId: id,
        baseVersion: 0,
        payload: {
          workspaceId: input.workspaceId,
          title: input.title,
          kind: input.kind,
          ...(input.emoji ? { emoji: input.emoji } : {}),
        },
      });

      await load();
      return id;
    },
    [load],
  );

  /**
   * Copies a list and its items into a new one.
   *
   * Local first like any other write: the copy appears immediately and syncs
   * afterwards. The completed state travels with each item, because a list
   * duplicated mid-way through is usually duplicated *with* the progress, and
   * the provider record travels too so a catalog item stays recognisable.
   *
   * The batch is enqueued in order, so the server sees the list before its
   * items. Enqueuing is a single call rather than one per item: a list of a
   * hundred entries would otherwise mean a hundred outbox rows and a hundred
   * round trips.
   */
  const duplicateList = useCallback(
    async (source: List, input?: { title?: string }) => {
      const store = await getLocalStoreReady();
      const listId = Crypto.randomUUID();

      // The rules live in a pure function so they can be tested without a
      // database: which items travel, in what order, and what is not copied.
      const plan = planDuplication(
        {
          id: source.id,
          workspaceId: source.workspaceId,
          folderId: source.folderId,
          kind: source.kind,
          title: source.title,
          description: source.description,
          emoji: source.emoji,
          tags: source.tags,
          position: source.position,
          // A copy of a list sorted by name that came out sorted by hand would
          // be a different list.
          orderMode: source.orderMode,
          // Same for the colours of the labels: a copy whose "Mercadona" comes
          // out in another colour is a list that changed by being duplicated.
          tagColors: source.tagColors,
          // And the same for the columns of a board. The copy gets its own, which
          // is why the ids come from this hook and not from the plan: two lists
          // sharing column ids would have their tasks moved by a rename in
          // either of them.
          states: source.states,
        },
        (await store.listCachedItems(source.id)).map((row) =>
          readRecord<ListItem>(row),
        ),
        {
          newListId: listId,
          newItemId: () => Crypto.randomUUID(),
          newStateId: () => Crypto.randomUUID(),
          now: nowIso(),
          ...(input?.title ? { title: input.title } : {}),
        },
      );

      await store.upsertCached([
        {
          entity: "list",
          entityId: listId,
          version: 0,
          updatedAt: plan.list.updatedAt,
          deletedAt: null,
          payload: JSON.stringify(plan.list),
          pending: null,
        },
        ...plan.items.map((item) => ({
          entity: "list_item" as const,
          entityId: item.id,
          version: 0,
          updatedAt: item.updatedAt,
          deletedAt: null,
          payload: JSON.stringify(item),
          pending: null,
        })),
      ]);

      // Which fields travel is not decided here. It is decided next to the plan
      // that produced them, where a test can read it, because a projection of the
      // plan written inside the hook is a projection nothing can check and the
      // first field nobody remembers to add is the one that comes back missing.
      const payloads = duplicationPayloads(plan);

      await enqueueOperation({
        kind: "create",
        entity: "list",
        entityId: listId,
        baseVersion: 0,
        payload: payloads.list,
      });

      if (plan.items.length > 0) {
        // One batch, in order: the server rejects an item whose list is not
        // there yet, and a hundred entries would otherwise mean a hundred
        // outbox rows.
        await enqueueOperations(
          payloads.items.map(({ id, payload }) => ({
            kind: "create" as const,
            entity: "list_item" as const,
            entityId: id,
            baseVersion: 0,
            payload,
          })),
        );
      }

      await load();
      return listId;
    },
    [load],
  );

  const deleteList = useCallback(
    async (list: List) => {
      const store = await getLocalStoreReady();
      const cached = await store.getCached("list", list.id);

      if (cached) {
        await store.upsertCached([
          {
            ...cached,
            deletedAt: nowIso(),
            updatedAt: nowIso(),
            pending: JSON.stringify({ deletedAt: nowIso() }),
          },
        ]);
      }

      await enqueueOperation({
        kind: "delete",
        entity: "list",
        entityId: list.id,
        baseVersion: cached?.version ?? list.version,
        payload: null,
      });

      await load();
    },
    [load],
  );

  /**
   * How the list is read.
   *
   * It is a property of the list and not of the person, so everyone looking at
   * a shared list sees the same order, which is the only way a list somebody
   * else arranged still means something to you. Changing it renumbers nothing:
   * the manual order is kept and is what the list goes back to.
   */
  const setOrderMode = useCallback(
    async (list: List, orderMode: ListOrderMode) => {
      await localUpdate("list", list.id, { orderMode });
      await load();
    },
    [load],
  );

  /**
   * The colour of one of this list's labels, for every task that carries it.
   *
   * A property of the list and not of the task, which is why the write lands on
   * the list: one write recolours every row that has the label, and no task is
   * touched at all.
   *
   * Local-first like every other write here — the label repaints from the cache
   * at once and the operation waits in the outbox, so choosing a colour on a
   * train is a colour when the train stops.
   */
  const setTagColor = useCallback(
    async (list: List, tag: string, color: ItemIconColor | null) => {
      // `?? {}` because a list that did not come through `withListDefaults`
      // arrives with no `tagColors` key at all, and a list with no colours
      // chosen is a map with nothing in it.
      await localUpdate("list", list.id, {
        tagColors: planTagColorChange(list.tagColors ?? {}, tag, color),
      });
      await load();
    },
    [load],
  );

  /**
   * Changes what a list is called and what it says about itself.
   *
   * The same write as everything else, local first and into the outbox, so a
   * rename made on a train is a rename when the train stops.
   */
  const updateList = useCallback(
    async (
      list: List,
      changes: {
        title?: string;
        description?: string | null;
        emoji?: string | null;
      },
    ) => {
      await localUpdate("list", list.id, changes);
      await load();
    },
    [load],
  );

  return {
    lists,
    isLoading,
    createList,
    deleteList,
    duplicateList,
    updateList,
    setOrderMode,
    setTagColor,
    reload: load,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * What the list already has of each provider id: **whether it is there, and
 * whether it has been seen**.
 *
 * **This exists because `useListItems` cannot answer the question.** That hook
 * reads the list through `showCompleted`, so with the completed ones hidden a film
 * somebody has already watched is not in its `items` — and a catalogue search that
 * decided "you already have this" from it would happily let a watched film be
 * added a second time. Asking a store that is also the list you are looking at for
 * "what is in this list" is the kind of question that gets a yes for the wrong
 * reason.
 *
 * So it reads the list itself, always whole, and answers with a `Map` because the
 * question is asked once per search result and an array does that in linear time
 * each time. **A `Map` and not the `Set` this used to be**, because the ribbon in
 * the corner of a poster needs the second half of the answer: knowing that a film
 * is in the list does not say whether the eye on the corner is open or shut, and a
 * hook that can only answer the first half is a hook the caller has to go around.
 *
 * It answers for **one** list, which is the list the screen is about. A title in
 * two of your lists is in both, and the ribbon follows the list being looked at
 * rather than guessing which of the two wins.
 */
export function useListExternalStates(
  listId: string | undefined,
): Map<string, { completed: boolean }> {
  const [states, setStates] = useState<Map<string, { completed: boolean }>>(new Map());

  const load = useCallback(async () => {
    if (!listId) {
      setStates(new Map());
      return;
    }
    const store = await getLocalStoreReady();
    const rows = await store.listCachedItems(listId, { includeCompleted: true });
    const next = new Map<string, { completed: boolean }>();
    for (const row of rows) {
      const record = readRecord<ListItem>(row);
      if (typeof record.externalId !== "string" || record.externalId.length === 0) continue;
      // A title twice in one list is not a thing the app allows, and if it
      // happened the seen state of the first row is as good an answer as any.
      if (!next.has(record.externalId)) {
        next.set(record.externalId, { completed: record.completed === true });
      }
    }
    setStates(next);
  }, [listId]);

  useEffect(() => {
    void load();
    // The store is what changes here, not a prop: another screen adds a row or
    // ticks one off and this screen has to know without being told.
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return states;
}

/**
 * Just the ids, for the callers that only need to know "is it there".
 *
 * A `Set` because that is the question being asked — a lock on a search result and
 * a line in a menu — and a `Map` would make every one of those callers reach into
 * it for a key.
 */
export function useListExternalIds(listId: string | undefined): Set<string> {
  const states = useListExternalStates(listId);
  return useMemo(() => new Set(states.keys()), [states]);
}

export function useListItems(listId: string | undefined) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(true);

  const load = useCallback(async () => {
    if (!listId) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    const store = await getLocalStoreReady();
    // The store narrows to this list and orders by position, so opening a list
    // of five hundred items no longer parses every cached item in the app.
    const rows = await store.listCachedItems(listId, {
      includeCompleted: showCompleted,
    });

    const visible = rows
      // With the defaults filled in: a row written by an older build, or by a
      // client that sends only what it knows, is read with what the contract
      // says a missing field is, and not trusted to have all of them.
      .map((row) => withListItemDefaults(readRecord<ListItem>(row)))
      .sort(
        (a, b) =>
          a.position - b.position || a.createdAt.localeCompare(b.createdAt),
      );

    setItems(visible);
    setIsLoading(false);
  }, [listId, showCompleted]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  /**
   * Add an item, **and refuse to add one that is already there**.
   *
   * This is the function both catalog paths go through — the `+` in the catalog
   * search and the `+` on a related title in a detail — and **neither of them
   * checked anything**: two films from the same list of recommended ones, tapped
   * twice, were two rows. `planAddToList` has been in the codebase the whole time
   * and answers exactly this, so it is called here rather than written again.
   *
   * **It says what happened** instead of returning an id that may or may not be
   * real, because the callers need to tell somebody "you already have it" and an
   * `undefined` is not an answer they can show. A hand written row has no
   * `externalId` and is never a duplicate of anything: two rows called "leche" are
   * two things somebody meant to buy, and a checklist that refuses the second one
   * is a checklist that has thrown away a note.
   */
  const addItem = useCallback(
    async (input: {
      title: string;
      priority?: ListItem["priority"];
      /** Provider record, when the title came from a catalog. */
      externalId?: string | null;
      metadata?: Record<string, unknown> | null;
      /** The rest of what the item panel offers, when it created the row. */
      annotation?: string | null;
      icon?: ListItem["icon"];
      iconStyle?: ListItem["iconStyle"];
      iconColor?: ListItem["iconColor"];
      tags?: string[];
    }): Promise<{ added: boolean; itemId: string | null }> => {
      if (!listId) return { added: false, itemId: null };

      const store = await getLocalStoreReady();
      const existing = (await store.listCachedItems(listId)).map((row) =>
        readRecord<ListItem>(row),
      );

      const plan = planAddToList(existing, input);
      if (!plan.added) {
        const yaEsta = existing.find((row) => row.externalId === input.externalId) ?? null;
        return { added: false, itemId: yaEsta?.id ?? null };
      }

      const id = Crypto.randomUUID();
      const now = nowIso();

      // The row is built by the same function that builds a row anywhere else,
      // so a row created from the panel and one created by the catalog have the
      // same fields — and the field added last is not missing from one of them.
      const record = newListItem({
        id,
        listId,
        title: input.title,
        position: existing.length,
        createdAt: now,
        updatedAt: now,
        priority: input.priority,
        annotation: input.annotation ?? null,
        icon: input.icon ?? null,
        iconStyle: input.iconStyle,
        iconColor: input.iconColor,
        tags: input.tags,
        externalId: input.externalId ?? null,
        metadata: input.metadata ?? null,
      });

      await store.upsertCached([
        {
          entity: "list_item",
          entityId: id,
          version: 0,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify(record),
          pending: null,
        },
      ]);

      await enqueueOperation({
        kind: "create",
        entity: "list_item",
        entityId: id,
        baseVersion: 0,
        payload: {
          listId,
          title: input.title,
          position: nextPosition(existing),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.icon ? { icon: input.icon } : {}),
          ...(input.iconStyle ? { iconStyle: input.iconStyle } : {}),
          ...(input.iconColor ? { iconColor: input.iconColor } : {}),
          ...(input.annotation ? { annotation: input.annotation } : {}),
          ...(input.tags?.length ? { tags: input.tags } : {}),
          // The provider id travels with the item so the same title is
          // recognisable later, and so a future import can tell them apart.
          ...(input.externalId ? { externalId: input.externalId } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      });

      await load();
      return { added: true, itemId: id };
    },
    [listId, load],
  );

  const toggleCompleted = useCallback(
    /**
     * Only the two fields it reads, and not a whole row: a search hit has a name
     * and whether it is done, and making it fetch the row to hand it over would
     * be a reason not to let a hit be ticked.
     */
    async (item: { id: string; completed: boolean }) => {
      await localUpdate("list_item", item.id, { completed: !item.completed });
      await load();
    },
    [load],
  );

  /**
   * Moves an item by a number of places and renumbers the list.
   *
   * A drag knows where the row landed, not how far it travelled, so the caller
   * converts one into the other. Everything else is the same write.
   *
   * Every affected position is enqueued, not just the two that swapped: the
   * server treats position as a field it merges on, and a partial update would
   * leave the other devices with a different order and no way to tell why.
   */
  const moveItemTo = useCallback(
    async (itemId: string, delta: number) => {
      if (!listId) return;
      const store = await getLocalStoreReady();
      const current = (await store.listCachedItems(listId)).map((row) =>
        readRecord<ListItem>(row),
      );

      const ordered = reorderItems(current, itemId, delta);
      const before = new Map(current.map((item) => [item.id, item.position]));
      const changed = ordered.filter(
        (item) => before.get(item.id) !== item.position,
      );

      // Out of range: nothing moved, and nothing is written.
      if (changed.length === 0) return;

      const now = nowIso();
      await store.upsertCached(
        changed.map((item) => ({
          entity: "list_item" as const,
          entityId: item.id,
          version: item.version,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify({
            ...item,
            position: item.position,
            updatedAt: now,
          }),
          pending: JSON.stringify({ position: item.position }),
        })),
      );

      await enqueueOperations(
        changed.map((item) => ({
          kind: "update" as const,
          entity: "list_item" as const,
          entityId: item.id,
          baseVersion: item.version,
          // Sent as the previous value, so a concurrent edit on another device
          // merges instead of overwriting: position did not change there.
          base: { position: before.get(item.id) ?? item.position },
          payload: { position: item.position },
        })),
      );

      await load();
    },
    [listId, load],
  );

  const moveItem = useCallback(
    (itemId: string, delta: number) => moveItemTo(itemId, delta),
    [moveItemTo],
  );

  /**
   * Changes the fields of a row that are not its title or whether it is done.
   *
   * The icon and the labels are written the same way as everything else, local
   * first and into the outbox, so they work on a train and sync on their own.
   *
   * "Whether it is done" is `toggleCompleted` and not `stateId`: they are two
   * different things that the word "state" used to be ambiguous about.
   */
  const updateItem = useCallback(
    async (
      item: ListItem,
      changes: {
        icon?: ListItem["icon"];
        /** Filled or outline, and which of the colours the app offers. */
        iconStyle?: ListItem["iconStyle"];
        iconColor?: ListItem["iconColor"];
        tags?: string[];
        /** The name, the description and how urgent it is. */
        title?: string;
        annotation?: string | null;
        priority?: Priority;
        /**
         * The board column this row moves to.
         *
         * In the signature and not in the body because nothing else in the app
         * writes it yet: a board cannot be dragged until the board screen is
         * there, and by then the only proof this field exists is that the
         * compiler lets the drag compile.
         */
        stateId?: string | null;
      },
    ) => {
      if (!listId) return;
      const store = await getLocalStoreReady();
      const now = nowIso();

      await localUpdate("list_item", item.id, changes);

      // The cache is written too, because `localUpdate` only records what is
      // pending and the row that renders comes from the cached payload.
      const row = await store.getCached("list_item", item.id);
      if (!row) return;
      const record = readRecord<ListItem>(row);
      await store.upsertCached([
        {
          ...row,
          updatedAt: now,
          payload: JSON.stringify({ ...record, ...changes, updatedAt: now }),
        },
      ]);
      await load();
    },
    [listId, load],
  );

  /**
   * Adds a title to a list, whichever one it is.
   *
   * Adding to another list from the menu of a title is the same write as adding
   * to the one you are looking at, so it is the same function: one way to
   * create an item, and the outbox and the cache behave the same in both.
   *
   * A title already in that list is not added again. The same film in two lists
   * of films is a mistake, and a person choosing from a menu of lists is not
   * asking to be told they already have it.
   */
  const addItemTo = useCallback(
    async (
      input: {
        title: string;
        externalId?: string | null;
        metadata?: Record<string, unknown> | null;
      },
      targetListId: string,
    ) => {
      const store = await getLocalStoreReady();
      const existing = (await store.listCachedItems(targetListId)).map((row) =>
        readRecord<ListItem>(row),
      );

      const plan = planAddToList(existing, input);
      if (!plan.added) {
        return {
          added: false,
          itemId:
            existing.find((item) => item.externalId === input.externalId)?.id ??
            null,
        };
      }

      const id = Crypto.randomUUID();
      const now = nowIso();
      const position = nextPosition(existing);

      const item = newListItem({
        id,
        listId: targetListId,
        title: input.title,
        position,
        createdAt: now,
        updatedAt: now,
        ...(input.externalId !== undefined
          ? { externalId: input.externalId }
          : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });

      await store.upsertCached([
        {
          entity: "list_item",
          entityId: id,
          version: 0,
          updatedAt: now,
          deletedAt: null,
          payload: JSON.stringify(item),
          pending: null,
        },
      ]);

      await enqueueOperation({
        kind: "create",
        entity: "list_item",
        entityId: id,
        baseVersion: 0,
        payload: {
          listId: targetListId,
          title: input.title,
          position,
          ...(input.externalId ? { externalId: input.externalId } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      });

      return { added: true, itemId: id };
    },
    [],
  );

  const removeItem = useCallback(
    async (item: ListItem) => {
      const store = await getLocalStoreReady();
      const cached = await store.getCached("list_item", item.id);

      if (cached) {
        await store.upsertCached([
          {
            ...cached,
            deletedAt: nowIso(),
            updatedAt: nowIso(),
            pending: null,
          },
        ]);
      }

      await enqueueOperation({
        kind: "delete",
        entity: "list_item",
        entityId: item.id,
        baseVersion: cached?.version ?? item.version,
        payload: null,
      });

      await load();
    },
    [load],
  );

  return {
    items,
    isLoading,
    showCompleted,
    setShowCompleted,
    addItem,
    toggleCompleted,
    moveItem,
    moveItemTo,
    addItemTo,
    updateItem,
    removeItem,
  };
}

/**
 * Global search over the local cache, so it works with no connection. The
 * server search (GET /search) is the online half; this is the offline one, and
 * both return the same shape.
 */
export function useLocalSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const search = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim().toLowerCase();
    if (query.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const store = await getLocalStoreReady();
    const [workspaces, folders, lists, items, notes] = await Promise.all([
      store.listCached("workspace"),
      store.listCached("folder"),
      store.listCached("list"),
      store.listCached("list_item"),
      store.listCached("note"),
    ]);

    const workspacesById = new Map(
      workspaces.map((row) => [
        row.entityId,
        readRecord<{ name: string }>(row),
      ]),
    );

    const found: SearchResult[] = [];

    for (const row of workspaces) {
      const record = readRecord<List & { name: string; id: string }>(row);
      if (record.deletedAt !== null) continue;
      if (!record.name?.toLowerCase().includes(query)) continue;
      found.push({
        scope: "workspace",
          completed: null,
        id: record.id,
        workspaceId: record.id,
        listId: null,
        kind: null,
        title: record.name,
        subtitle: record.description ?? null,
        updatedAt: record.updatedAt,
      });
    }

    for (const row of folders) {
      const record = readRecord<{
        name: string;
        id: string;
        workspaceId: string;
        updatedAt: string;
        deletedAt: string | null;
      }>(row);
      if (record.deletedAt !== null) continue;
      if (!record.name?.toLowerCase().includes(query)) continue;
      found.push({
        scope: "folder",
          completed: null,
        id: record.id,
        workspaceId: record.workspaceId,
        listId: null,
        kind: null,
        title: record.name,
        subtitle: workspacesById.get(record.workspaceId)?.name ?? null,
        updatedAt: record.updatedAt,
      });
    }

    for (const row of lists) {
      const record = readRecord<List>(row);
      if (record.deletedAt !== null) continue;
      if (!record.title.toLowerCase().includes(query)) continue;
      found.push({
        scope: "list",
          completed: null,
        id: record.id,
        workspaceId: record.workspaceId,
        listId: record.id,
        kind: record.kind,
        title: record.title,
        subtitle: record.description,
        updatedAt: record.updatedAt,
      });
    }

    const listsById = new Map(
      lists.map((row) => [row.entityId, readRecord<List>(row)]),
    );

    for (const row of items) {
      const record = readRecord<ListItem>(row);
      if (record.deletedAt !== null) continue;
      if (!record.title.toLowerCase().includes(query)) continue;

      const list = listsById.get(record.listId);
      found.push({
        scope: "list_item",
        id: record.id,
        workspaceId: list?.workspaceId ?? null,
        listId: record.listId,
        kind: list?.kind ?? null,
        title: record.title,
        // The parent list is the context a hit needs to be understandable.
        subtitle: list?.title ?? null,
        // So the hit can be ticked from the search itself, which is the whole
        // reason somebody is looking for "milk" a second time.
        completed: record.completed,
        updatedAt: record.updatedAt,
      });
    }

    for (const row of notes) {
      const record = readRecord<Note>(row);
      if (record.deletedAt !== null) continue;
      // The body as well as the title, because a note is searched by what is
      // written inside it. `plain_text` is what the server derived, and a cached
      // note that has never been pushed has it derived locally, so both are here.
      const inTitle = record.title.toLowerCase().includes(query);
      const inBody = record.plainText.toLowerCase().includes(query);
      if (!inTitle && !inBody) continue;

      found.push({
        scope: "note",
        id: record.id,
        workspaceId: record.workspaceId,
        // A note is not in a list, so there is nothing to point at. Null and not
        // the note's own id, which would make the app try to open a list that
        // does not exist.
        listId: null,
        kind: null,
        title: record.title,
        subtitle: notePreviewBelowTitle(record.document, record.title) || null,
        // A note is not a row, so there is nothing to tick. Null and not false,
        // because false would draw an empty checkbox next to a document.
        completed: null,
        updatedAt: record.updatedAt,
      });
    }

    found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setResults(found.slice(0, 50));
    setIsSearching(false);
  }, []);

  useEffect(() => subscribeToLocalStore(() => undefined), []);

  const grouped = useMemo(() => {
    return {
      workspaces: results.filter((item) => item.scope === "workspace"),
      lists: results.filter((item) => item.scope === "list"),
      items: results.filter((item) => item.scope === "list_item"),
      folders: results.filter((item) => item.scope === "folder"),
      notes: results.filter((item) => item.scope === "note"),
    };
  }, [results]);

  return { results, grouped, isSearching, search };
}

/** Pull everything the user can see and refresh the cache. */
export function useContentSync() {
  return useCallback(async (options: { full?: boolean } = {}) => {
    const workspaces = await readCachedWorkspaces();
    await pullIntoCache(options);
    return workspaces;
  }, []);
}
