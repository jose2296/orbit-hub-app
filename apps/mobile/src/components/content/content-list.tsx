import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { Folder, List, ListOrderMode, Note, WorkspaceWash } from "@orbit-hub/contracts";

import { ContentToolbar } from "@/components/content/content-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DRAG_HANDLE_WIDTH,
  DraggableRow,
  DraggableSort,
} from "@/components/ui/draggable-row";
import { AppText } from "@/components/ui/text";
import { spacePaint, spaceTint } from "@/lib/workspace/color";
import { LIST_KIND_ICON } from "@/lib/lists/kind";
import {
  alcanceDe,
  EMPTY_FILTER,
  enAlcance,
  isDraggableOrder,
  matchesFilter,
  moveRow,
  sortRows,
  toRow,
  type ContentFilter,
  type ContentRow,
} from "@/lib/content-order";
import { saveContentOrder } from "@/lib/content-order-save";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface ContentListProps {
  workspaceId: string;
  /** `null` is the space itself, which is the root folder. */
  folderId: string | null;
  /** The folders of the whole space, so the filter can offer any of them. */
  folders: Folder[];
  lists: List[];
  notes: Note[];
  isLoading: boolean;
  colorKey?: string | null;
  wash?: WorkspaceWash | null;
  colorTo?: string | null;
  onFolderMenu?: (folder: Folder) => void;
  onListMenu?: (list: List) => void;
  /**
   * A note's menu, and the reason it is a prop.
   *
   * A folder and a list are acted on with a sheet that lives in the screen above,
   * because their menus need the space and the panel. A note needs neither, and
   * a note is the one of the three that the screen above already has open: it is
   * the screen you are looking at when you want to act on a note. So the caller
   * passes the same sheet it passes everywhere else, and the row only has to know
   * that a menu exists.
   */
  onNoteMenu?: (note: Note) => void;
}

/**
 * One level of a space, as a single list of everything in it.
 *
 * **It used to be three lists.** Child folders here, lists here, and a row that
 * opened a screen where the notes were. Three headings, three counts, and a
 * person who wanted "the notes in this folder" had to know which of the three
 * sections it was under before they could look. A folder, a list and a note are
 * three things to the database and one thing to somebody standing in a folder, and
 * the sections were drawing the difference for them.
 *
 * So the three become one list, and the two things that were carrying the
 * structure move to the two things that should: a **filter** for what is in it,
 * and an **order** for how. A space is still a tree — going into a folder is still
 * a new screen, which is what makes the back button mean one press and no more —
 * but the level you are looking at is no longer three separate inventories.
 *
 * The order is the contract's own, the same five a list of items has, and the one
 * called `manual` is the only one where a row can be dragged. Dragging writes
 * the new number for the rows that moved and for nothing else, which is what
 * keeps an arrangement of forty things from being forty writes.
 */
