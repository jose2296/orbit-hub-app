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
import { DoneTray } from "@/components/lists/done-tray";
import { ItemIcon } from "@/components/lists/icon-picker";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { FiltersSheet } from "@/components/lists/item-picker";
import { ItemEditSheet } from "@/components/lists/item-edit-sheet";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { DraggableRow, DraggableSort } from "@/components/ui/draggable-row";
import { MediaCarousel } from "@/components/ui/media-carousel";
import { Screen } from "@/components/ui/screen";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useListItems, useLists } from "@/hooks/use-lists";
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

  const { lists, toggleFavorite, setOrderMode } = useLists({});
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
    toggleCompleted,
    moveItemTo,
  } = useListItems(listId);

  const [menuFor, setMenuFor] = useState<ListItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
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
              menuLabel: t("mediaActions.menuOf", { name: item.title }),
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
    // Which provider to ask comes from the item. A list of films and series
    // holds both, a list of tasks is also where a book somebody typed by hand
    // ends up, and asking the wrong provider returns nothing at all.
    const ref = providerRefOf(item);
    router.push({
      pathname: "/(app)/item/[itemId]",
      params: {
        // Which list it is in, so the detail can take it out of it.
        itemId: listId,
        // Which row of that list it is, so the detail can tick it off.
        itemKey: item.id,
        // Left empty when the row has no provider record: the detail screen then
        // shows the row itself instead of an error.
        kind: ref?.kind ?? "",
        externalId: ref?.externalId ?? "",
        title: item.title,
      },
    });
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

    const { item, index } = entry;
    const row = (
      <TaskRow
        item={item}
        onToggle={() => void toggleCompleted(item)}
        // Un toque abre el elemento. Antes el nombre era un boton que BORRABA,
        // sin confirmar y sin vuelta atras: la forma mas mala de perder trabajo
        // que puede tener una lista, y peor que una funcionalidad que falte,
        // porque te enteras cuando ya no lo querias.
        onEdit={() => setEditing({ itemId: item.id, page: "edit" })}
        onIcon={() => setEditing({ itemId: item.id, page: "icon" })}
        onPriority={() => setEditing({ itemId: item.id, page: "edit" })}
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
          <View style={[styles.headerActions, { gap: theme.spacing.xs }]}>
            <Button
              label={
                list.favorite ? t("lists.unfavorite") : t("lists.favorite")
              }
              variant="ghost"
              size="sm"
              icon={list.favorite ? "bookmark" : "bookmark-outline"}
              fullWidth={false}
              onPress={() => void toggleFavorite(list)}
            />
            {/* Lo que se puede hacer con la lista entera, aqui arriba. Abajo
                ocupaba media pantalla y empujaba las filas hacia arriba. */}
            <Button
              testID="list-menu-button"
              label={t("lists.menu")}
              variant="ghost"
              size="sm"
              icon="ellipsis-horizontal"
              fullWidth={false}
              onPress={() => setMenuOpen(true)}
            />
          </View>
        ) : null}
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

  // El pie no lleva acciones. Duplicar y eliminar estan en el menu del header, y
  // un boton rojo de pantalla completa debajo de la lista compite con las filas
  // por el sitio donde el dedo quiere ir.
  const footer = null;

  return (
    <Screen scroll={false}>
      {/* El provider va alrededor de la lista y no en cada fila: las filas
          comparten el estado del arrastre por contexto, y son las tres cifras
          que necesitan para apartarse. */}
      <DraggableSort>
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
      </DraggableSort>

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

      <Pressable
        testID="item-create-button"
        accessibilityRole="button"
        accessibilityLabel={
          media ? t("catalog.addFromCatalog") : t("itemCreate.title")
        }
        accessibilityHint={
          media ? t("catalog.addFromCatalogHint") : t("itemCreate.titleHint")
        }
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

      <ItemEditSheet
        item={editingItem}
        listId={listId}
        mode={editing && editing.itemId === "" ? "create" : "edit"}
        startOn={editing?.page ?? "edit"}
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
  onToggle,
  onEdit,
  onIcon,
  onPriority,
}: {
  item: import("@orbit-hub/contracts").ListItem;
  onToggle: () => void;
  onEdit: () => void;
  onIcon: () => void;
  onPriority: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  // Whether there is room for the extras.
  //
  // With the menu pushing, the app is left with 146 px of a 430 and the row with
  // 82. With a checkbox, an icon, a name and a badge in 82 the name does not
  // fit, and what was on screen was a checkbox, a drag handle and nothing else —
  // a list you cannot read at the moment you opened the menu. So the row is
  // measured and gives up the extras before it gives up the name: the icon is a
  // picture of the thing and the badge is a reminder, and the name is the thing.
  const [ancho, setAncho] = useState(0);
  const estrecho = ancho > 0 && ancho < 210;
  // Below this the row stops being a row: with the menu pushing it is 82px, and
  // una casilla de 22 mas 32 de margenes se dejan 20 para el nombre, que es una
  // letra y un punto por linea. Apila: la casilla arriba y el nombre debajo,
  // con todo el ancho. Es la unica disposicion que a 82 px se lee, y cuatro
  // palabras seguidas en vertical dicen mas que cinco palabras en vertical
  // una detras de otra.
  const apilado = ancho > 0 && ancho < 150;

  return (
    <View
      testID={`item-row-${item.id}`}
      onLayout={(event) => setAncho(event.nativeEvent.layout.width)}
      style={[
        apilado ? styles.apilado : styles.item,
        {
          gap: estrecho ? theme.spacing.xs : theme.spacing.md,
          padding: apilado ? theme.spacing.md : theme.spacing.lg,
          // El asa de arrastrar va encima, en el borde derecho, y la insignia de
          // urgencia se solapaba con ella. Se le deja sitio: dos cosas que se
          // pisan no se leen, y ademas el que va debajo no se puede pulsar.
          //
          // Estrecha, ese hueco se queda sin sitio: en una fila de 82 px eran 60
          // de los 82, y al nombre no le quedaba nada. Estrecha, el asa tampoco
          // esta (lo quita DraggableRow), asi que el hueco se devuelve al nombre.
          paddingRight:
            theme.spacing.lg + (estrecho ? 0 : styles.dragHandle.width),
        },
      ]}
    >
      {/* The icon is its own target: it is a picture of what to buy, and
          pressing it opens the pictures rather than the row. With no icon there
          is still something to press, or the feature is only found by someone
          who already uses it. */}
      <Checkbox checked={item.completed} onToggle={onToggle} label="" />

      {/* El icono va a la derecha de la casilla, y no en el borde de la fila: al
          otro extremo se leía como una foto de la lista y no como el icono de
          esta fila, y con la casilla al lado se sabe de un vistazo qué vas a
          marcar y qué has marcado. */}
      {estrecho ? null : (
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
          {item.icon ? null : (
            <Ionicons name="add" size={14} color={theme.colors.textSubtle} />
          )}
        </Pressable>
      )}

      <View style={[styles.flex, { gap: 2 }]}>
        {/* The name opens the row. It used to be wired to the delete: one tap
            and the thing you were reading was gone, with nothing said and
            nothing to undo. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.title}
          accessibilityHint={t("itemEdit.subtitle")}
          onPress={onEdit}
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

        {/* The labels, and only the ones there are. A row used to say "+ Label"
            under every name, which is a second place to add the same thing the
            item panel already does, in a row with no room to say it in. */}
        {item.tags.length > 0 ? (
          <AppText variant="caption" tone="accent" numberOfLines={1}>
            {item.tags.join(" · ")}
          </AppText>
        ) : null}
      </View>

      {item.priority !== "none" && !estrecho ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("itemEdit.changePriority", {
            name: t(`items.priority.${item.priority}` as never),
          })}
          hitSlop={6}
          onPress={onPriority}
        >
          <Badge
            label={t(`items.priority.${item.priority}` as never)}
            tone={PRIORITY_TONE[item.priority]}
          />
        </Pressable>
      ) : null}
      {item.priority !== "none" || estrecho ? null : (
        /* Un hueco del ancho de la insignia, para que al ponerla la fila no
           dé un salto hacia la derecha y el nombre no se mueva bajo el dedo. */
        <View style={styles.priorityGap} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  header: {},
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
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
  apilado: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  /** Lo que ocupa el asa de arrastrar, en el borde derecho de la fila. */
  dragHandle: {
    width: 28,
  },
  priorityGap: {
    width: 64,
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
  flex: {
    flex: 1,
  },
  strike: {
    textDecorationLine: "line-through",
  },
});
