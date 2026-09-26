import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import type { ListItem, ListOrderMode } from "@orbit-hub/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import {
  FiltersSheet,
  IconPickerSheet,
  ItemIcon,
} from "@/components/lists/item-picker";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { DraggableRow } from "@/components/ui/draggable-row";
import { MediaCarousel } from "@/components/ui/media-carousel";
import { Screen } from "@/components/ui/screen";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useListItems, useLists } from "@/hooks/use-lists";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useTranslation } from "@/lib/i18n";
import {
  canReorder,
  filterItems,
  orderItems,
  tagsByFrequency,
} from "@/lib/lists/item-presentation";
import { isMediaList, mediaCardOf } from "@/lib/lists/media-card";
import { useTheme } from "@/theme";
import type { Crumb } from "@/components/ui/breadcrumbs";

/** The orders a list can be read in, in the order they are offered. */
const ORDER_MODES: ListOrderMode[] = [
  "manual",
  "alphabetical",
  "alphabetical_desc",
  "created_desc",
  "created_asc",
  "updated_desc",
  "priority",
];

const PRIORITY_TONE = {
  none: "neutral",
  low: "info",
  medium: "warning",
  high: "danger",
} as const;

export default function ListScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { listId } = useLocalSearchParams<{ listId: string }>();

  const { lists, deleteList, duplicateList, toggleFavorite, setOrderMode } =
    useLists({});
  const list = useMemo(
    () => lists.find((item) => item.id === listId) ?? null,
    [lists, listId],
  );
  const { workspaces } = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.find((item) => item.id === list?.workspaceId) ?? null,
    [workspaces, list?.workspaceId],
  );
  const { folders } = useFolders(list?.workspaceId);
  const folder = useMemo(
    () => folders.find((item) => item.id === list?.folderId) ?? null,
    [folders, list?.folderId],
  );
  const {
    items,
    isLoading,
    showCompleted,
    setShowCompleted,
    addItem,
    toggleCompleted,
    moveItemTo,
    updateItem,
    removeItem,
  } = useListItems(listId);

  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<ListItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterState, setFilterState] = useState<"all" | "pending" | "done">(
    "all",
  );
  const [filterText, setFilterText] = useState("");
  const [iconFor, setIconFor] = useState<ListItem | null>(null);
  const [tagsFor, setTagsFor] = useState<ListItem | null>(null);
  const [newTag, setNewTag] = useState("");
  const [duplicating, setDuplicating] = useState(false);

  /**
   * Tasks are split into pending and completed rather than filtered, so the
   * shape of the list says what is left to do. A media list never mixes in a
   * hand written row: the carousel is the list.
   */
  const media = isMediaList(list?.kind);
  /**
   * What the list is showing, and in what order.
   *
   * The order is read from the list and never writes to it: choosing an order to
   * look at something is not a way of losing the order it was in. That is why
   * the drag only exists under the manual order, because a row moved while the
   * list is alphabetical lands somewhere the order did not ask for and the next
   * re-sort puts it back where it was.
   */
  const orderMode = list?.orderMode ?? "manual";
  const sorted = useMemo(
    () => orderItems(items, orderMode),
    [items, orderMode],
  );
  const visible = useMemo(
    () =>
      filterItems(sorted, {
        tags: selectedTags,
        completed: filterState,
        text: filterText,
      }),
    [sorted, selectedTags, filterState, filterText],
  );
  const labels = useMemo(() => tagsByFrequency(items), [items]);

  const pending = useMemo(
    () => visible.filter((item) => !item.completed),
    [visible],
  );
  const completed = useMemo(
    () => visible.filter((item) => item.completed),
    [visible],
  );
  const isFiltered =
    selectedTags.length > 0 ||
    filterState !== "all" ||
    filterText.trim().length > 0;
  const activeFilterCount =
    selectedTags.length +
    (filterState === "all" ? 0 : 1) +
    (filterText.trim() ? 1 : 0);
  const canDrag = canReorder(orderMode);

  /**
   * One flat array for the list, with the heading of the completed section as an
   * entry of its own.
   *
   * Two sections in one scroller is what a list of a few hundred rows needs and
   * a FlatList is the only thing that renders a fraction of it. The heading is a
   * row rather than a second list, because two lists in one scroll view means
   * two windows to keep in step, and the completed rows are simply the tail of
   * the same one.
   */
  const entries = useMemo<ListEntry[]>(() => {
    // A media list is the carousel and nothing else. Painting its items as
    // checkboxes underneath is the mixing the two kinds are supposed to avoid:
    // a film with a checkbox is a task, and the carousel is the list.
    if (media) return [];

    const rows: ListEntry[] = pending.map((item, index) => ({
      kind: "row",
      item,
      index,
    }));
    if (completed.length > 0) {
      rows.push({ kind: "completedHeading" });
      if (showCompleted) {
        completed.forEach((item, index) =>
          rows.push({ kind: "row", item, index }),
        );
      }
    }
    return rows;
  }, [pending, completed, showCompleted, media]);

  /** Media lists show the carousel; anything else shows the task rows. */
  const carouselItems = useMemo(
    () =>
      media
        ? items.map((item) => {
            const card = mediaCardOf(item);
            return {
              key: item.id,
              title: item.title,
              imageUrl: card?.imageUrl ?? null,
              released: card?.released ?? null,
              badge:
                list?.kind === "books"
                  ? t("itemDetails.book")
                  : card?.mediaKind === "tv"
                    ? t("itemDetails.series")
                    : t("itemDetails.movie"),
              completed: item.completed,
              onPress: () => openDetails(item),
              onMenu: () => setMenuFor(item),
            };
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, media, list?.kind, t, toggleCompleted],
  );

  const kindLabel = t(
    list?.kind === "movies"
      ? "lists.kindMovies"
      : list?.kind === "books"
        ? "lists.kindBooks"
        : "lists.kindTasks",
  );

  // The header carries the name of the list, so the screen only says what kind
  // of list it is and where it lives.
  useScreenTitle(list?.title ?? t("lists.notFound"));

  const crumbs = useMemo(() => {
    const rows: Crumb[] = [];
    if (workspace)
      rows.push({
        label: workspace.name,
        href: `/(app)/workspace/${workspace.id}`,
      });
    if (folder)
      rows.push({
        label: folder.name,
        href: `/(app)/workspace/${workspace?.id}`,
      });
    rows.push({ label: list?.title ?? t("lists.notFound") });
    return rows;
  }, [workspace, folder, list?.title, t]);

  /**
   * Opens the detail of a title.
   *
   * The kind comes from the item, not from the list. A list of films and series
   * holds both, and asking the server for a film with the id of a series is how
   * a detail came back with no title at all.
   */
  function openDetails(item: ListItem) {
    const card = mediaCardOf(item);
    router.push({
      pathname: "/(app)/item/[itemId]",
      params: {
        // Which list it is in, so the detail can take it out of it.
        itemId: listId,
        // Which row of that list it is, so the detail can tick it off.
        itemKey: item.id,
        kind:
          card?.mediaKind === "tv"
            ? "tv"
            : list?.kind === "books"
              ? "books"
              : "movies",
        externalId: item.externalId ?? "",
        title: item.title,
      },
    });
  }

  async function onAdd() {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    setAdding(true);
    try {
      await addItem({ title: trimmed });
      setTitle("");
    } finally {
      setAdding(false);
    }
  }

  if (!listId) {
    return (
      <Screen>
        <EmptyState title={t("lists.notFound")} />
      </Screen>
    );
  }

  /**
   * One row of the flat list.
   *
   * A task carries its own index inside its own section, because that is the
   * number a drag needs: the completed rows are the tail of the same array, so
   * the index in the array would be off by however many tasks are already done.
   */
  /** Adds the typed label to the row, and never adds the same one twice. */
  const addNewTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed || !tagsFor) return;
    if (tagsFor.tags.includes(trimmed)) {
      setNewTag("");
      return;
    }
    const next = [...tagsFor.tags, trimmed];
    void updateItem(tagsFor, { tags: next });
    setTagsFor({ ...tagsFor, tags: next });
    setNewTag("");
  };

  const renderEntry = ({ item: entry }: { item: ListEntry }) => {
    if (entry.kind === "completedHeading") {
      return (
        <View style={{ paddingVertical: theme.spacing.xs }}>
          <Checkbox
            checked={showCompleted}
            onToggle={() => setShowCompleted((value) => !value)}
            label={t("lists.completedSection", { count: completed.length })}
          />
        </View>
      );
    }

    const { item, index } = entry;
    const row = (
      <TaskRow
        item={item}
        onToggle={() => void toggleCompleted(item)}
        onRemove={() => void removeItem(item)}
        onIcon={() => setIconFor(item)}
        onTags={() => setTagsFor(item)}
      />
    );

    // A row cannot be dragged while the list is read in another order: it would
    // land somewhere the order did not ask for, and the next re-sort would put
    // it back, which looks like the drag did nothing.
    if (!canDrag) return row;

    return (
      <DraggableRow
        id={item.id}
        index={index}
        total={entry.item.completed ? completed.length : pending.length}
        onReorder={(movedId, toIndex) => {
          const section = completed.some((row) => row.id === movedId)
            ? completed
            : pending;
          const from = section.findIndex((row) => row.id === movedId);
          // The drag already knows where the row landed, so the write is one
          // reorder and not a chain of single steps.
          if (from !== -1) void moveItemTo(movedId, toIndex - from);
        }}
      >
        {row}
      </DraggableRow>
    );
  };

  /**
   * Everything above the rows, and the state that decides what the rows are.
   *
   * A FlatList owns the scroll, so the page cannot also be a ScrollView: two
   * vertical scrollers in one screen fight each other, and the list would have
   * to guess where it sits inside the other one. The header and the actions
   * below the rows are its header and its footer, which is the only arrangement
   * that keeps the page reading as one screen.
   */
  const header = (
    <View style={[styles.header, { gap: theme.spacing.sm }]}>
      <View style={styles.headerTop}>
        <View style={[styles.flex, { gap: theme.spacing.xxs }]}>
          {/* The header carries the name of the list; this says what kind of
              list it is and where it lives. */}
          <Breadcrumbs crumbs={crumbs} />
          {/* A list called "Tareas" of kind tasks does not need to be told twice
              what it is. */}
          {kindLabel !== list?.title ? (
            <AppText variant="caption" tone="muted">
              {kindLabel}
            </AppText>
          ) : null}
        </View>
        {list ? (
          <Button
            label={list.favorite ? t("lists.unfavorite") : t("lists.favorite")}
            variant="ghost"
            size="sm"
            icon={list.favorite ? "bookmark" : "bookmark-outline"}
            fullWidth={false}
            onPress={() => void toggleFavorite(list)}
          />
        ) : null}
      </View>

      {items.length > 0 ? (
        <View style={styles.badges}>
          {completed.length > 0 ? (
            <Badge
              label={t("lists.completedCount", { count: completed.length })}
              tone="success"
            />
          ) : null}
          <Badge label={t("lists.pendingCount", { count: pending.length })} />
        </View>
      ) : null}

      {isLoading ? (
        <Card variant="muted">
          <AppText variant="callout" tone="muted" align="center">
            {t("common.loading")}
          </AppText>
        </Card>
      ) : items.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title={t("items.empty.title")}
            description={t("items.empty.body")}
          />
        </Card>
      ) : media ? (
        /* Films and books: a carousel of covers, never mixed with plain rows. */
        <MediaCarousel items={carouselItems} />
      ) : null}

      {/* The two knobs over a list: what it shows and how it is read. They are
          buttons and not a row of chips because a shopping list has a dozen
          labels and a row of them would take more space than the items. */}
      {!media && !isLoading && items.length > 0 ? (
        <View style={[styles.toolbar, { gap: theme.spacing.sm }]}>
          <Button
            label={
              isFiltered
                ? t("filters.titleOn", { count: activeFilterCount })
                : t("filters.title")
            }
            icon="funnel-outline"
            size="sm"
            variant={isFiltered ? "primary" : "secondary"}
            fullWidth={false}
            onPress={() => setFiltersOpen(true)}
          />
          <Button
            label={t(`order.${orderMode}`)}
            icon="swap-vertical-outline"
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setOrderOpen(true)}
          />
        </View>
      ) : null}

      {!canDrag && !media ? (
        <AppText variant="caption" tone="subtle">
          {t("order.readOnlyHint")}
        </AppText>
      ) : null}

      {!media && !isLoading && items.length > 0 && pending.length === 0 ? (
        <Card variant="muted">
          <AppText variant="callout" tone="success" align="center">
            {t("lists.allDone")}
          </AppText>
        </Card>
      ) : null}
    </View>
  );

  const footer = (
    <View style={{ gap: theme.spacing.lg }}>
      {/* A media list has nothing to type: its items come from a catalog, so the
          form would only invite a title that then has no poster. */}
      {!media ? (
        <Card variant="muted" style={{ gap: theme.spacing.md }}>
          <AppText variant="callout" tone="muted">
            {t("items.createHint")}
          </AppText>
          <TextField
            label={t("items.titleLabel")}
            value={title}
            onChangeText={setTitle}
            placeholder={t("items.titlePlaceholder")}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={() => void onAdd()}
          />
          <Button
            label={t("items.add")}
            icon="add"
            onPress={() => void onAdd()}
            loading={adding}
            disabled={title.trim().length === 0}
          />
        </Card>
      ) : null}

      {/* The catalog needs the network, so this is the one way of adding a
          title that does not work on a plane. Type it by hand there and search
          once you land. */}
      <Button
        label={t("catalog.addFromCatalog")}
        variant={media ? "primary" : "secondary"}
        icon="search-outline"
        onPress={() => router.push(`/(app)/catalog?listId=${listId}`)}
      />

      {list ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t("lists.duplicate")}
            variant="secondary"
            icon="copy-outline"
            loading={duplicating}
            onPress={() => {
              setDuplicating(true);
              void duplicateList(list)
                .then((newId) => {
                  // Straight into the copy: the point of duplicating is to work
                  // on it, not to go looking for it.
                  router.replace(`/(app)/list/${newId}`);
                })
                .finally(() => setDuplicating(false));
            }}
          />
          <Button
            label={t("lists.delete")}
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              void deleteList(list);
              router.back();
            }}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={entryKey}
        renderItem={renderEntry}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={[
          styles.content,
          {
            padding: theme.spacing.lg,
            paddingBottom: theme.spacing.xxl,
            gap: theme.spacing.sm,
          },
        ]}
        // Rows are measured rather than assumed, and a row is not tall: a few
        // screens of rows is plenty, and rendering more of them is what makes a
        // long list feel heavy.
        initialNumToRender={14}
        windowSize={7}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={60}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      {/* What can be done with a film, a series or a book. It lives here and in
          the detail and nowhere else, because two lists of the same handful of
          actions is how they stop agreeing. */}
      <MediaActionsSheet
        item={menuFor}
        listId={listId}
        listKind={list?.kind ?? "movies"}
        onClose={() => setMenuFor(null)}
      />

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        tags={labels}
        selectedTags={selectedTags}
        onToggleTag={(tag) =>
          setSelectedTags((current) =>
            current.includes(tag)
              ? current.filter((row) => row !== tag)
              : [...current, tag],
          )
        }
        completed={filterState}
        onCompleted={setFilterState}
        text={filterText}
        onText={setFilterText}
        activeCount={activeFilterCount}
        onReset={() => {
          setSelectedTags([]);
          setFilterState("all");
          setFilterText("");
        }}
      />

      <Sheet
        visible={orderOpen}
        onClose={() => setOrderOpen(false)}
        title={t("order.title")}
        subtitle={t("order.hint")}
        scrollable={false}
      >
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <SheetOptions
            options={ORDER_MODES.map((mode) => ({
              key: mode,
              label: t(`order.${mode}`),
              icon:
                mode === "manual"
                  ? "hand-left-outline"
                  : "swap-vertical-outline",
              tone:
                orderMode === mode ? ("accent" as const) : ("default" as const),
              onPress: () => {
                setOrderOpen(false);
                if (list) void setOrderMode(list, mode);
              },
            }))}
          />
        </View>
      </Sheet>

      <IconPickerSheet
        open={iconFor !== null}
        onClose={() => setIconFor(null)}
        value={iconFor?.icon ?? null}
        onPick={(icon) => {
          if (iconFor) void updateItem(iconFor, { icon });
          setIconFor(null);
        }}
      />

      <Sheet
        visible={tagsFor !== null}
        onClose={() => setTagsFor(null)}
        title={t("tags.title")}
        subtitle={tagsFor?.title}
      >
        <View
          style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
        >
          <View style={[styles.toolbar, { gap: theme.spacing.sm }]}>
            {labels.map(({ tag, count }) => (
              <Button
                key={tag}
                label={`${tag} · ${count}`}
                size="sm"
                variant={tagsFor?.tags.includes(tag) ? "primary" : "secondary"}
                fullWidth={false}
                onPress={() => {
                  if (!tagsFor) return;
                  const next = tagsFor.tags.includes(tag)
                    ? tagsFor.tags.filter((row) => row !== tag)
                    : [...tagsFor.tags, tag];
                  void updateItem(tagsFor, { tags: next });
                  setTagsFor({ ...tagsFor, tags: next });
                }}
              />
            ))}
          </View>
          <TextField
            label={t("tags.newLabel")}
            value={newTag}
            onChangeText={setNewTag}
            placeholder={t("tags.newPlaceholder")}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={addNewTag}
          />
          {/* A button and not only the Enter key: on the web the field is not
              in a form, so the key does nothing there, and a feature that
              works on a phone and not on a laptop is a feature half made. */}
          <Button
            label={t("tags.addNew")}
            icon="add"
            variant="secondary"
            disabled={newTag.trim().length === 0}
            onPress={addNewTag}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

