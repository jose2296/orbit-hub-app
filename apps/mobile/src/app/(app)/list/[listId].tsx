import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, View } from "react-native";

import type {
  ListItem,
  ListOrderMode,
  Priority,
  TagColors,
} from "@orbit-hub/contracts";

import { releaseSharedCover } from "@/lib/media/shared-cover";
import { Badge } from "@/components/ui/badge";
import type { IconName } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { EmptyState } from "@/components/ui/empty-state";
import { DoneTray } from "@/components/lists/done-tray";
import { ItemIcon } from "@/components/lists/icon-picker";
import { MediaListScreen } from "@/components/media/media-list-screen";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { FiltersBody } from "@/components/lists/item-picker";
import { ListControls } from "@/components/lists/list-controls";
import { ItemEditSheet } from "@/components/lists/item-edit-sheet";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { TagChip } from "@/components/lists/tag-chip";
import { Screen } from "@/components/ui/screen";
import { ReorderSheet } from "@/components/ui/reorder-sheet";
import { useLongPressText } from "@/hooks/use-long-press-text";
import { AppText } from "@/components/ui/text";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useListItems, useLists } from "@/hooks/use-lists";
import { useHeaderAction } from "@/components/ui/header-action";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { pluralKey, useTranslation } from "@/lib/i18n";
import {
  canReorder,
  filterItems,
  orderItems,
  tagsByFrequency,
} from "@/lib/lists/item-presentation";
import { isMediaList, mediaCardOf } from "@/lib/lists/media-card";
import { providerRefOf } from "@/lib/lists/provider-ref";
import { useTheme } from "@/theme";

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

/**
 * The glyph each urgency carries in a row, next to the colour.
 *
 * Three shapes that escalate rather than three that are merely different: a ring,
 * a ring with a bang, and a triangle. At ten points the colour is doing half the
 * work — a badge on its own line under a title is small, and two reds at ten
 * points are one red — so the shape is what still says *how* urgent when the
 * colours are not being compared side by side.
 *
 * No `none`: a task with no urgency draws no badge at all, so there is nothing to
 * put a glyph on.
 */
const PRIORITY_ICON: Record<Exclude<Priority, "none">, IconName> = {
  low: "remove-circle-outline",
  medium: "alert-circle-outline",
  high: "warning",
};