export function ContentList({
  workspaceId,
  folderId,
  folders,
  lists,
  notes,
  isLoading,
  colorKey,
  wash,
  colorTo,
  onFolderMenu,
  onListMenu,
  onNoteMenu,
}: ContentListProps) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();

  const [filter, setFilter] = useState<ContentFilter>(EMPTY_FILTER);
  const [order, setOrder] = useState<ListOrderMode>("manual");

  const paint = spacePaint(colorKey, wash ?? undefined, colorTo);
  const tint = spaceTint(colorKey, 0.13);
  const iconTint = spaceTint(colorKey, 0.24);

  /**
   * Everything of this level, in one array.
   *
   * A folder is `parentId === folderId` and a list and a note are `folderId`,
   * and the three of them do not have to agree on anything else — which is the
   * point, and the reason they can be one list.
   */
  /**
   * Which rows the list may consider, and it is the filter that decides it.
   *
   * The three cases and why they are three are in `alcanceDe`; what is here is
   * the part that is about this screen: the level is the tree the back button
   * walks, and it is the scope whenever nobody has narrowed anything down.
   */
  const alcance = useMemo(() => alcanceDe(filter), [filter]);

  const todo = useMemo<ContentRow[]>(
    () =>
      [
        ...folders.map(toRow.folder),
        ...lists.map(toRow.list),
        ...notes.map(toRow.note),
      ].filter((row) => enAlcance(row, alcance, folderId)),
    [alcance, folderId, folders, lists, notes],
  );

  const visible = useMemo(
    () => sortRows(todo.filter((row) => matchesFilter(row, filter)), order),
    [filter, order, todo],
  );

  /**
   * The folder chips, and they are the folders of **this** level and not of the
   * one being peeked into.
   *
   * That is what keeps the lit chip on screen: the chips come from where the
   * person is, so choosing one of them and then another moves between siblings,
   * and the one they chose is still there to go back to instead of only a
   * "Quitar filtros" that throws away the kind filter and the search with it.
   */
  const carpetasParaFiltrar = useMemo(
    () =>
      folders
        .filter((folder) => (folder.parentId ?? null) === folderId)
        .map((folder) => ({ id: folder.id, name: folder.name })),
    [folderId, folders],
  );

  /**
   * The kinds of list that are actually here, and only those.
   *
   * "Películas" on a folder of tasks and notes is a chip that can only ever
   * empty the list, and it is offered with the same seriousness as one that
   * shows things. A person who has never made a list of books in this space is
   * not being offered a choice, they are being shown a dead end.
   */
  const tiposDeLista = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const row of todo) {
      if (row.kind !== "list" || !row.listKind) continue;
      cuenta.set(row.listKind, (cuenta.get(row.listKind) ?? 0) + 1);
    }
    return [...cuenta.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([kind, count]) => ({ kind, count }));
  }, [todo]);

  const abrir = useCallback(
    (row: ContentRow) => {
      if (row.kind === "folder") {
        router.push({
          pathname: "/(app)/workspace/[workspaceId]/folder/[folderId]",
          params: { workspaceId, folderId: row.id },
        });
        return;
      }
      if (row.kind === "list") {
        router.push(`/(app)/list/${row.id}`);
        return;
      }
      router.push(`/(app)/note/${row.id}`);
    },
    [router, workspaceId],
  );

  /**
   * The move, from the index the row was dropped at.
   *
   * `DraggableRow` hands over the **index** and not a displacement, which is
   * right: a row dragged two places up and one down is one index and not a
   * number of steps, and turning an index back into a step here would be the one
   * place in the app where "how far did it move" is a guess.
   */
  const mover = useCallback(
    (rowId: string, toIndex: number) => {
      const from = visible.findIndex((row) => row.id === rowId);
      if (from < 0) return;
      const antes = new Map(todo.map((row) => [row.id, row.position]));
      const { changed } = moveRow(visible, rowId, toIndex - from);
      if (changed.length === 0) return;
      void saveContentOrder(changed, antes);
    },
    [todo, visible],
  );

  if (isLoading) {
    return (
      <View style={{ paddingVertical: theme.spacing.xl }}>
        <AppText variant="callout" tone="muted" align="center">
          {t("common.loading")}
        </AppText>
      </View>
    );
  }

  const vacioDeFiltro = todo.length > 0 && visible.length === 0;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {todo.length > 0 ? (
        <ContentToolbar
          filter={filter}
          onFilterChange={setFilter}
          order={order}
          onOrderChange={setOrder}
          folders={carpetasParaFiltrar}
          listKinds={tiposDeLista}
          hiddenCount={todo.length - visible.length}
          totalCount={todo.length}
        />
      ) : null}

      {vacioDeFiltro ? (
        <EmptyState
          title={t("content.emptyFiltered")}
          description={t("content.clear")}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={t("folders.empty.title")}
          description={t("folders.empty.body")}
        />
      ) : (
        <DraggableSort>
          <View style={{ gap: theme.spacing.xs }}>
            {visible.map((row, index) => (
              <ContentRowView
                key={`${row.kind}:${row.id}`}
                row={row}
                index={index}
                total={visible.length}
                draggable={isDraggableOrder(order) && filter.kind === "all" && filter.folderId === null && filter.query.length === 0}
                onOpen={() => abrir(row)}
                onMove={(toIndex) => mover(row.id, toIndex)}
                onMenu={
                  row.kind === "folder"
                    ? onFolderMenu
                      ? () => onFolderMenu(folders.find((f) => f.id === row.id) as Folder)
                      : undefined
                    : row.kind === "list"
                      ? onListMenu
                        ? () => onListMenu(lists.find((l) => l.id === row.id) as List)
                        : undefined
                      : onNoteMenu
                        ? () => onNoteMenu(notes.find((n) => n.id === row.id) as Note)
                        : undefined
                }
                tint={tint}
                iconTint={iconTint}
                foreground={paint.foreground}
              />
            ))}
          </View>
        </DraggableSort>
      )}

    </View>
  );
}

/**
 * One row, whatever it is.
 *
 * A folder, a list and a note are drawn by the same code and told apart by an
 * icon, and that is not a shortcut: the three were three copies of the same row
 * with three icons before, and they drifted — the list row grew a favourite
 * bookmark, the note row grew a chevron, and the folder row grew nothing. One
 * row with a `kind` is the only way three things stay the same thing.
 */