/** One row of the flat list: a task, or the heading of the completed section. */
type ListEntry =
  { kind: "row"; item: ListItem; index: number } | { kind: "completedHeading" };

const COMPLETED_HEADING_KEY = "completed-heading";

function entryKey(entry: ListEntry): string {
  return entry.kind === "row" ? entry.item.id : COMPLETED_HEADING_KEY;
}

/** One task row, shared by the pending and the completed sections. */
function TaskRow({
  item,
  onToggle,
  onRemove,
  onIcon,
  onTags,
}: {
  item: import("@orbit-hub/contracts").ListItem;
  onToggle: () => void;
  onRemove: () => void;
  onIcon: () => void;
  onTags: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <View
      style={[
        styles.item,
        { gap: theme.spacing.md, padding: theme.spacing.lg },
      ]}
    >
      {/* The icon is its own target: it is a picture of what to buy, and
          pressing it opens the pictures rather than the row. With no icon there
          is still something to press, or the feature is only found by someone
          who already uses it. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("icons.ofItem", { name: item.title })}
        hitSlop={8}
        onPress={onIcon}
        style={styles.iconSlot}
      >
        <ItemIcon icon={item.icon} />
        {item.icon ? null : (
          <Ionicons name="add" size={14} color={theme.colors.textSubtle} />
        )}
      </Pressable>

      <Checkbox checked={item.completed} onToggle={onToggle} label="" />

      <View style={[styles.flex, { gap: 2 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.title}
          onPress={onRemove}
        >
          <AppText
            variant="body"
            tone={item.completed ? "subtle" : "default"}
            style={item.completed ? styles.strike : undefined}
            numberOfLines={2}
          >
            {item.title}
          </AppText>
        </Pressable>

        {/* The labels go under the name and not beside it: a row is already as
            wide as the screen, a label beside the name is a label cut in half,
            and the drag handle lives on that same edge. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tags.title")}
          hitSlop={6}
          onPress={onTags}
        >
          <AppText
            variant="caption"
            tone={item.tags.length > 0 ? "accent" : "subtle"}
            numberOfLines={1}
          >
            {item.tags.length > 0 ? item.tags.join(" · ") : t("tags.add")}
          </AppText>
        </Pressable>
      </View>

      {item.priority !== "none" ? (
        <Badge
          label={t(`items.priority.${item.priority}`)}
          tone={PRIORITY_TONE[item.priority]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  header: {},
  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  badges: {
    flexDirection: "row",
    gap: 6,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconSlot: {
    width: 24,
    alignItems: "center",
  },
  reorder: {
    flexDirection: "row",
    alignItems: "center",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  hidden: {
    opacity: 0,
  },
  flex: {
    flex: 1,
  },
  strike: {
    textDecorationLine: "line-through",
  },
});
