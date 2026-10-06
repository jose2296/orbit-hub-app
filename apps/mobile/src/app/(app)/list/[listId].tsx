import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, View } from "react-native";

import type { ListItem, ListOrderMode } from "@orbit-hub/contracts";

import { releaseSharedCover } from "@/lib/media/shared-cover";
import { bottomCluster } from "@/lib/layout/bottom-cluster";
import { normaliseToCompare } from "@/lib/lists/done-match";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { EmptyState } from "@/components/ui/empty-state";
import { MediaListScreen } from "@/components/media/media-list-screen";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { FiltersBody } from "@/components/lists/item-picker";
import { ListControls } from "@/components/lists/list-controls";
import { ItemEditSheet } from "@/components/lists/item-edit-sheet";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { TaskRow } from "@/components/lists/task-row";
import { Screen } from "@/components/ui/screen";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { TextField } from "@/components/ui/text-field";
import { ReorderSheet } from "@/components/ui/reorder-sheet";
import { AppText } from "@/components/ui/text";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useListItems, useLists } from "@/hooks/use-lists";
import { useHeaderAction } from "@/components/ui/header-action";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useScreenShare } from "@/hooks/use-screen-share";
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
  // Which row is being edited and where the panel opens, and *not* a copy of the
  // row: the panel needs the row as it is now, because it is the one that
  // changes it. A snapshot taken when the panel opened goes stale on the first
  // write, and the panel then paints the previous choice and sends the previous
  // value back — which is how picking an icon and then a colour lost the icon.
  const [editing, setEditing] = useState<{
    /** Empty when the panel is creating a row rather than editing one. */
    itemId: string;
    page: "edit" | "icon" | "tags";
    /** Lo que se estaba buscando, para no escribirlo dos veces. */
    tituloInicial?: string;
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
  /*
   * El buscador de la lista.
   *
   * Busca **por los dos lados**: completados y pendientes. Antes los completados
   * vivian en una bandeja aparte, y un sitio aparte no se busca —una bandeja se
   * recorre con el pulgar, no se consulta con una palabra—. Quien quiere
   * encontrar algo que ya dio por hecho usa el buscador, no baja a mirar una fila
   * de las que ya tachaste.
   *
   * El texto se compara con `normaliseToCompare`, el mismo que usa el buscador de
   * carpetas, listas y notas, y por el motivo de entonces: acentos y mayusculas no
   * pueden decidir si algo aparece.
   */
  const [buscando, setBuscando] = useState(false);
  const [textoBusqueda, setTextoBusqueda] = useState("");
  const terminoBusqueda = textoBusqueda.trim();

  const sorted = useMemo(
    () => orderItems(items, orderMode),
    [items, orderMode],
  );
  const visible = useMemo(
    () =>
      filterItems(sorted, {
        tags: selectedTags,
        completed: filterState,
      }),
    [sorted, selectedTags, filterState],
  );
  const labels = useMemo(() => tagsByFrequency(items), [items]);

  /*
   * El buscador entra **despues** de los filtros y del orden, y sobre lo visible.
   * Al reves —filtrar la lista entera antes de ordenar— lo que se busca seria
   * "lo que hay", que es distinto de "lo que estas viendo", y con la bandeja
   * fuera esa distincion se nota: no hay otro sitio donde mirar.
   */
  const visibles = useMemo(() => {
    if (!terminoBusqueda) return visible;
    const normalizado = normaliseToCompare(terminoBusqueda);
    return visible.filter((item) => normaliseToCompare(item.title).includes(normalizado));
  }, [visible, terminoBusqueda]);

  const pending = useMemo(
    () => visibles.filter((item) => !item.completed),
    [visibles],
  );

  const completed = useMemo(
    () => visibles.filter((item) => item.completed),
    [visibles],
  );
  const activeFilterCount =
    selectedTags.length + (filterState === "all" ? 0 : 1);
  /**
   * The bottom-right corner, counted once.
   *
   * It used to be `spacing.lg * 2 + 56 + spacing.md` written here, which left a
   * gap of twenty-eight points between the `+` and the tray for a button that is
   * thirty-six: the filter button could not go above the `+` without landing on the
   * tray. See `bottomCluster` and `test/bottom-cluster.test.ts`.
   */
  /*
    El alto del teclado, leido **a mano** y no el relying en el
    `KeyboardAvoidingView` de `Screen`.
    reason: en Android el teclado **mueve** la ventana —la app no declara
    `android.windowSoftInputMode`, y lo que hace Android por defecto es
    `adjustPan`, que traslada el origen y no toca el alto—. Un hijo con
    `position: absolute` dentro de un `KeyboardAvoidingView` con `padding` depende
    de que ese padding se aplique, y en `adjustPan` la ventana se ha movido sin que
    el layout cambie. Es justo el caso en el que los botones se quedan **debajo**
    del teclado.

    Leyendolo del evento y sumandolo a las medidas de la pila, los tres botones
    suben por el mismo numero que sube el teclado, en las tres plataformas, y sin
    depender de como el sistema decida mover la ventana.
  */
  const teclado = useKeyboardHeight();
  const { refreshControl } = usePullToRefresh();

  const pila = bottomCluster(theme);
  const canDrag = canReorder(orderMode);

  /** Cuanto sube **toda** la pila: lo que tapa el teclado. */
  const porTeclado = teclado > 0 ? teclado + theme.spacing.md : 0;

  /*
   * El buscador de la lista, y lo que cambia con el.
   *
   * Busca **por los dos lados**: completados y pendientes. Antes los completados
   * vivian en una bandeja aparte, que es un sitio donde no se busca: una bandeja
   * se recorre con el pulgar, no se consulta con una palabra. Y quien quiere
   * encontrar algo que ya dio por hecho usa el buscador, no baja a mirar una fila
   * de las que ya tachaste.
   *
   * El texto se compara con `normaliseToCompare`, el mismo que usa el buscador
   * de carpetas, listas y notas — y por el motivo que esa vez: acentos y mayusculas
   * no pueden decidir si aparece algo.
   */
  const termino = textoBusqueda.trim();


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
    /*
      Y los completados van **en la misma lista**, sin su seccion encima.

      Con la bandeja fuera y el buscador trayendolos por los dos lados, una
      cabecera de "completados" que separa la lista en dos mitades es justo lo que
      se estaba quitando: hace que "cuantas cosas llevo" se lea como dos numeros
      en vez de uno. El filtro de la cabecera sigue estando para quien quiera ver
      solo unas.
    */
    const completadosVisibles = showCompleted
      ? visibles.filter((item) => item.completed)
      : [];
    completadosVisibles.forEach((item, index) =>
      rows.push({ kind: "row", item, index }),
    );
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
  useScreenTitle(list?.title ?? t("lists.notFound"), list?.icon ?? null);

  /*
   * La insignia de compartido, **al lado del titulo y no en un hueco de la barra**.
   *
   * No hay boton de compartir en la cabecera: compartir es una accion, y las
   * acciones van en los tres puntitos. Esto no es un boton, es **una nota sobre lo
   * que estas mirando** — y solo aparece cuando hay algo que decir. Dos iconos
   * distintos porque son dos hechos distintos: te lo dieron, o tu lo diste.
   */
  useScreenShare({
    node: list ? { nodeType: "list", id: list.id } : null,
    conmigo: list?.shared === true,
    onShare: () => setMenuOpen(true),
  });


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
  /*
   * El boton de buscar, encima del de filtros, y el `+` debajo de los dos.
   *
   * Va en la pila y no en la cabecera porque comparte sitio con el `+`: tres
   * botones de la misma forma, alineados al mismo borde, y la pila se cuenta una
   * vez en `bottomCluster` para que no se solapen.
   */
  const botonBuscar = (
    <Pressable
      testID="item-search-button"
      accessibilityRole="button"
      accessibilityLabel={t("lists.searchItems")}
      {...pistaCreate.props}
      /*
        Alterna, y no solo abre.

        Un boton que solo abre y un campo que se cierra solo son dos controles
        para lo mismo, y el que se cierra solo tiene que adivinar: se cerraba al
        vaciarse el campo, lo que significaba que **no se podia buscar a vacio** —
        que es justo cuando uno empieza a escribir, antes de tener nada escrito.
        Pulsar el mismo boton que lo abrio para cerrarlo es lo que se espera, y no
        hace falta un segundo boton ni un gesto escondido.
      */
      onPress={() => {
        setBuscando((abierto) => !abierto);
        if (buscando) setTextoBusqueda("");
      }}
      style={({ pressed }) => [
        styles.searchButton,
        {
          bottom: pila.searchBottom + porTeclado,
          right: pila.fabBottom,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.surface,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name="search" size={18} color={theme.colors.text} />
    </Pressable>
  );

  /*
   * El campo de busqueda, **arriba de todo** y no encima de la lista: se abre a
   *hijo del boton, asi que tiene que aparecer donde el ojo ya esta, no donde este
   * el item que se busca.
   *
   * Y al lado, un boton que crea el item con **lo que se estaba buscando dentro**.
   * Es la accion obvia de quien no encuentra algo: no a abrir un formulario en
   * blanco, sino a abrirlo con la palabra ya escrita. Sin eso, escribir el nombre
   * es escribir dos veces lo mismo.
   */
  /*
   * El campo, y **dentro de la pantalla y no fuera**.
   *
   * Estaba montado como hermano del `<Screen>`, y un hermano cae donde le toca en
   * el flujo del padre: se dibujaba **abajo**, debajo de todo, yendo al fondo del
   * esqueleto de la pantalla. Es el sitio del que mas se queja quien lo busca, y el
   * unico que no se puede deducir leyendo el sitio donde se pulsa.
   *
   * Y va arriba de todo, dentro del area que scrollea: se abre a hijo del boton que
   * esta en la esquina de abajo, y un campo que aparece donde el ojo ya esta no es
   * un campo que hay que encontrar.
   */
  const campoBusqueda = buscando ? (
    <View
      style={[
        styles.buscador,
        {
          gap: theme.spacing.sm,
          // Justo encima de la pila, y la pila justa encima del teclado.
          bottom: porTeclado + pila.searchBottom + pila.searchHeight + theme.spacing.sm,
          left: theme.spacing.lg,
          right: theme.spacing.lg,
        },
      ]}
    >
      <TextField
        autoFocus
        value={textoBusqueda}
        onChangeText={setTextoBusqueda}
        placeholder={t("lists.searchItems")}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        containerStyle={styles.campoAncho}
        testID="item-search-field"
      />
      {/*
        Y el de crear es **solo un `+`**.

        Con el texto al lado el campo se quedaba en dos tercios del ancho y el
        buscador —que es un campo, y un campo estrecho es un campo en el que se
        escribe de menos— era la parte que pagaba el ancho. Ademas el boton largo
        decia "Crear con ese nombre", que es una frase de confirmacion para una
        accion de la que ya no hay duda: no estas creando otra cosa, estas creando
        la que no encontraste.

        El `+` de aqui abre **el mismo panel de crear que el de abajo**, con el
        nombre ya escrito. Y no con el texto en blanco, que es como estaba: el
        boton de al lado abria el modal y el campo venia vacio, o sea que habia que
        teclear dos veces justo lo que ya se habia tecleado una.
      */}
      <Pressable
        testID="item-search-create"
        accessibilityRole="button"
        accessibilityLabel={t("lists.createFromSearch")}
        disabled={termino.length === 0}
        onPress={() => {
          const texto = termino;
          setBuscando(false);
          setTextoBusqueda("");
          setEditing({ itemId: "", page: "edit", tituloInicial: texto });
        }}
        style={({ pressed }) => [
          styles.botonMasBusqueda,
          {
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.accent,
            opacity: termino.length === 0 ? 0.4 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={22} color={theme.colors.onAccent} />
      </Pressable>
    </View>
  ) : null;

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
            bottom: pila.fabBottom + porTeclado,
            right: pila.fabBottom,
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

      /*
        The controls, through `overlay` and not from the header — and this was the
        second attempt, because the first one was wrong in a way only the browser
        showed.

        With `placement="floating"` the button was **still at the top** (`top: 5`),
        because `position: absolute` anchors to the nearest positioned ancestor, and
        inside a `ListHeaderComponent` that ancestor is the header: a short box near
        the top. So `bottom: 80` meant eighty points above the bottom of the header,
        not of the screen. Out of the flow and not anchored to the screen are two
        different things.

        `overlay` is a sibling of the scroller inside the same
        `KeyboardAvoidingView`, and `Screen`'s own comment explains why that is the
        only spot that holds: on the web `react-native-web` puts an identity
        `transform` on every `ScrollView`, and a transformed ancestor turns
        `position: fixed` into `absolute` without saying so.
      */
      overlay={
        !media && !isLoading && items.length > 0 ? (
          <ListControls
            filterCount={activeFilterCount}
            orderLabel={t(`orderShort.${orderMode}` as never)}
            orders={opcionesDeOrden()}
            canReorder={canReorder(orderMode)}
            onReorder={() => setReorderOpen(true)}
            testID="task-controls"
            placement="floating"
            floatingBottom={pila.controlsBottom + porTeclado}
            floatingRight={pila.fabBottom}
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
              activeCount={activeFilterCount}
              onReset={() => {
                setSelectedTags([]);
                setFilterState("all");
              }}
            />
          </ListControls>
        ) : null
      }
    >
      {/*
        El campo de buscar va **dentro de la pantalla**, y no como hermano suyo.

        Estaba montado fuera, y un hermano cae donde le toca en el flujo del padre:
        se dibujaba abajo, debajo de todo, yendo al fondo del esqueleto. Es el
        sitio del que mas se queja quien lo busca, y el unico que no se puede
        deducir leyendo donde se pulsa el boton.

        Y va **antes que la lista**, no dentro de ella: se abre a hijo de un boton
        que esta en la esquina de abajo, y un campo que aparece donde el ojo ya
        esta no es un campo que hay que encontrar.
      */}
      {campoBusqueda}
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
          /*
            Tirar hacia abajo recarga, y **esta pantalla no lo tenia**.

            Traia su propio `FlatList` porque la lista trae una cabecera y un pie que
            `Screen` no compone, asi que el scroller no era el de `Screen` y el
            `RefreshControl` de `Screen` no tenia donde colgarse. Por eso se veia
            "dentro de carpetas" y no aqui, que es justo donde mas se mira.

            El gesto va en el scroller que realmente esta en pantalla, no en el
            contenedor: el mismo `usePullToRefresh`, el mismo motor, la misma
            pregunta de siempre.
          */
          refreshControl={refreshControl}
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
      {/*
        La bandeja de completados **no esta**.

        Era un sitio donde lo hecho vivia aparte, y un sitio aparte no se busca:
        una bandeja se recorre con el pulgar, no se consulta con una palabra. Y
        quien quiere encontrar algo que ya dio por hecho usa el buscador, no baja
        a mirar una fila de las que ya tachaste. El buscador de arriba busca por los
        dos lados, y con eso la bandeja no anade nada que no tuviera ya — solo un
        sitio mas donde lo de arriba no esta.
      */}

      {botonBuscar}
      {crear}


      <ItemEditSheet
        item={editingItem}
        listId={listId}
        mode={editing && editing.itemId === "" ? "create" : "edit"}
        startOn={editing?.page ?? "edit"}
        /*
          Y el nombre que se estaba buscando.

          Sin esto el boton de al lado abria el panel de crear **en blanco**, que
          es la forma mas larga de crear la tarea que estabas buscando: teclear el
          nombre en el buscador, no encontrarlo, y teclearlo otra vez en un
          formulario que ya te habia mostrado el texto.
        */
        initialTitle={editing?.tituloInicial}
        tagColors={list?.tagColors ?? {}}
        onTagColor={(tag, color) =>
          /*
           * `setTagColor` plans from the cache it is about to write, not from
           * **this** `list`, so two colour writes before the next render plan
           * from two different maps and the second keeps the first. That is what
           * lets the sheet keep its picker open while colours are chosen: a tap
           * is still one write of one label, and the promise comes **back**
           * rather than being dropped with a `void` — but nothing waits for it
           * to take the picker down any more. The picker stays, the pill follows
           * every tap through the sheet's optimistic map, and closing is the
           * person's own press (the pencil, or "close"), not the write's.
           */
          list ? setTagColor(list.id, tag, color) : undefined
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
  /**
   * El campo de buscar, **a todo el ancho util**.
   *
   * `alignSelf: stretch` y no `alignItems: center`, porque en una columna centrada
   * un hijo sin ancho se queda con el ancho de su contenido —o sea, con el ancho
   * del texto que lleva escrito, y un buscador que se estrecha al escribir es un
   * buscador en el que se escribe de menos.
   */
  /**
   * El campo, **anclado a la esquina de abajo** y no en el flujo.
   *
   * Was the first child of the list and it was wrong in the way that matters most
   * on Android: a field in the flow sits where the flow puts it —top of the
   * screen— while the keyboard covers the bottom third, and the two of them never
   * meet. Somebody typing a search does not watch the field; they watch the
   * keyboard.
   *
   * So it is pinned to the bottom, above the cluster, and the cluster is pinned
   * above the keyboard. The field is therefore **where the fingers are**, which is
   * where the eyes are when you are typing.
   */
  buscador: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
  },
  /** El campo ocupa lo que queda del ancho, y el `+` lo que necesita. */
  campoAncho: {
    flex: 1,
    minWidth: 0,
  },
  /** El `+` de al lado, del tamaño del `+` de la esquina. */
  botonMasBusqueda: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  /** El boton de buscar, y su tamano es el que cuenta `bottomCluster`. */
  searchButton: {
    position: "absolute",
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
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