export default function ListScreen() {

  /**
   * The orders this list offers, **and the one that is on carries the tick**.
   *
   * It is a function and not an array built once, because the array would close
   * over the order that was on the first render and keep offering that tick for
   * ever after the order changed.
   */
  const opcionesDeOrden = () =>
    ORDER_MODES.map((mode) => ({
      key: mode,
      label: t(`order.${mode}` as never),
      icon:
        mode === "manual"
          ? ("hand-left-outline" as const)
          : ("swap-vertical-outline" as const),
      onPress: () => {
        if (list) void setOrderMode(list, mode);
      },
    }));
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { listId } = useLocalSearchParams<{ listId: string }>();

  const { lists, setOrderMode, setTagColor } = useLists({});
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

  /**
   * The text colours for the band, asked of the space rather than of the theme.
   *
   * Theme text on a space colour is dark on dark half the time, and this band is
   * the one thing on the screen that says which space you are working in.
   */
  // The second colour as well, because it is a choice the person made and a
  // band that leaves it out paints a pair the picker never showed them.
  /*
   * Which of the three ways of naming the space this screen uses.
   *
   * It is a constant and not a preference because it is a decision about the shape
   * of a screen, not about a person: the three answer different questions and only
   * one of them can be true at a time. `dot` says which space, `crumbs` says where
   * you are inside it, and `tint` says only that you are in one.
   *
   * **`tint`, de las tres.** The other two say it well and the tint says it best,
   * and not because it says more: because it says it from the **whole** screen and
   * not from a corner. A dot is read when you look at the dot and a trail is read
   * when you look at the trail, and both live on a screen that is otherwise a list
   * of rows in neutral grey. The tint is the only thing behind the list too, so a
   * glance that never reaches the header still knows which space it is in.
   *
   * The price is that it is a background, and the row asked for none. It is a wash
   * at one part in sixteen with a hairline of the same colour: enough to warm the
   * surface, not enough for the screen to be a colour. And the text keeps the
   * theme's own colours, because a contrast that depends on the space is one that
   * has to be checked against every colour a person is allowed to pick.
   */
  /*
    El menu de la lista vive **en la cabecera de la app** y no en una banda dentro
    de la pantalla. Y no es que se haya mudado de sitio: la banda desaparece, asi
    que el boton que estaba en ella necesitaba un sitio de verdad, y el sitio de
    verdad para las acciones de una pantalla es la cabecera, al lado del titulo y
    del boton de atras. El `testID` es el mismo de antes, a proposito, para que
    las comprobaciones sigan pulsando la misma cosa.
  */
  useHeaderAction(
    () =>
      list ? (
        <Button
          testID="list-menu-button"
          label={t("lists.menu")}
          variant="ghost"
          size="sm"
          icon="ellipsis-horizontal"
          iconOnly
          accessibilityHint={t("lists.menuHint")}
          fullWidth={false}
          onPress={() => setMenuOpen(true)}
        />
      ) : null,
    [list, t],
  );

  useScreenSpace(
    list
      ? { id: list.workspaceId, color: workspace?.color, colorTo: workspace?.colorTo, wash: workspace?.wash }
      : null,
  );;

  const {
    items,
    isLoading,
    showCompleted,
    setShowCompleted,
    toggleCompleted,
    moveItemTo,
  } = useListItems(listId);

  const [menuFor, setMenuFor] = useState<ListItem | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterState, setFilterState] = useState<"all" | "pending" | "done">(
    "all",
  );
  const [filterText, setFilterText] = useState("");
  // Which row is being edited and where the panel opens, and *not* a copy of the
  // row: the panel needs the row as it is now, because it is the one that
  // changes it. A snapshot taken when the panel opened goes stale on the first
  // write, and the panel then paints the previous choice and sends the previous
  // value back — which is how picking an icon and then a colour lost the icon.
  const [editing, setEditing] = useState<{
    /** Empty when the panel is creating a row rather than editing one. */
    itemId: string;
    page: "edit" | "icon" | "tags";
  } | null>(null);
  const editingItem = editing
    ? (items.find((row) => row.id === editing.itemId) ?? null)
    : null;
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * Tasks are split into pending and completed rather than filtered, so the
   * shape of the list says what is left to do. A media list never mixes in a
   * hand written row: the carousel is the list.
   */
  const media = isMediaList(list?.kind);

  // The floating button is a different control on a media list, and the hint
  // says so. Resolved here, in the body and not in the JSX: the id is made once
  // per mount, and the node it points at follows the text.
  const pistaCreate = useA11yHint(
    media ? t("catalog.addFromCatalogHint") : t("itemCreate.titleHint"),
  );
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


  /**
   * Opens the detail of a title.
   *
   * The kind comes from the item, not from the list. A list of films and series
   * holds both, and asking the server for a film with the id of a series is how
   * a detail came back with no title at all.
   */
  function openDetails(item: ListItem) {
    // Which provider to ask comes from the item. A list of films and series
    // holds both, a list of tasks is also where a book somebody typed by hand
    // ends up, and asking the wrong provider returns nothing at all.
    const ref = providerRefOf(item);
    /*
      On the web the move is **inside the browser's own transition**, and that is
      the half of it that is not ours to do.

      The poster and the cover already carry the same name, and that is enough for
      the browser to know they are one picture — but only while a transition is
      running. Without `startViewTransition` the name sits there doing nothing and
      the screen arrives by whatever means it was going to arrive by: a cut, which
      is exactly what it did before.

      **It is a call and not a flag**, so the whole thing is guarded by asking
      whether the call is there. Firefox and Safari have not got it, and on those
      the poster keeps a name nobody uses, the screen arrives the normal way, and
      nothing is broken and nothing is announced. On a phone none of this runs:
      Reanimated's shared transition is drawn by the view system and never goes
      near a document.

      And `push` returns nothing, so the browser waits for the next frame rather
      than for a promise. Whether the route has actually rendered by then is the
      question this has to be measured against: a transition that captures the new
      state too early morphs nothing and reports nothing at all.
    */
    const ir = () =>
      router.push({
        pathname: "/(app)/item/[itemId]",
        params: {
          // Which list it is in, so the detail can take it out of it.
          itemId: listId,
          // Which row of that list it is, so the detail can tick it off. **This is
          // also the shared element's name**, and the poster had already drawn it
          // before the route existed.
          itemKey: item.id,
          // Left empty when the row has no provider record: the detail screen then
          // shows the row itself instead of an error.
          kind: ref?.kind ?? "",
          externalId: ref?.externalId ?? "",
          title: item.title,
          /*
            And the poster, **which is the whole reason this is a link and not only
            a question.**

            Every other parameter here asks something: which provider, which record.
            This one is an answer — the list already had the picture when the finger
            went down — so the detail can draw the same poster on its very first
            frame, with a cold cache, on a phone that has never seen this list.
            Without it the screen waits for the row to arrive from the cache or from
            the API, and until one of those happens there is no poster on screen, and
            a poster that is not on screen cannot be the one a transition arrives at.

            Empty when there is none — a row written by hand has no picture — and the
            detail falls back to the icon it already drew.
          */
          image: mediaCardOf(item)?.imageUrl ?? "",
        },
      });

    if (
      Platform.OS === "web" &&
      typeof document !== "undefined" &&
      typeof document.startViewTransition === "function"
    ) {
      document.startViewTransition(() => {
        /*
          The outgoing poster lets go of the name here, **between** the two
          snapshots and for no other reason. The list screen is still mounted behind
          this one, so in the "after" there would be a poster and a cover with one name
          between them, and the browser refuses to pair a name that is in the document
          twice — silently, with the screen still arriving and the poster simply not
          travelling. See `releaseSharedCover`.
        */
        releaseSharedCover(item.id);
        ir();
      });
      return;
    }
    ir();
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
  const renderEntry = ({ item: entry }: { item: ListEntry }) => {
    if (entry.kind === "completedHeading") {
      return (
        <View style={{ paddingVertical: theme.spacing.xs }}>
          <Checkbox
            checked={showCompleted}
            onToggle={() => setShowCompleted((value) => !value)}
            label={t(pluralKey("lists.completedSection", completed.length), {
              count: completed.length,
            })}
          />
        </View>
      );
    }

    const { item } = entry;
    const row = (
      <TaskRow
        item={item}
        // The map of the list this row is being read out of, exactly as the
        // sheet below it gets it. `?? {}` for the same reason it has it there: a
        // list whose colours have not arrived yet draws its pills in the derived
        // colour, which is what every other device computes for the same name.
        tagColors={list?.tagColors ?? {}}
        onToggle={() => void toggleCompleted(item)}
        // Un toque abre el elemento. Antes el nombre era un boton que BORRABA,
        // sin confirmar y sin vuelta atras: la forma mas mala de perder trabajo
        // que puede tener una lista, y peor que una funcionalidad que falte,
        // porque te enteras cuando ya no lo querias.
        onEdit={() => setEditing({ itemId: item.id, page: "edit" })}
        onIcon={() => setEditing({ itemId: item.id, page: "icon" })}
      />
    );

    /*
      The row, **and no drag on it**.

      It used to be wrapped in a `DraggableRow` here, in a list that could also be
      read by date or by priority: a list you had chosen to read one way could be
      rearranged by dragging, and the row you wanted to move was not where your
      finger was. The order is now a sheet with a handle per row, the same one the
      films use, and this row is a thing you press to open and a thing you press to
      tick.
    */
    return row;
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
          {/* The header carries the name of the list; this says what kind of list
              it is. The trail is the header's now, in the variant that shows it. */}
          {/* A list called "Tareas" of kind tasks does not need to be told twice
              what it is. */}
          {kindLabel !== list?.title ? (
            <AppText variant="caption" tone="muted">
              {kindLabel}
            </AppText>
          ) : null}
        </View>
      </View>


      {items.length > 0 ? (
        <View style={styles.badges}>
          {completed.length > 0 ? (
            <Badge
              label={t(pluralKey("lists.completedCount", completed.length), {
                count: completed.length,
              })}
              tone="success"
            />
          ) : null}
          <Badge
            label={t(pluralKey("lists.pendingCount", pending.length), {
              count: pending.length,
            })}
          />
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
      ) : null}

      {/* The two knobs over a list: what it shows and how it is read. They are
          buttons and not a row of chips because a shopping list has a dozen
          labels and a row of them would take more space than the items. */}
      {/*
        The controls, **and they are one control here too**.

        It was three buttons in a row here and three in a row over the folders and
        three in a row over the films, all answering one question, and opening a
        sheet each. One button whose label says what is on, and one sheet with the
        three things in it, is the same control in the three places — see
        `ListControls`.
      */}
      {!media && !isLoading && items.length > 0 ? (
        <View style={[styles.toolbar, { gap: theme.spacing.sm }]}>
          <ListControls
            filterCount={activeFilterCount}
            orderLabel={t(`orderShort.${orderMode}` as never)}
            orders={opcionesDeOrden()}
            canReorder={canReorder(orderMode)}
            onReorder={() => setReorderOpen(true)}
            testID="task-controls"
          >
            <FiltersBody
              tags={labels}
              selectedTags={selectedTags}
              onToggleTag={(tag) =>
                setSelectedTags((previas) =>
                  previas.includes(tag)
                    ? previas.filter((x) => x !== tag)
                    : [...previas, tag],
                )
              }
              completed={filterState}
              onCompleted={setFilterState}
              text={filterText}
              onText={setFilterText}
              onReset={() => {
                setSelectedTags([]);
                setFilterState("all");
                setFilterText("");
              }}
            />
          </ListControls>
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

  // El pie no lleva acciones. Duplicar y eliminar estan en el menu del header, y
  // un boton rojo de pantalla completa debajo de la lista compite con las filas
  // por el sitio donde el dedo quiere ir.
  const footer = null;

  /*
    A media list is **its own screen**, and not a branch of this one.

    The list of tasks is a `FlatList` of rows inside a scroller, with a header, a
    footer and a drag sort around it. A list of films is a full-screen vertical
    carousel with one poster per screen. Putting the second inside the first
    meant a carousel whose height was whatever was left under a header that only
    exists for the other kind of list — so it showed three covers and the rest had
    to be found by scrolling down.

    Two screens, then, and the shared thing they have is the header, which belongs
    to the navigator and is the same one for both.
  */
  /**
   * The create button, **once for both screens**.
   *
   * It was written inside the tasks markup, and a media list needs the same
   * button: adding a film is adding an item, and the only difference is where it
   * takes you. Two copies of a button means the one that gets the margin fixed is
   * the one somebody was looking at.
   */
  const crear = (
    <>
      <Pressable
        testID="item-create-button"
        accessibilityRole="button"
        accessibilityLabel={
          media ? t("catalog.addFromCatalog") : t("itemCreate.title")
        }
        {...pistaCreate.props}
        onPress={() => {
          if (media) {
            void router.push(`/(app)/catalog?listId=${listId}`);
            return;
          }
          setEditing({ itemId: "", page: "edit" });
        }}
        style={({ pressed }) => [
          styles.createButton,
          {
            bottom: theme.spacing.lg,
            right: theme.spacing.lg,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.accent,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={26} color={theme.colors.onAccent} />
      </Pressable>
      {pistaCreate.node}
    </>
  );

  if (media) {
    return (
      <MediaListScreen
        list={list}
        items={items}
        isLoading={isLoading}
        listKind={list?.kind ?? "movies"}
        workspace={workspace}
        onOpenDetails={openDetails}
        onMenu={setMenuFor}
        onMoveItem={moveItemTo}
        listOpen={menuOpen}
        crear={crear}
        menuFor={menuFor}
        listId={listId}
        folders={folders}
        onCloseItemMenu={() => setMenuFor(null)}
        onCloseListMenu={() => setMenuOpen(false)}
      />
    );
  }

  return (
    <Screen
      scroll={false}
      /*
        La banda del color del espacio: la mitad de abajo de un lavado que empieza
        en la cabecera y la continua 100 puntos por debajo de su borde. La pinta la
        pantalla y no la cabecera, y por eso el alto de la barra no cambia.
      */
      wash={{ color: workspace?.color, colorTo: workspace?.colorTo, wash: workspace?.wash }}
    >
      {/*
        The list itself, **with nothing around it that expects a drag**.

        There was a `DraggableSort` wrapping the `FlatList` so the rows could
        share the drag state, and there are no dragged rows here any more: the
        order is arranged in a sheet. A provider with no rows inside it is a
        provider that measures a list it never touches.
      */}
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
          // Five screens each way and not seven: measured on a list of a thousand
          // rows, seven mounted 420 of them on the first paint, which is the part
          // a phone pays for, and five mounts half as many for the same
          // smoothness when you scroll (20 screen-jumps in 427 ms, 2 frames
          // dropped). The number is in docs/roadmap.md with the rest.
          windowSize={5}
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

      {/* El menu se monta cuando se pide y se desmonta al cerrar, que es como
          decide abrirse: un menu siempre presente seria un menu que se abre solo
          al cambiar la lista. */}
      {menuOpen && list ? (
        <ListMenuSheet
          list={list}
          folder={
            list?.folderId
              ? (folders.find((f) => f.id === list.folderId) ?? null)
              : null
          }
          onClose={() => setMenuOpen(false)}
          onDeleted={() => router.back()}
        />
      ) : null}




      {/*
        The order, in a sheet, **and over the whole list**.

        A row dragged two places up is one index and not a number of steps, and
        the sheet is the only place that knows both numbers: where it was dropped
        and where it was. The manual order is a property of the list and not of the
        "not done" half of it, so what is arranged is everything in the list and
        the completed rows are in it too — a manual order that moved a row past
        something already done would renumber across both and land somewhere
        different from where it was dropped.
      */}
      <ReorderSheet
        open={reorderOpen}
        onClose={() => setReorderOpen(false)}
        title={t("order.reorder")}
        hint={t("order.reorderHint")}
        onMove={(id, delta) => void moveItemTo(id, delta)}
        rows={sorted.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.tags.length > 0 ? item.tags.join(" · ") : null,
        }))}
      />

      {/* The one button that adds to this list, at the bottom right where the
          thumb is on a phone, and it is the same button everywhere: in a list of
          tasks it opens the item panel to write one, and in a list of films,
          series or books it opens the catalog, because a title written by hand
          has no poster and there is nothing to show for it.

          It is a button and not the form that was under the list because on a
          long list the form is three screens down, and a list you have to scroll
          to the end of to add anything to is a list you stop adding things to.

          The catalog needs the network, so on a plane this one does not work.
          It says so when it is pressed, rather than opening a search that cannot
          answer. */}
      <DoneTray
        items={completed}
        bottomInset={theme.spacing.lg * 2 + 56 + theme.spacing.md}
        onToggle={(item) => void toggleCompleted(item)}
        onOpen={(item) => setEditing({ itemId: item.id, page: "edit" })}
      />

      {crear}


      <ItemEditSheet
        item={editingItem}
        listId={listId}
        mode={editing && editing.itemId === "" ? "create" : "edit"}
        startOn={editing?.page ?? "edit"}
        tagColors={list?.tagColors ?? {}}
        onTagColor={(tag, color) =>
          /*
           * `setTagColor` plans from **this** `list`, and not from the cache it
           * has just written, so two colour writes before the next render would
           * both plan from the same map and the second one would quietly eat the
           * first. The sheet keeps a second tap from arriving while a write is in
           * flight, so a tap is one write of one label; the promise comes **back**
           * rather than being dropped with a `void`, because the sheet waits for
           * it to close the strip —a strip that closed on the tap had nothing on
           * screen to show for that tap.
           */
          list ? setTagColor(list, tag, color) : undefined
        }
        onClose={() => setEditing(null)}
      />
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
  tagColors,
  onToggle,
  onEdit,
  onIcon,
}: {
  item: import("@orbit-hub/contracts").ListItem;
  /**
   * The colours of **this** list, handed down from the screen's `list`.
   *
   * A prop and not a lookup: "Mercadona" is a word any list can use, and two
   * lists in the same app can hold it in two colours. A row that went and found
   * the colour itself — from a module map, from the item, from a hook — would
   * paint both of them the same one, and the only way to know which list a row
   * belongs to is to be told.
   */
  tagColors: TagColors;
  onToggle: () => void;
  onEdit: () => void;
  onIcon: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * The whole of a name the user wrote, **on this row's own press**.
   *
   * A `Pressable` around the name would take the gesture away from the row on a
   * phone and the row would stop opening the item — a bug the web cannot show,
   * because a click bubbles there and both fire. See `useLongPressText`.
   */
  const nombreLargo = useLongPressText(item.title);

  const pistaNombre = useA11yHint(t("itemEdit.subtitle"));

  return (
    <View
      testID={`item-row-${item.id}`}
      style={[
        styles.item,
        {
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          // El asa de arrastrar va encima, en el borde derecho, y la insignia de
          // urgencia se solapaba con ella. Se le deja sitio: dos cosas que se
          // pisan no se leen, y ademas el que va debajo no se puede pulsar.
          //
          // Y los 28 pt se los queda el **nombre**, no solo el hueco de la derecha:
          // el icono ha pasado a la linea del titulo y el nombre ya no es el primer
          // hijo de la fila, asi que el ancho del sitio reservado va al final de la
          // linea y el `flexShrink: 1` de `styles.nombre` es lo que cede de ahi.
          paddingRight: theme.spacing.lg + styles.dragHandle.width,
        },
      ]}
    >
      {/* The icon is its own target: it is a picture of what to buy, and
          pressing it opens the pictures rather than the row. */}
      <Checkbox checked={item.completed} onToggle={onToggle} label="" />

      {/*
        The column, and it has two children that take part in layout: the line of
        the title and the line of the labels. The `gap: 2` is the distance under the
        title and it is the same number it has always been — the other two children,
        `nombreLargo.sheet` and `pistaNombre.node`, were never counted by it and
        still are not: the sheet is a `Modal`, which on web is a portal out of this
        box entirely, and the hint is `position: absolute`, and a child in either
        of those is not a flex item for `gap` to put anything between. */}
      <View style={[styles.flex, { gap: 2 }]}>
        {/*
          The icon and the name, **on one line**, and that line is the whole fix.

          The icon used to be a **sibling of this column**, and `styles.item` has
          `alignItems: "center"`, so it centred against *the title plus whatever is
          under it*: on a task with a badge or labels the icon sat below the title
          and on a task with neither it sat centred, and two rows that look alike
          had their icon at two heights with no reason for it. Inside the line of
          the title it is centred on **that** line, and the badge and the labels go
          to a line of their own, so nothing under the title can move it again.

          The icon is still to the right of the checkbox and not on the far edge
          of the row: out there it read as a picture of the list instead of the
          icon of **this** row, and with the checkbox beside it you can tell at a
          glance what you are going to tick and what you have ticked.

          And with no icon **nothing is drawn**: no glyph and no reserved space. The
          `+` that used to sit here when there was no icon is gone — it said "add an
          icon" on almost every task of every list, and it said it in the place
          where the name should be. What replaced it is nothing, and an empty gap
          is not nothing either: the name would start glued to the checkbox and the
          row would fill with air, which is a larger empty space. So the titles of
          the rows with an icon start a few points further right than the ones
          without, which has been asked for twice.

          And that is why this is not even an empty `View`: an invisible target the
          width of a finger next to every name without an icon would open the icon
          picker on a tap that looked like it was on the name.

          The `gap` is the row's own `spacing.md` and it is not a new number: the
          icon has not moved, it has moved its parent. */}
        <View style={[styles.titulo, { gap: theme.spacing.md }]}>
          {item.icon ? (
            <Pressable
              testID={`item-icon-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={t("icons.ofItem", { name: item.title })}
              hitSlop={8}
              onPress={onIcon}
              style={styles.iconSlot}
            >
              <ItemIcon
                icon={item.icon}
                style={item.iconStyle}
                color={item.iconColor}
              />
            </Pressable>
          ) : null}

          {/* The name opens the row. It used to be wired to the delete: one tap
              and the thing you were reading was gone, with nothing said and
              nothing to undo.

              It is the press and not the row behind it, so this one box carries both
              gestures: a tap opens the item, a long one opens the whole name. */}
          <Pressable
            onPress={onEdit}
            onLongPress={nombreLargo.onLongPress}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            {...pistaNombre.props}
            style={styles.nombre}
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
        </View>
        {nombreLargo.sheet}
        {pistaNombre.node}

        {/* The urgency and the labels, **on the same line**, and **that is the
            second line of the column** — drawn only when there is a badge or at
            least one label, so a task with neither is a single line. It is a line
            of its own, and not part of the line of the title, because the icon
            shares the line of the title and nothing that is under it may move it:
            while the two were one column centred together, the icon went down with
            the labels.

            The urgency used to be on the right edge of the row, in the same column
            as the drag handle, where it read as part of the row's trailing
            furniture — and a column that lines the priorities of several rows up
            into is a column that means nothing. It is a property of the task, so
            it goes with the task.

            One line and not one each: a row with a priority *and* two labels was
            three lines tall, and the middle one held a single word in a pill. A
            task list is read by scanning down the names, and three lines per row is
            a list where only six names fit on a phone. The badge goes first — it
            is the coarser of the two, and the labels are what you are looking for
            when you are looking for a shop.

            The badge is not pressable here. The name above opens the sheet, and the
            sheet has the urgency as four things you can see, so a second way in
            from the row is two ways to end up disagreeing about the value.

            And it is compact, with a glyph: at this size the colour alone is not
            enough to sort a list by. */}
        {item.priority !== "none" || item.tags.length > 0 ? (
          <View style={[styles.meta, { gap: theme.spacing.xs }]}>
            {item.priority !== "none" ? (
              <Badge
                label={t(`items.priority.${item.priority}` as never)}
                tone={PRIORITY_TONE[item.priority]}
                icon={PRIORITY_ICON[item.priority]}
                size="compact"
              />
            ) : null}

            {/* The labels, one pill each, and only the ones there are. A row used
                to say "+ Label" under every name, which is a second place to add
                the same thing the item panel already does, in a row with no room
                to say it in.

                It used to be one string — "Mercadona · Panadería", joined, in the
                accent colour — and a string has nowhere to put a colour that
                belongs to one of its words. A label is a per-list thing with a
                per-list colour, so it has to be a box: the pill is the same one
                the task sheet draws, in the same colour, for the same reason.

                **A pill that reads in `theme.colors.text` is not a bug.** The pill
                keeps the label's own colour only where that colour reaches 4.5:1
                on the pill's fill — nine of the twelve palette colours fail that
                in each theme — and hands back the theme's text colour where it
                does not. The arithmetic lives in `@/lib/lists/tag-colors` and it
                is measured, so there is nothing to route around here.

                And they wrap rather than being cut: a pill cut in half is worse
                than a label cut in half, because the colour is on the pill and a
                half-pill reads as a different colour. `docs/roadmap.md` says it
                about a label beside a name and it is more true of a pill.

                `styles.metaTag` is the only thing about a pill this row decides
                for itself, and its comment says what it is for. */}
            {item.tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                colors={tagColors}
                size="compact"
                style={styles.metaTag}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  band: {
    width: "100%",
  },
  header: {},
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    // And it does not shrink. Measured: with the two buttons free to shrink they
    // took the title's space instead of their own, and the title went to three
    // letters. The actions have a fixed size; the title is what gives way.
    flexShrink: 0,
  },
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
  /**
   * La linea del icono y del nombre, y **`alignItems: "center"` aqui es el arreglo**.
   *
   * El icono es hijo de esta linea, no hermano de la columna: asi se centra contra
   * la linea del titulo y no contra el titulo mas lo que haya debajo. Antes lo
   * centraba el `alignItems: "center"` de `styles.item` contra las dos lineas
   * juntas, y por eso una fila con insignia lo tenia mas abajo que otra que no la
   * tenia.
   *
   * Y el `flexShrink` va en el nombre y no aqui, y porque **esta linea es ahora una
   * fila y antes no lo era**: `react-native-web@0.21.2` pone `flexShrink: 0` en
   * todas sus `View` (`node_modules/react-native-web/dist/exports/View/index.js`,
   * `view$raw`), y en una columna la caja del nombre se estiraba al ancho de la
   * columna mientras que en una fila con `flexShrink: 0` se queda con su ancho de
   * contenido y empuja el resto hacia la derecha. El `minWidth: 0` de `styles.flex`
   * sigue haciendo lo que hacia —que la columna pueda encogerse— y el
   * `numberOfLines={2}` del nombre sigue poniendo el tope de dos lineas. El
   * comentario de `styles.nombre` lo cuenta entero, porque es su historia.
   */
  titulo: {
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * La segunda linea de la columna: la insignia de urgencia y las etiquetas, bajo
   * el nombre.
   *
   * Y no lleva `flexGrow`: el nombre manda en la altura de la linea que comparten.
   * Antes las dos lineas eran el unico hijo que ocupaba sitio de la columna, asi
   * que un nombre largo —dos lineas de texto— se comia la separacion del `gap` y
   * las pastillas se pegaban a la ultima renglon. La insignia y las etiquetas estan
   * bajo el nombre, no pegadas a el.
   */
  meta: {
    flexDirection: "row",
    /*
     * Kept, and **none of the credit for it is the pill's.**
     *
     * `TagChip` and `Badge` both carry `alignSelf: "flex-start"`, and a child's
     * `align-self` wins over the row's `alignItems` — the rule
     * `workspace-color-picker.tsx` verified in a browser, on its `columnaPreview`,
     * where changing the row changed nothing. Those two are the only children this
     * style has, so today `alignItems` here governs **nothing**: neither the pill
     * nor the badge is centred by it, and neither is stopped from stretching by it
     * either. Each of them says that about itself.
     *
     * So it stays for the next child that arrives without an `alignSelf` of its
     * own, which is centred instead of stretched down the whole line; and because
     * it is the same `alignItems: "center"` as `styles.row` in the task sheet, so
     * the two lines of pills in this feature are built the same way.
     */
    alignItems: "center",
    /*
     * So the pills go under each other instead of being made narrower. They wrap,
     * they are never cut: with `flexWrap` the row measures every pill at its own
     * width and moves the ones that do not fit onto the next line, which is the
     * only arrangement in which a pill is still the colour it was chosen to be.
     */
    flexWrap: "wrap",
  },
  /**
   * And one label can still be wider than the whole line.
   *
   * The `flexWrap` above is already what saves the badge: a row with twenty labels
   * puts them on further lines rather than pushing the badge off the right edge.
   * So this is not what keeps the badge whole, and it should not be described as
   * such. It is the one label with no other line to go to — there is nowhere for
   * it to wrap to — and without a `flexShrink` it would hang off the edge and be
   * cut in half. With it the pill narrows to the row and the label wraps *inside*
   * the pill, which is the whole pill and its whole colour.
   *
   * On the pill and not on a box around it: a wrapper that shrinks while the pill
   * inside it does not is an overflow waiting to happen. `TagChip` takes a `style`
   * for exactly this, and the badge is left alone — it is the one thing on that
   * line that must not be squeezed, because it is what the row is sorted by.
   */
  metaTag: {
    flexShrink: 1,
  },
  /** Lo que ocupa el asa de arrastrar, en el borde derecho de la fila. */
  dragHandle: {
    width: 28,
  },
  createButton: {
    position: "absolute",
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    // It floats over the rows, so it casts a shadow to say it is above them and
    // not one more row at the end of the list.
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
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
  /**
   * The pressable that wraps the title, and **it must not be a flex child.**
   *
   * Symptom: in a release build of Android the row shows its checkbox, its icon
   * and the counters — every one of them styled — and **no title at all**. The
   * `accessibilityLabel` of the icon, one line up, reads the title in full, so
   * the data is there and the title is being dropped at layout time.
   *
   * Why: its parent is already `flex: 1`, so this box has no width of its own,
   * and a `Pressable` that is told how to divide a space rather than how much to
   * occupy ends up occupying **zero** in Android's flexbox. A zero-width box clips
   * everything inside it, and the `AppText` goes with it — while the icon beside
   * it, which has a fixed `width: 24`, survives. On web the same tree lays out,
   * because the browser gives an unstyled element its content width.
   *
   * So: no `flex`, no absolute, nothing. It measures what it wraps, which is the
   * only thing that was ever wanted — the title is as long as it is.
   *
   * **And `flexShrink` is the one thing here that is not "no flex".** It used to be
   * the parent's job alone: this box was a child of a **column**, where the cross
   * axis stretched it to the column's width and its own width never came into it.
   * It is now a child of a **row** — the line of the title, beside the icon — and
   * in a row the width is exactly what the box decides. `react-native-web@0.21.2`
   * writes `flexShrink: 0` on every `View` it makes (`view$raw`, in
   * `node_modules/react-native-web/dist/exports/View/index.js`), so without this
   * the name would keep its full text width, ignore the `numberOfLines={2}` above
   * it and push the right edge of the row past the edge of the screen.
   *
   * So the number here is **not** a `flex: 1` — which is the thing that made
   * Android's flexbox give this box a width of zero — but a **shrink**, which is
   * the other half of the same property and not the half that did that.
   * `minWidth: 0` on `styles.flex` still does its own job: it is the *column* that
   * has to be able to give up room.
   */
  nombre: {
    flexShrink: 1,
  },
  flex: {
    flex: 1,
    // A child of a `flex` does not go below its content by default, so the
    // title column would have stayed as wide as the longest word in it and
    // pushed the two actions off the right edge instead of making room.
    minWidth: 0,
  },
  strike: {
    textDecorationLine: "line-through",
  },
});
