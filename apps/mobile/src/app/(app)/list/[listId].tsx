import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, View } from "react-native";

import type { ListItem, ListOrderMode } from "@orbit-hub/contracts";

import { releaseSharedCover } from "@/lib/media/shared-cover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { EmptyState } from "@/components/ui/empty-state";
import { DoneTray } from "@/components/lists/done-tray";
import { MediaListScreen } from "@/components/media/media-list-screen";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { FiltersBody } from "@/components/lists/item-picker";
import { ListControls } from "@/components/lists/list-controls";
import { ItemEditSheet } from "@/components/lists/item-edit-sheet";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { TaskRow } from "@/components/lists/task-row";
import { Screen } from "@/components/ui/screen";
import { ReorderSheet } from "@/components/ui/reorder-sheet";
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
import { routeForList } from "@/lib/lists/route";
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

  /**
   * A board does not open here, and this is the link that closes the chain.
   *
   * `routeForList` sends boards to `/board/:id`, and it is called from three places
   * that do not have the kind of the list to hand —search, the content of a space
   * and the catalogue all write `list?.kind ?? 'tasks'`— so the fallback puts all
   * three on `/list/:id`. This screen resolves the list out of the **same**
   * `useLists({})` cache those callers read, which is re-read on every notification
   * of the local store, so the moment the list arrives this runs and sends the
   * person to the board.
   *
   * **Both links are needed and neither one is enough.** Without this one, those
   * three callers land on the task screen of a board and nothing fails: it is close
   * enough to the board not to look broken, and no test of a rendered screen would
   * notice — this suite paints nothing. Without the other one, a link written by
   * hand does the same. If this redirect is ever removed, **those three callers
   * change at the same time**, not one of them.
   *
   * `replace` and not `push`, because a push would leave this screen in the stack
   * under the board, and pressing back would come back here, which would send the
   * person to the board again: a back button that appears to do nothing.
   */
  useEffect(() => {
    if (list?.kind === "board") router.replace(routeForList(list));
  }, [list, router]);
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

  /*
    While the redirect travels. Nothing of this screen's own, because a list of
    tasks flashing for a frame before the board arrives is a flash of the wrong
    screen — and this branch is below every hook on purpose, which is the way this
    app has already been bitten: "Rendered more hooks than during the previous
    render" is a crash the typecheck accepts.
  */
  if (list?.kind === "board") return null;

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

      {/*
        The menu is mounted for good and opens by its prop, **which is what
        `useLastValue` was written for** — and not for tidiness: a menu that
        unmounts on close takes the export down with it. Pressing a format calls
        `onClose()` before asking for the file, so the panel leaves and the work
        goes on behind it, and under a conditional mount that `onClose()` unmounts
        this on the same frame the download starts. The sheet of results would then
        arrive at a component that is not there, and the failure goes unpainted
        again — which is the whole thing it exists to stop.
      */}
      <ListMenuSheet
        list={menuOpen && list ? list : null}
        folder={
          list?.folderId
            ? (folders.find((f) => f.id === list.folderId) ?? null)
            : null
        }
        onClose={() => setMenuOpen(false)}
        onDeleted={() => router.back()}
      />




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
   * The one box on this screen that grows, and it grows for **the header**: the
   * `kindLabel` under the name of the list takes what `headerTop` has left.
   *
   * The row has a `flex` of its own now, in `components/lists/task-row.tsx`, where
   * it is the title column — and the comment on that one says what its
   * `minWidth: 0` is for. They are a copy of each other on purpose: a shared
   * `StyleSheet` between a route and a component means a component importing a
   * route, which is the coupling that moving the row was for. Same two numbers
   * here, because they were measured and changing one of them changes what this
   * box does.
   */
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
