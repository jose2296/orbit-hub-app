import { useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import type { Folder, List, ListItem, ListKind } from "@orbit-hub/contracts";

import { MediaFiltersBody } from "@/components/media/media-filters-body";
import {
  EMPTY_MEDIA_FILTER,
  matchesMediaFilter,
  mediaFilterCount,
  type MediaFilter,
} from "@/lib/lists/media-filter";
import { ListControls } from "@/components/lists/list-controls";
import { MediaReorderSheet } from "@/components/media/media-reorder-sheet";
import { MediaTabs, type MediaTab } from "@/components/media/media-tabs";
import { VerticalMediaCarousel } from "@/components/media/vertical-media-carousel";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { Screen } from "@/components/ui/screen";
import { useLists } from "@/hooks/use-lists";
import { useTranslation } from "@/lib/i18n";
import { canReorder, orderItems } from "@/lib/lists/item-presentation";
import { mediaCardOf } from "@/lib/lists/media-card";
import { useTheme } from "@/theme";

/**
 * A list of films, series or books, **as one screen of its own**.
 *
 * It used to be the tasks list with a strip of covers in its header, which meant
 * the covers got whatever height was left under a header that only made sense for
 * the other kind of list, and a list of two hundred titles showed three. Here the
 * carousel is the page, and everything that used to be a knob above a list of
 * tasks — the order, the filters, the seen ones — is around it.
 *
 * **Seen and not seen are two tabs, not a filter.** The old app had a switch
 * inside the filters sheet, and the size of what you were looking at was a
 * setting. Two tabs with the count on them answer "where are the ones I have not
 * seen" with a glance, and the counts are what tell you which one to open.
 *
 * **The manual order has a sheet with handles, because the carousel cannot
 * rearrange itself.** One poster per screen means there is nothing on screen to
 * move something towards, and a drag that has to fight the scroll is a drag that
 * sometimes scrolls instead. The sheet writes through the same `moveItem` a task
 * list uses, and when it closes the carousel is still there showing the order that
 * was just arranged.
 *
 * **Which orders are offered depends on the list.** A shopping list has no
 * release date, so it is not offered one; `priority` belongs to a shopping list
 * and is not offered here. Five orders for a list of things that were released:
 * manual, by title both ways, by when it was added, and by when it came out both
 * ways.
 */
/**
 * The orders offered for a list of things that were released, **and the words for
 * them**.
 *
 * `released` is only offered for a list whose rows have a release date. A list of
 * films does; a shopping list does not, and offering "by when it came out" there
 * is a button that answers with nothing.
 */
const ORDENES: { mode: List["orderMode"]; key: string }[] = [
  { mode: "manual", key: "order.manual" },
  { mode: "alphabetical", key: "order.alphabetical" },
  { mode: "alphabetical_desc", key: "order.alphabetical_desc" },
  { mode: "created_asc", key: "order.created_asc" },
  { mode: "created_desc", key: "order.created_desc" },
  { mode: "released_asc", key: "order.released_asc" },
  { mode: "released_desc", key: "order.released_desc" },
];

export function MediaListScreen({
  list,
  items,
  isLoading,
  listKind,
  workspace,
  listId,
  folders,
  menuFor,
  crear,
  onOpenDetails,
  onMenu,
  onMoveItem,
  listOpen,
  onCloseItemMenu,
  onCloseListMenu,
}: {
  list: List | null;
  items: ListItem[];
  isLoading: boolean;
  listKind: ListKind;
  workspace: {
    color?: string | null;
    colorTo?: string | null;
    wash?: "diagonal" | "vertical" | null;
  } | null;
  listId: string;
  folders: Folder[];
  menuFor: ListItem | null;
  crear: ReactNode;
  onOpenDetails: (item: ListItem) => void;
  onMenu: (item: ListItem) => void;
  onMoveItem: (id: string, toIndex: number) => void;
  /** Whether the list's own menu is open, which the header's dots toggle. */
  listOpen: boolean;
  onCloseItemMenu: () => void;
  onCloseListMenu: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  /**
   * Writing the order, and **this is what was missing**.
   *
   * The sheet of orders closed itself and did nothing else: it never called
   * `setOrderMode`, so choosing "by title" closed the sheet, left the list in the
   * order it was in and showed a check on the option that was not on. The order
   * lives on the list, and a screen that only reads it is a screen that shows the
   * order and cannot change it.
   */
  const { setOrderMode } = useLists({});

  const [pestana, setPestana] = useState<MediaTab>("pending");
  const [filtro, setFiltro] = useState<MediaFilter>(EMPTY_MEDIA_FILTER);
  const [reordenarAbierto, setReordenarAbierto] = useState(false);

  /**
   * The order, and **the manual one is kept whichever order is being looked at**.
   *
   * `orderItems` never renumbers, so choosing "by title" to look at something and
   * going back to manual is the same order it was. That is the condition on having
   * the reorder sheet: closing it leaves the carousel on screen, on the same list,
   * showing what was just arranged.
   */
  const orderMode = list?.orderMode ?? "manual";
  const sorted = useMemo(() => orderItems(items, orderMode), [items, orderMode]);

  /**
   * The filter, and **it only ever removes rows**.
   *
   * Filtering the seen list by "not seen" gives nothing, so the two tabs stay
   * independent: each is filtered by the same filter and neither changes the
   * other. The tab is what you are looking at and the filter is what of it.
   *
   * **`matchesMediaFilter` and not a copy of it here.** The sheet counts the rows
   * each chip would leave, and it counts them with this function; a second copy
   * in this file is how a chip says "3" and the list shows five, with neither
   * copy wrong on its own.
   */
  const pasa = useMemo(
    () => (item: ListItem) => matchesMediaFilter(item, filtro),
    [filtro],
  );

  const pendientes = useMemo(
    () => sorted.filter((item) => !item.completed && pasa(item)),
    [sorted, pasa],
  );
  const vistos = useMemo(
    () => sorted.filter((item) => item.completed && pasa(item)),
    [sorted, pasa],
  );

  const enPestana = pestana === "pending" ? pendientes : vistos;

  /**
   * The orders, **and the one that is on carries the tick**.
   *
   * A function and not a memo: the list it maps over closes over the order, and a
   * memo would hand back the array built the first time with the tick that was on
   * then.
   */
  const opcionesDeOrden = () =>
    ORDENES.map((o) => ({
      key: o.mode,
      label: t(o.key as never),
      icon: o.mode === orderMode ? ("checkmark" as const) : ("ellipse-outline" as const),
      onPress: () => {
        if (list) void setOrderMode(list, o.mode);
      },
    }));

  const claveOrden =
    ORDENES.find((o) => o.mode === orderMode)?.key ?? "order.manual";

  /*
    The same order with a word that fits in a button.
   *
    "Como yo lo pongo" is a good sentence and a terrible label: 167 points on a
    phone that is 390 wide, which is half the row for the state of one control.
    The sentence stays in the sheet, where it is a title with room to be one; the
    button says the short thing.
  */
  const etiquetaCorta = useMemo(
    () => t(`orderShort.${claveOrden.replace("order.", "")}` as never),
    [claveOrden, t],
  );

  return (
    <Screen
      scroll={false}
      wash={{
        color: workspace?.color,
        colorTo: workspace?.colorTo,
        wash: workspace?.wash ?? null,
      }}
      overlay={crear}
    >
      {/*
        The row of knobs, and it is **above** the carousel and not inside it.

        A filter that scrolls away with the posters is a filter you have to scroll
        back up to use, and this carousel is exactly as tall as the screen by
        design. So the two rows above it are the only chrome the page has, and
        together they take a fifth of it: the price of being able to see and change
        what you are looking at.
      */}
      <View style={[styles.cabecera, { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }]}>
        <MediaTabs
          value={pestana}
          onChange={setPestana}
          pendingCount={pendientes.length}
          seenCount={vistos.length}
          /*
            The tabs are named after **what is in them**, and not after what you can
            do to them.

            They said "Marcar como vistos" and "Por ver" — a verb and its opposite,
            swapped, so the tab you press to see what you have not watched was the
            one that said "watched" and the other one was an instruction. A tab is a
            place, and a place has a name; the verb belongs on the button inside
            the film.
          */
          pendingLabel={
            listKind === "books" ? t("mediaTabs.pendingBooks") : t("mediaTabs.pending")
          }
          seenLabel={listKind === "books" ? t("mediaTabs.seenBooks") : t("mediaTabs.seen")}
        />

        {/*
          The three knobs, **on a row that scrolls and not on one that fits**.

          Measured at 390: "Como yo lo pongo" is 167 points, "Filtrar" 87 and
          "Ordenar" 102, and with the gaps that is 404 — fourteen past the edge of
          the phone, with the last button cut in half and no way to know there is
          one more. A row that does not fit is not a row that fits less; it is a
          row that lies about what is in it.

          So the row scrolls sideways, which is what a row of things that may or may
          not fit is for, and the order button says **"A mano"** instead of the
          sentence: a button whose label is the whole idea takes the space of three
          buttons, and the sentence still says the same thing in the sheet, where it
          is a title with room to be one.
        */}
        {/*
          The controls, **one of them, and the same control as the folders have**.

          It was three buttons in a row here and three in a row over the folders
          and three over the tasks, all answering one question and each opening a
          sheet of its own. One button that says what is on, and one sheet with the
          three things in it, is one control in three places — see `ListControls`.
        */}
        <ListControls
          filterCount={mediaFilterCount(filtro)}
          orderLabel={etiquetaCorta}
          orders={opcionesDeOrden()}
          canReorder={canReorder(orderMode)}
          onReorder={() => setReordenarAbierto(true)}
          testID="media-controls"
        >
          <MediaFiltersBody
            items={sorted}
            filter={filtro}
            onFilterChange={setFiltro}
            listKind={list?.kind ?? null}
          />
        </ListControls>
      </View>

      {isLoading ? null : (
        <VerticalMediaCarousel
          items={enPestana.map((item) => {
            const card = mediaCardOf(item);
            return {
              key: item.id,
              title: item.title,
              imageUrl: card?.imageUrl ?? null,
              released: card?.released ?? null,
              badge:
                listKind === "books"
                  ? t("itemDetails.book")
                  : card?.mediaKind === "tv"
                    ? t("itemDetails.series")
                    : t("itemDetails.movie"),
              completed: item.completed,
              onPress: () => onOpenDetails(item),
              onMenu: () => onMenu(item),
              menuLabel: t("mediaActions.menuOf", { name: item.title }),
            };
          })}
          emptyTitle={t("items.empty.title")}
          emptyBody={pestana === "pending" ? t("mediaActions.allSeen") : t("mediaActions.noneSeen")}
        />
      )}

      <MediaActionsSheet
        item={menuFor}
        listId={listId}
        listKind={listKind}
        onClose={onCloseItemMenu}
      />

      {/*
        The list's own menu, **gated on the state and not on the list**.
         *
        It was `list ? ... : null`, and a list on this screen is never null, so
        the sheet came up on its own the moment the screen opened — and could not
        be closed, because the thing it showed was not state anybody could set
        back. `ListMenuSheet` takes the list or nothing as its "is it open" signal,
        which is a trap: the same prop means "which list" and "is it open", and
        passing a real one says yes for ever.
       */}
      {listOpen && list ? (
        <ListMenuSheet
          list={list}
          folder={list.folderId ? (folders.find((f) => f.id === list.folderId) ?? null) : null}
          onClose={onCloseListMenu}
        />
      ) : null}




      {/*
        The **whole list**, and not the current tab's rows.
         *
        The manual order is a property of the list, not of a tab, and `moveItemTo`
        renumbers positions across everything in it. Handing it the three "not
        seen" rows when the list has four means the index of a row in the sheet is
        not its index in the list, so a drag computed against the sheet's rows
        lands somewhere else — and the one thing a manual order must be is honest
        about where things are.

        It is also the better thing to show: the order you are arranging is the
        order the carousel will come back in, whatever tab you are on.
      */}
      <MediaReorderSheet
        open={reordenarAbierto}
        visible={sorted}
        onMove={onMoveItem}
        onClose={() => setReordenarAbierto(false)}
        title={t("order.reorder")}
        body={t("order.reorderHint")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cabecera: {
    paddingBottom: 8,
  },
  filaBotones: {
    // Sin `flex: 1`: un `ScrollView` horizontal con el alto por su contenido se
    // mide solo, y con el flex toma el alto de la pantalla y empuja el carrusel
    // fuera de la vista.
    flexGrow: 0,
  },
});
