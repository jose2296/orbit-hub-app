import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { Collection, Folder, List, ListOrderMode, Note } from "@orbit-hub/contracts";

import { ContentToolbar } from "@/components/content/content-toolbar";
import { AppIcon } from "@/components/ui/app-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ANCHO_RESERVADO, MenuButton } from "@/components/ui/menu-button";
import { useLongPressText } from "@/hooks/use-long-press-text";
import { AppText } from "@/components/ui/text";
import { LIST_KIND_ICON } from "@/lib/lists/kind";
import {
  alcanceDe,
  EMPTY_FILTER,
  enAlcance,
  matchesFilter,
  moveRow,
  sortRows,
  toRow,
  type ContentFilter,
  type ContentRow,
} from "@/lib/content-order";
import { saveContentOrder } from "@/lib/content-order-save";
import { routeForList } from "@/lib/lists/route";
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
  /**
   * Las colecciones de enlaces del espacio, **como una fila mas**: se crean desde
   * el mismo `+` y se abren y gestionan como una lista, una carpeta o una nota.
   */
  collections?: Collection[];
  /** Cuantos enlaces tiene cada coleccion, por id, para el subtitulo de su fila. */
  bookmarkCounts?: Record<string, number>;
  isLoading: boolean;
  onFolderMenu?: (folder: Folder) => void;
  onCollectionMenu?: (collection: Collection) => void;
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
  collections = [],
  bookmarkCounts = {},
  isLoading,
  onFolderMenu,
  onCollectionMenu,
  onListMenu,
  onNoteMenu,
}: ContentListProps) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();

  const [filter, setFilter] = useState<ContentFilter>(EMPTY_FILTER);
  const [order, setOrder] = useState<ListOrderMode>("manual");

  /*
    Los tres colores de una fila, y **ninguno es el del espacio**.

    La cabecera ya lleva el color del espacio, y es lo unico que lo lleva: una
    fila teñida con el color de donde estas, veinte filas seguidas, es una lista
    que hay que leer contra un color y ademas dice lo mismo veinte veces. Que el
    color de un espacio este en la barra es informacion —dice donde estas— y en
    cada fila es decoracion.

    Asi que son los del tema y son los mismos en todos los espacios: superficie
    para la fila, superficie apagada para el icono, y texto atenuado para el menu.
    La fila pulsada se distingue por `surfaceMuted`, que es justo lo que hay
    debajo cuando no esta pulsada, asi que el estado se ve sin inventar un color.
  */
  const tint = theme.colors.surface;
  const iconTint = theme.colors.surfaceMuted;
  const foreground = theme.colors.textMuted;

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
        ...collections.map((collection) =>
          toRow.collection(collection, bookmarkCounts[collection.id] ?? 0),
        ),
      ].filter((row) => enAlcance(row, alcance, folderId)),
    [alcance, bookmarkCounts, collections, folderId, folders, lists, notes],
  );

  const visible = useMemo(
    () => sortRows(todo.filter((row) => matchesFilter(row, filter)), order),
    [filter, order, todo],
  );



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
        // `toRow.list` always copies the list's kind, and `tasks` is only here for
        // a row assembled by hand: it is where a list used to open, so a row that
        // arrives without a kind still goes to the screen it always went to.
        router.push(routeForList({ id: row.id, kind: row.listKind ?? "tasks" }));
        return;
      }
      if (row.kind === "collection") {
        // La pantalla de enlaces ya sabe filtrar por coleccion y pone ella el titulo.
        router.push({
          pathname: "/(app)/bookmarks",
          params: { workspaceId, collectionId: row.id },
        });
        return;
      }
      router.push(`/(app)/note/${row.id}`);
    },
    [router, workspaceId],
  );

  /**
   * The move, **as a displacement and not as a place**.
   *
   * `moveRow` takes a step count and not an index, because that is what survives
   * positions being renumbered from zero. The reorder sheet hands over a
   * displacement already, and it is the sheet that knows both numbers: the index
   * the row was dropped at and the index it was in.
   */
  const mover = useCallback(
    (rowId: string, delta: number) => {
      if (delta === 0) return;
      const antes = new Map(todo.map((row) => [row.id, row.position]));
      const { changed } = moveRow(visible, rowId, delta);
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
          rows={todo}
          filter={filter}
          onFilterChange={setFilter}
          order={order}
          onOrderChange={setOrder}
          onMove={mover}
          canReorder={true}
        />
      ) : null}

      {/*
        The rows, **and no drag on them**.

        They used to be draggable in place, which meant a list you had chosen to
        read by date could be rearranged by dragging rows that were not where your
        finger was: the order you chose to read is the order the rows are in, and
        the row you want to move is wherever that order put it. Putting the order
        in a sheet with a handle per row is the arrangement the films already use,
        and it leaves the row itself a thing you press to open.
      */}
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
        <View style={{ gap: theme.spacing.xs }}>
          {visible.map((row) => (
              <ContentRowView
                key={`${row.kind}:${row.id}`}
                row={row}
                onOpen={() => abrir(row)}
                onMenu={
                  row.kind === "folder"
                    ? onFolderMenu
                      ? () => onFolderMenu(folders.find((f) => f.id === row.id) as Folder)
                      : undefined
                    : row.kind === "collection"
                      ? onCollectionMenu
                        ? () =>
                            onCollectionMenu(
                              collections.find((c) => c.id === row.id) as Collection,
                            )
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
                foreground={foreground}
              />
            ))}
        </View>
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
  onOpen,
  onMenu,
  tint,
  iconTint,
  foreground,
}: {
  row: ContentRow;
  onOpen: () => void;
  onMenu?: () => void;
  tint: string;
  iconTint: string;
  foreground: string;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /*
    The whole of a name on a long press, **on this row's own press**.

    It is a hook and not a `Pressable` around the name because a `Pressable`
    inside this row's `Pressable` takes the gesture away from it on a phone: the
    innermost view that asks for the touch is the one that gets it, so the row
    would stop opening. On the web it would look fine, because a click bubbles and
    both would fire — which is exactly the kind of bug that only exists on the two
    platforms nobody here can run. See `useLongPressText`.
  */
  const nombre = useLongPressText(row.name);

  /*
    The row's own icon, or the one for its kind when it has none. Before, every
    row drew the kind's glyph and a chosen icon never showed up here at all —
    which is why putting an icon on a list or a folder seemed to do nothing
    outside the spaces screen.
  */
  const respaldo =
    row.kind === "folder"
      ? ("folder-outline" as const)
      : row.kind === "collection"
        ? ("bookmarks-outline" as const)
      : row.kind === "note"
        ? ("document-text-outline" as const)
        : ((LIST_KIND_ICON[(row.listKind ?? "tasks") as keyof typeof LIST_KIND_ICON] ??
            "list-outline") as keyof typeof Ionicons.glyphMap);

  return (
    <View style={styles.caja}>
      <Pressable
        onLongPress={nombre.onLongPress}
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
              El hueco de la derecha, y **solo del menu**: el menu de la fila se
              dibuja encima de este rectangulo, asi que el cuerpo tiene que terminar
              antes que el.

              Son dos numeros con dos oficios, y antes eran uno que no hacia
              ninguno de los dos bien:

              - `ANCHO_RESERVADO` es el espacio **del boton**: su caja, su margen y
                el `hitSlop` que le agranda el area de toque. Lo trae el boton
                porque la exigencia es suya; el `44` de antes era un numero escrito
                aca que se quedo **cuatro pixeles corto** de la caja, sin el
                `hitSlop` —que se sale de la caja— el boton se montaba encima del
                nombre, igual que en las filas de los enlaces.
              - El `spacing.md` de al lado es la **holgura del nombre**: el area de
                toque del boton es invisible, asi que un nombre que termina
                exactamente donde empieza queda pegado a algo que no se ve. El
                nombre largo necesita aire, y eso no lo resuelve el ancho del boton.

              Y el hueco del asa de arrastrar no vuelve: la fila no se arrastra, se
              ordena en una hoja.
            */
            paddingRight: onMenu ? ANCHO_RESERVADO + theme.spacing.md : theme.spacing.md,
          },
        ]}
      >
        <View
          style={[styles.icono, { borderRadius: theme.radius.md, backgroundColor: iconTint }]}
        >
          {row.kind === "collection" && row.emoji ? (
            <AppText variant="bodyStrong">{row.emoji}</AppText>
          ) : (
            <AppIcon icon={row.icon} size={16} inheritColor={foreground} fallback={respaldo} />
          )}
        </View>
        <View style={[styles.crece, { gap: 2 }]}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {row.name}
          </AppText>
          <AppText variant="caption" tone="subtle" numberOfLines={1}>
            {subtitulo(row, t)}
          </AppText>
        </View>
      </Pressable>
      {nombre.sheet}
      {/*
        The menu and the drag handle are both on the right of the row, and the
        handle spans its whole height — so the menu has to sit to the *left* of it,
        not on top of it. On top meant the handle caught every tap: a row you
        could order but whose menu you could never open, which is the worst of
        both, and it looked fine because one of the two glyphs was showing.
      */}
      {onMenu ? <MenuButton label={row.name} onPress={onMenu} /> : null}
    </View>
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
  if (row.kind === "collection") {
    const enlaces = row.bookmarkCount ?? 0;
    if (enlaces === 0) return t("collections.empty");
    return enlaces === 1 ? t("collections.count.one") : t("collections.count.other", { count: enlaces });
  }
  if (row.kind === "folder") return t("content.kind.folder");
  const clase = t(`content.kind.${row.listKind ?? "tasks"}` as never);
  return t("content.itemsIn", { count: row.itemCount ?? 0, kind: clase });
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
  asa: {
    position: "absolute",
    // A la derecha y no a la izquierda: el menu de la fila esta a la derecha, y
    // un asa de arrastre encima de el seria un blanco de un dedo de ancho donde
    // alguien no puede ni abrir el menu ni mover la fila.
    right: 8,
    bottom: 6,
  },
});