function ContentRowView({
  row,
  index,
  total,
  draggable,
  onOpen,
  onMove,
  onMenu,
  tint,
  iconTint,
  foreground,
}: {
  row: ContentRow;
  index: number;
  total: number;
  draggable: boolean;
  onOpen: () => void;
  onMove: (toIndex: number) => void;
  onMenu?: () => void;
  tint: string;
  iconTint: string;
  foreground: string;
}) {
  const theme = useTheme();
  const t = useTranslation();

  const icon =
    row.kind === "folder"
      ? "folder-outline"
      : row.kind === "note"
        ? "document-text-outline"
        : LIST_KIND_ICON[(row.listKind ?? "tasks") as keyof typeof LIST_KIND_ICON] ??
          "list-outline";

  const cuerpo = (
    <View style={styles.caja}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.name}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.fila,
          {
            backgroundColor: pressed ? theme.colors.surfaceMuted : tint,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            /*
              El hueco de la derecha, en una sola cuenta: el menu de la fila y el
              asa de arrastrar se dibujan **encima** de este rectangulo, asi que el
              cuerpo tiene que terminar antes de los dos. Con las dos cosas puestas
              se solapaban y el menu quedaba debajo del asa, que es un boton que
              no se puede pulsar y no se ve por que.
            */
            paddingRight:
              (onMenu ? 44 : theme.spacing.md) +
              (draggable ? DRAG_HANDLE_WIDTH + theme.spacing.xs : 0),
          },
        ]}
      >
        <View
          style={[styles.icono, { borderRadius: theme.radius.md, backgroundColor: iconTint }]}
        >
          <Ionicons name={icon as never} size={16} color={foreground} />
        </View>
        <View style={[styles.crece, { gap: 2 }]}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {row.name}
          </AppText>
          <AppText variant="caption" tone="subtle" numberOfLines={1}>
            {subtitulo(row, t)}
          </AppText>
        </View>
        {row.favorite ? <Ionicons name="bookmark" size={14} color={foreground} /> : null}
      </Pressable>
      {/*
        The menu and the drag handle are both on the right of the row, and the
        handle spans its whole height — so the menu has to sit to the *left* of it,
        not on top of it. On top meant the handle caught every tap: a row you
        could order but whose menu you could never open, which is the worst of
        both, and it looked fine because one of the two glyphs was showing.
      */}
      {onMenu ? (
        <BotonMenu
          label={row.name}
          onPress={onMenu}
          offset={draggable ? DRAG_HANDLE_WIDTH : 0}
        />
      ) : null}
    </View>
  );

  if (!draggable) return cuerpo;

  return (
    <DraggableRow
      id={row.id}
      index={index}
      total={total}
      onReorder={(_movedId: string, toIndex: number) => onMove(toIndex)}
    >
      {cuerpo}
    </DraggableRow>
  );
}

/**
 * The line under the name, and it is a **different sentence** for each kind.
 *
 * A folder says what a folder is, a note says what a note is, and a list says
 * what kind of list it is and how many things are in it. Putting the kind of a
 * list under its name is what used to identify it, and now the icon beside it
 * says the same thing in a tenth of the width — so the line carries the count,
 * which is the part the icon cannot say.
 */
function subtitulo(row: ContentRow, t: ReturnType<typeof useTranslation>): string {
  if (row.kind === "note") return t("content.kind.note");
  if (row.kind === "folder") return t("content.kind.folder");
  const clase = t(`content.kind.${row.listKind ?? "tasks"}` as never);
  return t("content.itemsIn", { count: row.itemCount ?? 0, kind: clase });
}

function BotonMenu({
  label,
  onPress,
  offset,
}: {
  label: string;
  onPress: () => void;
  /** How far to step left so the drag handle does not sit on top of this. */
  offset: number;
}) {
  const theme = useTheme();
  const t = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("rowActions.menuOf", { name: label })}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.menu,
        {
          top: theme.spacing.md,
          // The handle is `right: 8` and about 32 wide, so stepping by its width
          // plus its own margin puts the menu clear of it rather than a few
          // pixels to the side of it.
          right: theme.spacing.sm + offset,
          padding: theme.spacing.xs,
          borderRadius: theme.radius.sm,
          backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
        },
      ]}
    >
      <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  caja: {
    position: "relative",
  },
  fila: {
    flexDirection: "row",
    alignItems: "center",
  },
  crece: {
    flex: 1,
  },
  icono: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    position: "absolute",
  },
  asa: {
    position: "absolute",
    // A la derecha y no a la izquierda: el menu de la fila esta a la derecha, y
    // un asa de arrastre encima de el seria un blanco de un dedo de ancho donde
    // alguien no puede ni abrir el menu ni mover la fila.
    right: 8,
    bottom: 6,
  },
});
