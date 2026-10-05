import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { BoardColumn } from "@/components/lists/board-column";
import { BoardTabs } from "@/components/lists/board-tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FloatingButton } from "@/components/ui/floating-button";
import { ItemEditSheet } from "@/components/lists/item-edit-sheet";
import { StateEditorSheet } from "@/components/lists/state-editor-sheet";
import { StatePickerSheet } from "@/components/lists/state-picker-sheet";
import { Screen } from "@/components/ui/screen";
import { useHeaderAction } from "@/components/ui/header-action";
import { useListItems, useLists } from "@/hooks/use-lists";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useTranslation } from "@/lib/i18n";
import type { BoardStates } from "@orbit-hub/contracts";
import {
  columnLayout,
  columnOffset,
  countInState,
  deleteStatePlan,
  newState,
  stateIdToWrite,
  tasksInState,
} from "@/lib/lists/board";
import {
  anchorableColumns,
  maxTrackScroll,
  nextPageFor,
  parallaxPage,
  scrollTargetFor,
  trackContentWidth,
  trackRoomAt,
} from "@/lib/lists/board-paging";
import { routeForList } from "@/lib/lists/route";
import { useTheme } from "@/theme";

/**
 * How much of a column comes back when there is no column to go to.
 *
 * The track moves a third of the way and stops, rather than letting the end of the
 * board come into view. A column that will not go is one somebody has already
 * tried, and the resistance is what says so without a line of text — and it is the
 * same number the panel's pager uses, for the same reason: a page that will not go
 * is a page you have tried already.
 */
const EDGE_RESISTANCE = 3.4;

/**
 * How long the track takes to come back under the column it is going to.
 *
 * From the distance it has left to travel and not a fixed number, and the same
 * three numbers the panel's pager settles its track with. The finger stopped
 * somewhere and the board has to get from *there* to the column it is heading for:
 * a fixed duration makes a track that had nearly arrived crawl and one that had
 * barely started race past, and a swipe that changes speed depending on how much
 * of it was left reads as two different gestures.
 */
const PAGE_SPEED = 2.6;
const PAGE_MIN = 90;
const PAGE_MAX = 320;

/**
 * The board of a list.
 *
 * **One screen for the three targets, and the width is what decides.** A narrow
 * window shows one state full-screen; a wide one divides the width between as
 * many columns as fit at `BOARD_COLUMN_MIN_WIDTH` and scrolls sideways with
 * anchoring when they do not all fit. Two screens would have been two lists of
 * things that break separately — two sets of empty states, two of errors, two of
 * nothing — and the width already answers the question on its own.
 *
 * **The track snaps with `pagingEnabled`, and not with `snapToInterval`, and the
 * reason is in the code of the media carousel**: `react-native-web@0.21` implements
 * `pagingEnabled` as CSS scroll-snap and **ignores `snapToInterval` completely**.
 * On the web that makes `pagingEnabled` snap to the start of **each child of the
 * track**, which is exactly the behaviour a board wants: one column at a time,
 * whatever the width, because the columns *are* the children. And it is also why
 * the width of a column is measured here and not computed by the scroller: an
 * interval the browser does not implement is an interval this screen would have to
 * lie about.
 *
 * **On a narrow screen a column is the width of the scroller**, so `pagingEnabled`
 * is a full page there too, and the two behaviours are the same code.
 *
 * **What `pagingEnabled` does on a wide native screen is a page, not a column, and
 * it is written down here rather than measured.** React Native's `pagingEnabled`
 * snaps to the size of the scroller —one window at a time— where the web version
 * snaps to each child. So on a tablet, where three columns fit, a flick moves
 * three columns at once instead of one. It is not fixed by passing `snapToInterval`
 * as well: on both platforms `pagingEnabled` wins over the interval, so the second
 * prop would be read by nobody. **The swipe below is what replaces it**, and it is
 * the reason the snap is left alone rather than removed: the gesture decides which
 * column the board lands on, on every target, and it hands that decision to
 * `irA` — which scrolls to `columnOffset` and not to a page. **This is unverified
 * on a device**: no simulator or phone is attached to this machine, and the only
 * target that was looked at is the browser.
 *
 * **The swipe is the panel's swipe, and it is here because the two of them cannot
 * both be horizontal.** `panel-grid.tsx` turns a screen with a `Pan` that claims
 * the finger sideways and lets it go vertically — `activeOffsetX([-14, 14])` to
 * claim it and **`failOffsetY([-12, 12])` to give the vertical back** — and the
 * board's gesture is the same gesture with the same numbers, because it is the same
 * finger crossing a screen sideways to show what is next. **`failOffsetY` is the
 * whole of what makes this safe**: a card that is dragged up and down to reorder
 * itself inside its column has to be able to do that without fighting a pager, and
 * the guard is what lets the vertical through to the column's own scroll. Which
 * column it lands on is `nextPageFor`, a pure function in `lib/lists/` with the
 * panel's thresholds in it, and it moves **one** column at a time: a swipe pages,
 * it does not carry a card, and moving a card to another column is a sheet rather
 * than a gesture.
 */
export default function BoardScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { listId } = useLocalSearchParams<{ listId: string }>();

  const {
    lists,
    isLoading: isLoadingLists,
    setTagColor,
    updateList,
  } = useLists({});
  const list = useMemo(
    () => lists.find((item) => item.id === listId) ?? null,
    [lists, listId],
  );
  const { workspaces } = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.find((item) => item.id === list?.workspaceId) ?? null,
    [workspaces, list?.workspaceId],
  );
  const { items, isLoading: isLoadingItems, updateItem } =
    useListItems(listId);

  /**
   * The columns, **and the order of this array is the order they are drawn in**.
   *
   * It comes from the list row and it is `[]` for every kind that is not a board,
   * so the `?? []` is what a list that has not arrived yet gives. What is *not*
   * done here is inventing columns for an empty one: `defaultStates()` is called
   * at the moment a board is created, by the client, and nowhere else — a screen
   * that seeded the states it found missing would put the same four ids on two
   * boards and a rename in one would move the other's tasks.
   */
  const states = useMemo(() => list?.states ?? [], [list]);

  /**
   * How many tasks each column has, **and every one of them counted through
   * `countInState` rather than by counting a filtered list.**
   *
   * That is not an optimisation: `countInState` resolves each row's state with
   * `stateOf`, so the rows whose `stateId` is null —**every row created on a board**
   * — count in the first column. Counting `tasksInState(items, states, id).length`
   * would give the same number here, and `items.filter((i) => i.stateId === id)`
   * would give a column that says zero while three cards are drawn in it.
   */
  const counts = useMemo(() => {
    const porEstado = new Map<string, number>();
    for (const state of states) {
      porEstado.set(state.id, countInState(items, states, state.id));
    }
    return porEstado;
  }, [items, states]);

  /**
   * The tasks of each column, **computed once per change and not once per render.**
   *
   * `tasksInState` filters and sorts the whole list, so calling it inside the
   * `states.map` of the render meant a full pass over the list of tasks per column on
   * every render — and this screen renders on every notification of the store and on
   * every press of a tab. The memo makes it one pass per change of the tasks or of the
   * columns, and it hands each `BoardColumn` **the same array** while nothing has
   * changed, which is what lets a column tell that it does not have to draw itself
   * again.
   *
   * The counts above are a separate memo and stay separate on purpose: those use
   * `countInState`, which counts in one pass and **does not sort**, and `board.ts`
   * says why asking it for the number is not the same as counting a filtered list.
   */
  const columnas = useMemo(
    () =>
      states.map((state) => ({
        state,
        tasks: tasksInState(items, states, state.id),
      })),
    [items, states],
  );

  /** The width the board is given, measured, and zero until it has been. */
  const [ancho, setAncho] = useState(0);
  /**
   * The height of the track, measured, and zero until it has been.
   *
   * **It is a second measurement and not a flex rule, and the reason is a bug that
   * only a column with more cards than fit shows.** The chain from the track down to
   * the box of cards is a column of boxes on the web, and every one of them was
   * sized by its content: `flexGrow: 1` fills what is left but **does not shrink**,
   * and a box that is `flexShrink: 0` —which is what react-native-web gives every
   * `View`, and what React Native does too— stays as tall as its content. Measured
   * with seven cards in a track of 392: the column measured 610 and the box of cards
   * never scrolled, so the board ran off the bottom of the window instead of
   * scrolling inside its column.
   *
   * `flexShrink: 1` on the wrapper would fix the web and is exactly what must not
   * be done there: on native that wrapper is a child of the **row** inside the
   * scroll view, and shrinking in a row is shrinking the width, so four columns of
   * 271 would be squeezed into the 392 of the track. **So the height is measured
   * and handed down**, the same way the width is, and no flexbox has to have an
   * opinion about it on either target.
   */
  const [altoPista, setAltoPista] = useState(0);

  /**
   * The track's own width, measured, **and not the width of the box that measures
   * the board.**
   *
   * The floor of the rubber band is points, and points are measured against the
   * scroller itself: `maxScroll` is how much wider the row of columns is than the
   * thing that shows it, and that thing is this scroll view. The two widths are the
   * same in every measurement so far — 368 and 368 at a 400-point window, 1120 and
   * 1120 at 1440 with the drawer open — and using the outer one anyway would be a
   * number that happens to be right, which is the kind this file has been bitten by
   * twice.
   *
   * **It is a second `onLayout` and not a second read of the first one**, because
   * the box that measures the board is the one *around* the track and its layout
   * event fires first. So there is one render with a positive column width and a
   * zero track width, and in it `maxScroll` is 0 and the band is closed. Nothing can
   * be dragged in that frame: the gesture is not on a track that has no width yet,
   * and a finger that arrives before that is told to wait.
   */
  const [anchoPista, setAnchoPista] = useState(0);
  /** Which column the board is anchored on, by index — the tabs' and the track's. */
  const [actual, setActual] = useState(0);
  const pista = useRef<ScrollView>(null);

  /**
   * How wide a column is, and **the arithmetic is not here.**
   *
   * `columnLayout` owns it, in `lib/lists/board.ts`, with its tests and with the
   * two numbers that broke it: the count that left the board scrolling 36 points
   * with every column on screen, and the width that did not discount the gaps. The
   * screen's whole part is to hand it a measured width and a gap and to draw what
   * comes back — the alternative is a formula in a component that a test cannot
   * reach and a careless edit can undo without anything noticing.
   *
   * The gap is the theme's `spacing.md` because a gap is spacing and the spacing is
   * the theme's, and **the same number has to be the one `columnOffset` is given
   * below**, which is the whole of what keeps a jump from landing short.
   */
  const gapColumnas = theme.spacing.md;
  const { columnWidth: anchoColumna, columns: columnasQueCaben } = columnLayout(
    ancho,
    gapColumnas,
  );

  /**
   * How far apart two columns are, **and it is `columnOffset(1, …)` rather than
   * `anchoColumna + gapColumnas` written here.**
   *
   * The gesture needs that number on the interface thread, sixty times a second,
   * and a worklet cannot be trusted with a sum it was handed as two pieces: the gap
   * between the columns is the term that Task 8 got wrong, and putting it in a
   * worklet is putting it in the one place where no test can reach it. So the step
   * is asked of the function that owns it and the gesture is given the answer.
   */
  const pasoColumna = columnOffset(1, anchoColumna, gapColumnas);

  /**
   * Where every column starts inside the track, **asked of `columnOffset` one
   * column at a time and not summed here.**
   *
   * The worklet needs the edge of the column a swipe lands on, and the sum that
   * gets there — `index * (width + gap)` — is the one Task 8 got wrong by leaving
   * the gaps out. So the offsets are worked out here, with the function that owns
   * the arithmetic, and the worklet reads a number out of an array.
   */
  const offsets = useMemo(
    () =>
      states.map((_, index) =>
        columnOffset(index, anchoColumna, gapColumnas),
      ),
    [states, anchoColumna, gapColumnas],
  );

  /** How many columns the board has, as a plain number for the worklets. */
  const cuantasColumnas = states.length;

  /**
   * How far the track can be scrolled at all, **in points.**
   *
   * `trackContentWidth` is the row of columns the same way `columnOffset` says where
   * a column starts, so the two agree by construction, and `maxTrackScroll` takes
   * off what the scroller shows. Measured with five states and four of them visible:
   * **1403 of content in a track of 1120 gives 283**, which is what the browser
   * reports as `scrollWidth - clientWidth`.
   *
   * It is `anchoPista` and not `ancho` because the scroller is the thing being
   * measured; see the note on that state.
   */
  const maxScroll = maxTrackScroll(
    anchoPista,
    trackContentWidth(cuantasColumnas, anchoColumna, gapColumnas),
  );

  /**
   * How many columns the board can be **anchored on**, which is fewer than its
   * states as soon as more than one column is on screen.
   *
   * With five states and four visible the scroller has 283 points, which is one
   * column step, so only two of the five can sit flush against the left edge — and
   * a swipe has to be counted in those, not in the states, or it lands on a column
   * with no scroll behind it and moves the tab instead of the board.
   */
  const paginas = anchorableColumns(
    cuantasColumnas,
    maxScroll,
    pasoColumna,
  );

  /**
   * The travel that is a whole page of parallax, **and `anchoPista` is the strip's
   * width because the strip is this box.**
   *
   * `board-tabs` measures its own width for the same multiplication, and the two
   * measurements are of one box: the strip and the track are siblings inside the
   * padded area, both `flex: 1` across it, and both read 368 at a 400-point window
   * and 1120 at 1440. Taking the track's is not a shortcut — it is what makes the
   * parallax a fraction of the **board's** travel on every width; see
   * `parallaxPage`.
   */
  const paginaParalaje = parallaxPage(pasoColumna, anchoPista);

  /**
   * Whether there is anywhere to page to at all.
   *
   * **Both halves have to be true and the second one is the one that is easy to
   * forget.** A board of one column has nothing after it, and a board whose
   * columns all fit at the width it has has nothing off screen — so a gesture that
   * turned a page there would be a track that moves against the finger and comes
   * back, which reads as a broken control rather than as an end of the board.
   * `columns` from `columnLayout` says it without measuring anything: the count it
   * divides the width into is the count that fits, so `columns >= states.length`
   * is exactly "every column is already on screen".
   */
  const sePuedePaginar =
    cuantasColumnas > 1 && columnasQueCaben < cuantasColumnas;

  const readOnly = list?.role === "viewer";

  /**
   * A list that is not a board does not belong here.
   *
   * `replace` and not `push`, and the difference is what the back button does: with
   * a push, going back from the list screen lands on this screen, which replaces
   * itself with the list screen again, and the back button appears broken.
   *
   * **The screen it hands it to is `routeForList`, and that is the other half of a
   * chain.** Search, the content of a space and the catalogue build the route of a
   * list with `list?.kind ?? 'tasks'`, because the kind is not to hand there, and
   * the fallback sends them to `/list/:id`. They end up in the right place only
   * because `list/[listId].tsx` resolves the **same** list out of the same
   * `useLists({})` cache and replaces itself with this screen. Both links exist: if
   * this one is ever removed, the other three have to change with it, and nothing
   * fails in the meantime — a board opens as a list of tasks, which is close
   * enough to look right.
   */
  useEffect(() => {
    if (list && list.kind !== "board") router.replace(routeForList(list));
  }, [list, router]);

  useScreenSpace(
    list
      ? {
          id: list.workspaceId,
          color: workspace?.color,
          colorTo: workspace?.colorTo,
          wash: workspace?.wash,
        }
      : null,
  );
  useScreenTitle(list?.title ?? t("lists.notFound"));

  /* ------------------------------------------- el editor de estados -- */

  /**
   * Whether the states editor is open, **and it is a flag and not a row.**
   *
   * The row goes in when the panel opens and out when it closes, and what the panel
   * draws is the draft below rather than `list.states` — the same shape every other
   * sheet in this app is opened with, where `null` is the way a sheet is closed and
   * not a value it draws.
   */
  const [editorAbierto, setEditorAbierto] = useState(false);

  /**
   * The columns as the person is editing them, **and it is a copy of the list's own
   * array to begin with.**
   *
   * This is what makes the panel's edits local: the panel hands back a new array
   * through `onChange`, the screen keeps it here, and nothing reaches the outbox
   * until the panel closes. Editing four colours in a row is then **one** push, and
   * not four pushes of the same field with three of them overwritten by the last —
   * which is not a matter of tidiness: the states travel as one field of the list,
   * so they are one operation by construction, and the array it pushes is the whole
   * thing.
   *
   * **It starts as the very array the list row holds, and not a copy of it**, so the
   * "did anything change" question at the bottom is an identity comparison that can
   * come out false: every edit this panel makes replaces the array with a **new** one
   * —that is what `newState` and `editState` answer with— and a panel that is opened
   * and closed without being touched never replaces it. A copy would make the two
   * arrays unequal from the start and the comparison would always say yes.
   */
  const [borrador, setBorrador] = useState<BoardStates | null>(null);

  /**
   * The same two arrays, **readable at the moment the panel closes.**
   *
   * `onClose` reaches this screen from inside `Sheet`, and `Sheet` reaches it from
   * three places: the cross, the backdrop and a worklet that pulls the panel down
   * (`sheet.tsx`'s `descartar`, which calls it with `runOnJS`). The first two get
   * whatever function the render they belong to was given, and the third captures it
   * in the gesture — and a gesture is a thing that outlives the render that made
   * it for as long as the UI thread holds it. Reading `borrador` out of a closure
   * that may be one edit old is how a panel that renames two columns writes one of
   * them.
   *
   * **It is the same shape as `scrollPrevio` below**, and the same reason: the
   * truth a caller has to read is the latest one, and the latest one is not
   * necessarily in the closure.
   *
   * And `fila` is a `List` read the same way, which is safe where `borrador` was
   * not: `updateList` only ever uses `list.id`, and an id does not change under a
   * stale closure.
   */
  const borradorRef = useRef<BoardStates | null>(null);
  const alAbrirRef = useRef<BoardStates | null>(null);

  /** Opening: the draft starts as the list's own array, and both refs say so. */
  function abrirEditorDeEstados() {
    alAbrirRef.current = states;
    borradorRef.current = states;
    setBorrador(states);
    setEditorAbierto(true);
  }

  /** A change from the panel: it is the draft, and it has not been written. */
  function cambiarEstados(siguientes: BoardStates) {
    borradorRef.current = siguientes;
    setBorrador(siguientes);
  }

  /**
   * Closing: **one write, and only if something moved.**
   *
   * The comparison is by identity against the array the panel was opened with, and
   * that is a real question rather than a formality: `editState`, `newState`,
   * `moveState` and `removeState` all answer with **the array they were given**
   * when there is nothing to change, so a panel that was opened and closed without
   * being touched leaves the draft exactly as it found it, and a write here would
   * put an operation in the outbox for a session where nobody did anything.
   *
   * **The limit this step inherits is the spec's own and it is written down in
   * `docs/architecture/offline-sync.md`**: the columns are one field, so two people
   * editing the same board at once means the last one wins, whole. It is not a merge
   * and it is not fixed here.
   */
  function cerrarEditorDeEstados() {
    setEditorAbierto(false);
    const fila = list;
    const escrito = borradorRef.current;
    if (!fila || escrito === null || escrito === alAbrirRef.current) return;
    void updateList(fila, { states: escrito });
  }

  /* ------------------------------------------ borrar una columna con tareas -- */

  /**
   * Deleting a column that has tasks in it: **the tasks move first, with the
   * destination written out, and the column comes out of the array after.**
   *
   * **The order is the whole of this function and it is not a style.** A task left
   * pointing at a deleted column is drawn in whichever column is first afterwards —
   * `stateOf` resolves the unknown id to the first one and nothing anywhere fails,
   * so the task appears in a column nobody chose and there is no error to look for.
   * The other way round is the one the server refuses: an item update whose
   * `stateId` is not in its list's `states` comes back **rejected inside a push that
   * answers 200**, which from here is invisible.
   *
   * **Both halves are in one `await` chain for the same reason
   * `crearEstadoYMover` gives:** `localUpdate` does `getLocalStoreReady()`, then
   * `upsertCached`, then `enqueueOperation`, each one awaited, so two calls fired
   * without waiting interleave and the order is left to whatever each `await` took.
   * Chained, the item operations are enqueued before the array leaves the panel.
   * And **the array is not written here at all**: it is the draft, and the draft is
   * written once by `cerrarEditorDeEstados`, which is strictly after all of this.
   *
   * **That is why closing the panel in the middle of this cannot lose a task.** The
   * draft does not have the column out of it until the last line runs, so a close in
   * between writes the array **with the column still in it** and the tasks are moved
   * a moment later. The worst outcome of that race is a column that survived and a
   * column full of tasks that went somewhere — visible, recoverable, and the
   * opposite of the failure this ordering exists to prevent. Moving the tasks first
   * and taking the column out afterwards is what makes that the worst case instead
   * of the likely one.
   *
   * **The rows with a null `stateId` are the reason the plan calls this the part
   * that cannot lose data.** They are drawn in the first column, so deleting that
   * column is what catches them, and `deleteStatePlan` puts the destination on
   * every one of them by hand. Left alone they would become "the first column of
   * the new array" — a different column, chosen by an ordering. **The plan is what
   * does that and not this function**, and its `null` answers for the three ways
   * this cannot be done at all.
   *
   * **The array it is given is `borradorRef.current`, not `states`**, for the reason
   * the close above gives: this is reached from a `Promise.then` inside the panel,
   * so the draft on screen is whatever the screen was handed and the ref is the one
   * place that is never a render old. A ref that were a render old would write an
   * array with a column that was renamed two presses ago.
   */
  async function borrarColumna(stateId: string, destinoId: string) {
    const plan = deleteStatePlan(borradorRef.current ?? states, items, stateId, destinoId);
    if (!plan) return;
    for (const move of plan.moves) {
      // `stateId` is a `string` and not `string | null` in that plan, which is the
      // type doing what this comment says it is doing: `updateItem` takes
      // `string | null`, so a `null` here would compile and would mean "leave it
      // where it is" — the silent failure, and the one the plan calls review focus 3.
      await updateItem(move.item, { stateId: move.stateId });
    }
    cambiarEstados(plan.states);
  }

  /*
    The editor, **in the header, and it is created here rather than added to
    something.** `list/[listId].tsx` mounts its `ListMenuSheet` behind a ghost
    `iconOnly` button at `useHeaderAction`, and this is the same call with the same
    `testID` convention so a walkthrough has something stable to press. This screen
    had no header action at all —only `useScreenTitle`— so the button is new, and it
    is new for the reason the list screen's is: the columns of a board are edited
    from anywhere on the board, not from inside a card.

    **Two doors, and both of them are real.** This one, and the row
    `state-picker-edit` inside the state sheet of a task. The second is not an
    alternative: a board at `MAX_BOARD_STATES` cannot add a column from the picker
    at all, so the door to rearranging them has to exist somewhere else, and a
    person who has a card open is a person who is already looking for "which state
    is this".

    **`states.length > 0` is in the condition and not by accident.** This screen
    returns `board.noStates` for a board with no columns, *before* the tree that
    mounts the panel, so a button drawn there would open nothing: a dead press, which
    is the exact defect this task exists to remove from `state-picker-edit`.
  */
  useHeaderAction(
    () =>
      list && !readOnly && states.length > 0 ? (
        <Button
          testID="board-states-button"
          label={t("board.editStates")}
          variant="ghost"
          size="sm"
          icon="options-outline"
          iconOnly
          accessibilityHint={t("board.editStatesHint")}
          fullWidth={false}
          onPress={abrirEditorDeEstados}
        />
      ) : null,
    [list, readOnly, states.length, t],
  );

  const [editing, setEditing] = useState<{
    /** Empty when the sheet is creating a task rather than editing one. */
    itemId: string;
    page: "edit" | "icon";
  } | null>(null);
  const editingItem = useMemo(
    () =>
      editing ? (items.find((row) => row.id === editing.itemId) ?? null) : null,
    [editing, items],
  );

  /**
   * The task whose column is being changed, and **nothing else.**
   *
   * An id and not the row, **and the reason is that an id cannot go stale.**
   *
   * The row is re-read out of `items` on every render below, so what this state
   * holds is only ever the *name* of a task, and every field that a write could
   * take —the row's `version`, its `stateId`, its title — is read at the moment of
   * the write and not at the moment the sheet opened. A copy of the row stored
   * here would be a snapshot, and a snapshot is exactly what a concurrent write on
   * another device makes wrong.
   *
   * **What does NOT justify it, because it was measured and it is false:** the
   * first version of this comment said that `updateItem` and `localUpdate` carry
   * `version` and `baseVersion` from the row handed to them, so a stale copy would
   * hand the server an old version. Neither does. `updateItem` keys the write on
   * `item.id` alone (`use-lists.ts`) and `localUpdate` reads the cached version
   * itself when it runs (`lib/offline/sync-service.ts`). So the two writes below
   * would have been fine with a stored row, and the sentence was a mechanism the
   * code does not use.
   *
   * The shape is already the hook's: `moveItemTo` takes an **id** and re-reads the
   * rows — and their `version` — out of the local store itself (`use-lists.ts`).
   *
   * It becomes load-bearing the day a write has to send the row's `version`, and
   * that is forward-looking rather than measured: **no such read exists in this
   * checkout.** The choice stands because an id is the one shape that cannot be
   * out of date.
   */
  const [cambiandoEstado, setCambiandoEstado] = useState<string | null>(null);
  const tareaEstado = useMemo(
    () =>
      cambiandoEstado
        ? (items.find((row) => row.id === cambiandoEstado) ?? null)
        : null,
    [cambiandoEstado, items],
  );

  /**
   * Move one task to one column, **and write nothing when it is already there.**
   *
   * `stateIdToWrite` is what decides that, and the reason it is not a line here is
   * in `board.ts`: the comparison has to be against the **resolved** column, so a
   * task whose `stateId` is `null` —every task created on a board— or points at a
   * column another device deleted is recognised as already being in the first one.
   * Compared against `item.stateId` in this file, picking the first column would
   * enqueue an update nobody asked for.
   *
   * `updateItem` is local first, so the tab moves on the press and not when the
   * push answers: the wait is the outbox's business.
   */
  function moverA(stateId: string) {
    const fila = tareaEstado;
    if (!fila) return;
    const escribir = stateIdToWrite(states, fila.stateId, stateId);
    if (escribir === null) return;
    void updateItem(fila, { stateId: escribir });
  }

  /**
   * «+ Nuevo estado…»: **the column is created and the task goes into it, in that
   * order, and the order is the whole of this function.**
   *
   * The server refuses an item whose `stateId` is not one of its list's `states`
   * (`isKnownStateId`, in `sync-service.ts`), and it reads that list **at the
   * moment it applies the operation**. So an item update that lands before the
   * column exists is rejected — and a rejection is invisible from here: the push
   * answers 200 with the rejection inside `results`, the outbox drops the
   * operation, and the tab never moves.
   *
   * **Awaiting the first before starting the second is what puts them in order**,
   * and it is not politeness: `localUpdate` does `getLocalStoreReady()`, then
   * `upsertCached`, then `enqueueOperation`, each one awaited, so two calls fired
   * without esperarse se intercalan y el orden queda a cargo de lo que tarde cada
   * `await`. Encadenadas, el `enqueueOperation` de `states` termina antes de que
   * empiece el del item.
   *
   * Del otro lado el recorrido si es ordenado, y eso **esta leido en el codigo y no
   * medido**: el outbox se lee con `ORDER BY created_at ASC` (`local-store.ts`) y el
   * `push` de la API recorre `rawOperations` con un `for` y un `await` por operacion
   * (`apps/api/src/modules/sync/sync-service.ts`, `async push`). Lo que **no** esta
   * atado es el empate: `createdAt` es un `toISOString()` de milisegundos y la
   * consulta no lleva desempate, de modo que dos operaciones del mismo milisegundo
   * dependen del orden de filas. En este camino no puede llegar a pasar —entre las
   * dos hay un `await load()` entero de la lista—, pero una llamada que no espera
   * entre si tiene esa carrera, y por eso el `await` esta aqui y no es estilo.
   *
   * **`newState` is asked first and its `null` ends the function.** Both of its
   * `null`s are writes the contract throws away — the board at `MAX_BOARD_STATES`,
   * or a name that is blank — and the states travel as **one field**, so a `null`
   * inside the array would fail every later save of that board rather than this
   * one. The sheet has already greyed the row out at the cap and the field's button
   * is off without a name; this is the same rule on the other side of the
   * boundary, and it is the one that costs a board its columns if it is forgotten.
   *
   * **The array it appends to is this render's `states`**, which is the list's own
   * array — so a column added on another device while this sheet was open is still
   * in there. What it is not is a merge against whatever arrived a millisecond
   * later: the sheet closes on the press, so there is one of these at a time.
   */
  async function crearEstadoYMover(titulo: string) {
    const fila = tareaEstado;
    // `list` is non-null by the time this runs — the renders below this one return
    // early without it — but a function declared above those renders does not get
    // that narrowing, so the check is here rather than in the type.
    if (!fila || !list) return;
    const nuevo = newState(states, titulo);
    if (!nuevo) return;
    await updateList(list, { states: [...states, nuevo] });
    // The id is written as minted and **not through `stateIdToWrite`**, and that is
    // not an oversight: its test says why. The id was just minted, so it is not the
    // column the task is drawn in under any rule, and there is nothing for a
    // "is it already there?" check to decide here. Passing the old `states` to that
    // function would return `null` — the new column is not in it — the move would not
    // be written, and the result would be a column that exists on the server with
    // the task still in the old one.
    await updateItem(fila, { stateId: nuevo.id });
  }

  /**
   * Anchor the board on a column, **and move the track to it as well.**
   *
   * On a narrow window the tabs change which column is on screen, and on a wide
   * one they are the only way to reach the columns that did not fit: the tab strip
   * scrolls itself to show the chosen name and this scrolls the track to show the
   * chosen column, which are two halves of one jump. It is done here and not in an
   * effect on `actual` so that the swipe of Task 9, which also sets `actual`,
   * settles where the gesture left it instead of fighting it with a second
   * `scrollTo`.
   *
   * **The offset is `columnOffset` and not `index * anchoColumna`**, which is the
   * same mistake as the one the width arithmetic had: it leaves the gap between
   * the columns out of the sum, and a jump to the fourth column lands three gaps
   * short. On the web the snap hides it. On native it does not, because
   * `pagingEnabled` pages by multiples of the scroller, so the number given is a
   * valid page and not the column's edge.
   */
  function irA(id: string) {
    const index = states.findIndex((state) => state.id === id);
    // An id that is not a column of this board is not something to scroll to.
    if (index < 0) return;
    /**
     * The offset is clipped, and **both halves of the re-base are clipped with the
     * same function for the same reason.**
     *
     * `scrollTargetFor` does it to the destination: react-native-web does
     * `node.scroll({left})`, which clips to the maximum, and nothing compensated a
     * transform charged with the difference. This is the other half, and this is
     * the writer: **the number that goes into `scrollPrevio` here is a position the
     * scroller may never reach**, so it is the clipped one. Why it is written before
     * the scroll is asked for, and not only from `onScroll`, is on `scrollPrevio`.
     *
     * Measured in the browser at 1440 x 900 with five states and one long column on
     * the left: a track of **1120** of content **1403**, so `maxScroll` is **283**
     * and the offsets are `[0, 283, 566, 849, 1132]`. Drag the track left until
     * `scrollLeft` is **283**, tap this tab for the fifth state, then drag twenty
     * points — **and the order is the whole of it**: with the track at its end the
     * browser clips this tab's `scrollTo` of **1132** from **283** to **283**, which
     * changes nothing **and fires no event**, so `onScroll` never comes to correct
     * what was written here. Five repetitions of the three steps: written **283**
     * with this line and **1132** without it, the re-base at the settling **0**
     * against **−849**, and `trackX` charged **−1.5** against **−850.5**.
     *
     * Started from the first column instead — which is what the earlier rounds
     * measured — the same tap really does move the scroller from **0** to **283**,
     * fires **12 to 15** events and puts the truth back before the finger arrives,
     * which is why that protocol saw nothing with the bug alive. **The length of the
     * spring was not measured in either run**, and nothing here ran on native.
     *
     * `trackRoomAt` clips its own `scrollLeft` for the same reason and says so; this
     * is the third reader of the scroller's position, and it was the only one that
     * believed it.
     */
    const x = scrollTargetFor(offsets[index], scrollPrevio.value, maxScroll);
    setActual(index);
    // The clipped number, and written before the scroll is asked for rather than
    // only from `onScroll`. See `scrollPrevio` for why the order is this one.
    scrollPrevio.value = x;
    pista.current?.scrollTo({ x, animated: true });
  }

  /**
   * Where a swipe puts the board, **and the scroller is moved without animating
   * it.**
   *
   * This is the other half of `settle`, and it is a different function from `irA`
   * because a tab tap and a swipe are two different moves: a tap has no finger
   * travel under it, so the platform's own smooth scroll is the whole of the
   * animation and nothing competes with it, while a swipe has `trackX` carrying
   * the rest of the journey and two animations would add up to a path that is not
   * monotonic. `settle`'s comment has the numbers.
   *
   * `scrollPrevio` is **not** written here: the worklet has already written it,
   * from the interface thread, before this runs.
   */
  function asentarEn(next: number) {
    const x = offsets[next];
    if (x === undefined) return;
    pista.current?.scrollTo({ x, animated: false });
    setActual(next);
  }

  /**
   * How far the track is from where the scroller left it, **and zero at rest.**
   *
   * A displacement and not a position, and that is the whole difference between
   * this and the panel's track. There, the resting place moves with the page and
   * the style added a displacement to it, which is right while a finger is down
   * and wrong the instant the page changes: the panel counted the page twice and
   * overshot it. **Here the scroller is what holds the position** — `irA` scrolls
   * it and the snap holds it — and this is only what the finger has done to it
   * since, so the value it comes back to is always zero and there is nothing to
   * count twice.
   */
  const trackX = useSharedValue(0);
  /**
   * Where that displacement was when the finger went down.
   *
   * A swipe that interrupts the settling of the previous one starts from wherever
   * the track has got to, not from zero: reading a shared value from a worklet
   * without freezing it is a copy that is one frame behind, and the drag would
   * begin by jumping. So the value is frozen on `onStart`, which is what
   * `origin` does in `panel-grid.tsx` for the same reason.
   */
  const origin = useSharedValue(0);
  /**
   * Whether a finger is on the track right now.
   *
   * The rubber band is a thing a *finger* meets, so it is applied only while there
   * is one. The settling animation moves `trackX` as well, and a band applied to
   * an animation would read a correct resting place as a pull past the end of the
   * board and shrink it — which is how a page turn used to end with the columns a
   * third of a column away from where the tabs said they were.
   */
  const fingerDown = useSharedValue(false);

  /**
   * Where the scroller is, in points, **as a value the interface thread can read.**
   *
   * **This is what the floor of the rubber band is measured against, and it is the
   * second half of the fix.** The floor used to be read off `actual` — the index of
   * the column the board is anchored on — and the column is not the scroller's
   * position: from the second column of a board with four visible the scroller is
   * already at its maximum, so there is nothing to give forward while the index says
   * there are three columns left. Read here, the floor follows the scroller and
   * that case answers itself.
   *
   * It is written from two places and both are needed. `onScroll` is the truth
   * during a platform-driven scroll — the wheel, or the animated `scrollTo` of a tab
   * tap — and `irA` is the truth the instant a jump is asked for, because the first
   * `onScroll` of a smooth scroll arrives a frame or more later and a swipe that
   * interrupts a tab tap would otherwise re-base against a position the board has
   * already left.
   */
  const scrollPrevio = useSharedValue(0);
  /**
   * Whether the gesture that is finishing has already decided where the track goes.
   *
   * A `Pan` calls `onEnd` and then `onFinalize`, in that order, every time, so the
   * two must not both animate the track: one of them decides and the other one
   * knows it has.
   */
  const settled = useSharedValue(false);

  /**
   * Where the columns are, **and it is one number for the track and for the tabs.**
   *
   * The floor is `trackRoomAt` — **points of the scroller, read from where it
   * actually is** — and everything above this note is why. It used to be a count of
   * columns times the scroller's maximum scroll, which is the same number only when
   * one column is visible, and the only width measured was that one.
   *
   * **Past the end, only the part past the end is resisted, and by a third.** Not
   * the whole travel: resisting all of it makes a legal swipe feel heavy for its
   * whole length, which is a different complaint from the one this fixes.
   *
   * And it is here, and not inside the animated style, because the tabs read the
   * same thing. **Measured at the last state of a 400-point board with a 300-point
   * drag, with the broken version: the columns moved 83 and the pills 95.** The
   * pills were reading the travel the finger had made and the columns the travel
   * there was room for, so **the strip ran away from the board at the one moment
   * both were supposed to be saying there is nowhere to go**, and the only way that
   * does not come back is one number read by the two.
   *
   * **Those two numbers are of the version that was broken, and they are here for
   * that and not as a claim about this one.** With one number for both, the same
   * gesture reads **pista −83 y pastillas −28**: the same 83 for the columns —
   * `(300 - 14) / 3.4 =` 84, read as 83 — and 28 for the pills, which is `83 ×
   * 0.3389` where `0.3389 = 368 / 380 × 0.35` is the parallax of a 400-point board.
   * So the ratio here is **0.34**, the factor, where it was **1.14**.
   *
   * The two numbers also say the other half of the story and it is worth saying
   * twice, because it is the half that hides: **the finger's 300 points are not
   * 83.** The gesture does not start counting for the 14 points of slop and the
   * band then divides what is left by 3.4, so `trackX` is −286 and `movido` is
   * −83. A comment whose whole argument is a number has to be explicit about which
   * of the two it is quoting, and 84 is the calculated one — measured is 83.
   */
  const movido = useDerivedValue(() => {
    let m = trackX.value;
    if (fingerDown.value) {
      const { roomLeft, roomRight } = trackRoomAt(scrollPrevio.value, maxScroll);
      if (m > roomLeft) m = roomLeft + (m - roomLeft) / EDGE_RESISTANCE;
      if (m < -roomRight) m = -roomRight + (m + roomRight) / EDGE_RESISTANCE;
    }
    return m;
  });

  const estiloPista = useAnimatedStyle(() => ({
    transform: [{ translateX: movido.value }],
  }));

  /**
   * How far along the board the finger is, **as a fraction of a page and with a
   * sign**, and it is what the tabs move by.
   *
   * **Out of `movido` and not out of `trackX`**, so the fraction is of the travel
   * there was room for and not of the travel the finger asked for — the note on
   * `movido` says what the other one measured.
   *
   * The page is `parallaxPage` and not a column, and the reason is that the two
   * layers have to keep their order: with a column as the unit the strip moves
   * `0.35 * stripWidth / step` for every point the board moves, which is 0.34 on a
   * phone and **1.39 on a wide track**, where the strip is four times wider than a
   * column. Measured at 1440 with five states: a 275-point drag moved the columns
   * 275 and the pills 381. With the strip's width as the page it is 96.25, which is
   * a third of 275.
   *
   * Cut at one, and for the same reason the media carousel cuts its gathering at
   * one: past a whole page of travel the strip is simply as far along as it is going
   * to say, and there is nothing more of it to say it with.
   */
  const progreso = useDerivedValue(() => {
    if (paginaParalaje <= 0) return 0;
    return Math.max(-1, Math.min(1, movido.value / paginaParalaje));
  });

  /**
   * Finishing a swipe, wherever the finger let go of it.
   *
   * **One clock, and the whole journey is on it.** The scroller is put where the
   * swipe decided **without animating it**, and `trackX` carries the columns the
   * rest of the way to the column's edge. That is a change from what this did
   * before, and the reason is a measurement rather than a preference — with both
   * halves animating, the two paths were added up and the sum went backwards. **All
   * three numbers below are from the 400-point board**, because mixing boards is
   * how a measurement turns into a figure that is true of nothing:
   *
   * - the displacement the finger left was `285` on a 600-point drag, so
   *   `285 / 2.6 =` **110 ms** of `out(cubic)`, which at 35 ms has already eaten
   *   `1 - (1 - 0.318)³ =` **70%** of it, and `285 × 0.70 =` **201 points**;
   * - the platform's smooth scroll on that same board, measured by tapping a tab
   *   and sampling `scrollLeft` twenty-four times for the 1140 points of three
   *   columns: **1.4% of 1140 after 64 ms**, so at 35 ms it is under **1%**, and a
   *   one-column scroll of 380 has done about **11** of its points by then;
   * - so at 35 ms the columns had gone `201 - 11 =` **190 points the wrong way**,
   *   and at 110 ms, with the transform finished and the scroll at 11% of its own,
   *   they were **243 points behind** before starting forward again. Nothing in
   *   that path is a page turn; it is a page turn with a stamp on it.
   *
   * **The other measurement of the scroll, 2.8% of 283 after 35 ms, is the
   * 1440-point board and it is not in the sum.** 2.8% of 283 is 8, and turning
   * that into "11 of a 380" is exactly how the figure above was wrong the first
   * time: a number of one board offered as a number of another, and the sum of the
   * three was therefore of nothing at all.
   *
   * With the scroll instant there is one animation, **the path is monotonic by
   * construction**, and the columns and the pills move together because they read
   * `movido`.
   *
   * Which column it goes to is `nextPageFor`, the pure function: far enough or fast
   * enough, in the direction of the travel, one column at a time, and **for a drag
   * that paged, never past either end of the pager** — `paginas`, which is what the
   * scroller can reach. **For a drag that did not page it is the column the board
   * was already on**, which can be outside the pager, because the fifth state's tab
   * is the fifth state whatever the scroller can do with it; that is what
   * `scrollTargetFor` below is for.
   *
   * **`movido` and not `trackX` for the re-base**, because `movido` is what is on
   * screen: at the end of the board the finger's travel and the board's movement
   * are not the same number, and re-basing from the raw one would leave the two out
   * of step by whatever the band took.
   *
   * **The duration is now the whole journey and not this track's share of it**,
   * which is what `PAGE_SPEED` has always meant in the panel — there `settle` works
   * out `left` against the **destination** and animates all of it, and the three
   * numbers are 2.6 points per millisecond between floors of 90 and 320. Before
   * this, `left` was only the part the scroller was not covering and the same three
   * numbers meant something else.
   */
  const settle = (velocity: number) => {
    'worklet';
    const next = nextPageFor(trackX.value, velocity, paginas, actual);
    /**
     * **The destination is clipped to what the scroller can reach, and that is not
     * a detail of the animation — it is the whole reason the animation is right.**
     *
     * `next` is a column and `objetivo` was its offset, but a column is not always
     * an offset the scroller has: `anchorableColumns` exists because a wide board has
     * states that cannot be anchored, and a tab tap can select one of those, so
     * `offsets[next]` can be past the end. **The browser clips the scroll and
     * nothing below compensates it** — the re-base on the next line charges the
     * transform a displacement the scroller is never going to make.
     *
     * Measured in the browser at 1440 with five states, `offsets`
     * `[0, 283, 566, 849, 1132]` and `maxScroll` 283: the fifth state's tab, which
     * the scroller puts at its maximum of 283, and then a **20-point** drag — far
     * below the 56 that counts, so it should have done nothing at all. Clipped, the
     * re-base is 0 and the track springs home over `PAGE_MIN` from six points.
     * Unclipped, `trackX` was at **848** on the first frame — three columns — and
     * back to zero **285 ms** later.
     *
     * **That gesture starts at the first column, which is also why it cannot show
     * the other half of the clip.** There the tab really does move the scroller from
     * `0` to `283`, the events that follow put `scrollPrevio` back to the truth, and
     * the half about the position it was holding needs a board that is already at
     * its end before the tab is tapped. That protocol and its numbers are on `irA`
     * and in `lib/lists/board-paging.ts`.
     *
     * **So the answer is the clipped one and the tab keeps the unclipped one**, which
     * is the point of having `settle` return `next` separately: the fifth state is
     * the fifth state whatever the scroller can do with it, and the board is where
     * the scroller can put it. `scrollTargetFor` is where the clip lives, with its
     * reasons, and it is a pure function so that the numbers are testable.
     */
    const objetivo = scrollTargetFor(offsets[next], scrollPrevio.value, maxScroll);
    /**
     * The scroller is about to move by `objetivo - scrollPrevio`, so the transform
     * moves with it: the two are equal and opposite and the columns do not move a
     * point at the moment of the change.
     *
     * **Which of the two lands first is not decided here, and on native it cannot
     * be**: the transform is written from this thread and the scroll is a command
     * to the platform's own queue, so they are two queues and one of them is a
     * frame late whichever order they are issued in. On the web they are the same
     * thread — `runOnJS` there is a microtask, which flushes before the paint — and
     * there is no frame between them. **What a late one costs is one column's
     * displacement for one frame**, and the only way there is no such thing is for
     * the scroller not to hold the position at all, which is what `panel-grid`
     * does by having no scroller under its track. That is a bigger change than this
     * one, and it costs more than the wheel: on all three targets it takes the
     * track's own touch scrolling and its `pagingEnabled` with it, and the paging is
     * what lets a column with more cards than fit scroll by itself.
     */
    trackX.value = movido.value + (objetivo - scrollPrevio.value);
    scrollPrevio.value = objetivo;
    const left = Math.abs(trackX.value);
    trackX.value = withTiming(0, {
      duration: Math.min(Math.max(left / PAGE_SPEED, PAGE_MIN), PAGE_MAX),
      easing: Easing.out(Easing.cubic),
    });
    return next;
  };

  /**
   * Turning the column with a swipe.
   *
   * **`failOffsetY([-12, 12])` is the whole of what makes this safe, and it is not
   * a detail.** A column scrolls vertically when it has more tasks than fit, and a
   * card is going to be dragged up and down to be reordered inside its column; both
   * of those are the vertical axis, and a gesture that claimed it would leave a
   * board where you cannot scroll a column and cannot move a card. So the pan takes
   * the finger only once it has clearly gone **sideways** (`activeOffsetX`), and
   * gives the vertical straight back (`failOffsetY`) — which is the reservation
   * Task 13 reorders inside of, and the reason that gesture can be written at all.
   *
   * It is on the track and not on the cards, and for the same reason inverted: a
   * card that is picked up to be moved does not have to argue with a pager about
   * which of the two gestures owns the finger, because the card is above the track
   * and a finger that went down on one never reaches it.
   *
   * `touchAction="pan-y"` is **web only and it is load-bearing.** React Native
   * Gesture Handler writes `touch-action: none` on whatever view a gesture is
   * attached to, which on the web would take the vertical away from the columns
   * underneath it: a column with more cards than fit would stop scrolling under a
   * finger, which is the bug the height of the track was measured to fix. `pan-y`
   * says the browser may pan vertically and not horizontally, which leaves the
   * columns their scroll and leaves the horizontal drag to this gesture.
   */
  const swipe = Gesture.Pan()
    .enabled(sePuedePaginar)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onStart(() => {
      // The gesture found the track here, wherever a page turn that is still
      // animating had left it. Reading the shared value without freezing it would
      // give a copy from the frame before, and a swipe that interrupted the last
      // one would begin with a jump.
      origin.value = trackX.value;
      fingerDown.value = true;
      settled.value = false;
    })
    .onUpdate((event) => {
      // The columns go with the finger. Not a nicety: a column that appears only
      // once the finger has let go makes the board feel like it decided on its
      // own, and there is no way to stop halfway and change your mind.
      trackX.value = origin.value + event.translationX;
    })
    .onEnd((event) => {
      const next = settle(event.velocityX);
      settled.value = true;
      // Even when the swipe did not change the page: the scroller still has to be
      // told where the board is, and `asentarEn` is the one place that says so.
      runOnJS(asentarEn)(next);
    })
    .onFinalize(() => {
      // The finger is off the track, so the band stops: whatever is still moving is
      // the animation finishing, and a band applied to that would drag a correct
      // resting place back towards where the finger let go.
      fingerDown.value = false;
      if (settled.value) {
        // `onEnd` already sent the track where it was going.
        settled.value = false;
        return;
      }
      // Cancelled, or the gesture lost to the column's own scroll before it ever
      // became a swipe: back to where the scroller is, which is nowhere.
      trackX.value = withTiming(0, {
        duration: PAGE_MIN,
        easing: Easing.out(Easing.cubic),
      });
    });

  if (!listId) {
    return (
      <Screen>
        <EmptyState title={t("lists.notFound")} />
      </Screen>
    );
  }

  // While the replace travels: nothing of the board's own, because a board of a
  // list that is not a board would be the wrong screen flashing before the right
  // one arrives.
  if (list && list.kind !== "board") return null;

  if (!list) {
    // The list arrives from the cache after the first paint. Saying "this list no
    // longer exists" while it is still being read would be a lie that a slow
    // device tells.
    if (isLoadingLists) return null;
    return (
      <Screen>
        <EmptyState title={t("lists.notFound")} />
      </Screen>
    );
  }

  /*
    A board with no columns at all. The contract allows it and the client seeds
    four on creation, so it is reached from a board imported or edited by hand —
    and `stateOf` answers null for every row of it, which means every task of the
    board would be drawn nowhere. Saying so is the whole job of this branch.
  */
  if (states.length === 0) {
    return (
      <Screen>
        <EmptyState title={t("board.noStates")} />
      </Screen>
    );
  }

  // The tasks are read from the local cache, which arrives after the first paint.
  // A frame of nothing is better than four columns that say "no tasks" and then
  // fill in under the eye.
  if (isLoadingItems) return null;

  return (
    /*
      `edgeToEdge` **and** the `+` in the `overlay`, and both are the same reason:
      the board fills the window, so the gap `Screen` normally leaves at the bottom
      would be a strip of nothing under it.

      **The button is the app's button and not a copy of it.** It was a hand-written
      `Pressable` lifted from the list screen, and it showed: 56 points against the
      shared 52/58, corners 16/16 against 20/24, a glyph of 26 against 24/28 — **the
      plus changed size between `/list/:id` and `/board/:id`**, which is the whole
      argument the shared component is in the codebase for. And `overlay` and not a
      child, because a child of a scroller cannot be fixed to the window on the web.

      **A board with no way to add a task would be a screen nobody can put anything
      into.** The row that is created lands in the **first** column, which is what
      `stateId: null` means and is why creating a task here is the same code that
      creates one on any other list.
    */
    <Screen
      scroll={false}
      width="full"
      edgeToEdge
      testID="board-screen"
      wash={{
        color: workspace?.color,
        colorTo: workspace?.colorTo,
        wash: workspace?.wash,
      }}
      overlay={
        <FloatingButton
          testID="item-create-button"
          label={t("itemCreate.title")}
          hint={t("itemCreate.titleHint")}
          onPress={() => setEditing({ itemId: "", page: "edit" })}
        />
      }
    >
      {/*
        The box whose `onLayout` measures the board, and it is the **content box of
        the screen** and not the window: the screen's own padding comes off first,
        so a phone of 430 is 398 here and the arithmetic is about the space the
        columns really have.

        **And it renders whatever the measurement says.** It was behind a
        `return null` while `anchoColumna` was zero — the box that measures the
        width inside the branch that needs the width — and the board never painted
        anything at all: an empty screen with the title of the board in the header
        and no way to tell a broken screen from an empty one. Measured in the
        browser, at 1440 points, with no error anywhere.
      */}
      <View
        testID="board-track-area"
        style={[styles.medido, { gap: theme.spacing.lg }]}
        onLayout={(event) => setAncho(event.nativeEvent.layout.width)}
      >
        {/*
          The tabs are above the track and not inside it: they are the jump to a
          column that is not on screen, and a strip inside the track would scroll
          away with the columns the moment you moved one.
        */}
        <BoardTabs
          states={states}
          counts={counts}
          currentId={states[actual]?.id ?? null}
          progress={progreso}
          onSelect={irA}
        />

        {/*
          The track waits for the measurement, and that is the only thing it waits
          for: a column of zero width is a column nobody can read, and one frame of
          a strip of tabs with nothing under it is the honest version of a column
          that has not been sized yet.
        */}
        {anchoColumna > 0 ? (
          /*
            The box that clips the track, **and it is here because the displacement
            is on the scroll view itself.**

            Reanimated animates the `style` prop and nothing else: it reads
            `props.style` when it attaches an animated style and has never heard of
            `contentContainerStyle`, so the only place the columns can be moved
            from is the scroller — and a scroller that moves sideways takes its own
            box with it. Translated a whole column to the left at column zero, the
            box's right edge is 380 points past the right of the screen and its
            left edge is off the left of it, and the sliver of the column behind
            that is **the last 16 points of the previous column drawn outside the
            padding the screen gave the board**, over the background of the app.

            Clipping at the padding is what the content container did for free, and
            this box is how it is done without it: `flex: 1` on it and on the track,
            so the clip is exactly the edge of the track.
          */
          <View style={styles.recorte}>
            <GestureDetector gesture={swipe} touchAction="pan-y">
              {/*
                `Animated.ScrollView` and not a `ScrollView`, for the reason in the
                box above and not as a style: an animated style on a plain view is
                quietly ignored, so the columns would page with nothing moving under
                the finger — working, and feeling like the board had changed its
                mind on its own. TypeScript says as much, which is the good kind of
                saying.
              */}
              <Animated.ScrollView
                ref={pista}
                testID="board-track"
                style={[styles.pista, estiloPista]}
                onLayout={(event) => {
                  setAnchoPista(event.nativeEvent.layout.width);
                  setAltoPista(event.nativeEvent.layout.height);
                }}
                onScroll={(event) => {
                  scrollPrevio.value = event.nativeEvent.contentOffset.x;
                }}
                scrollEventThrottle={16}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: gapColumnas }}
              >
                {columnas.map(({ state, tasks }) => (
                  /*
                  The width goes on a wrapper and not on `BoardColumn`, and that is
                  where the measurement lands rather than inside the column.

                  Inside the content box of a horizontal scroll view a child with no
                  width takes **the width of its content**: neither React Native nor
                  `react-native-web` gives a view a `flexBasis`, and both default to
                  `flexShrink: 0`, so a column that is not given a width is as wide as
                  its longest card — which on a board of four short titles is four
                  narrow columns that all fit in one screen and none of which is a
                  column.

                  And the wrapper is also what `pagingEnabled` snaps: react-native-web
                  marks each **child of the track** as a snap point, so the wrapper's
                  left edge is the column's left edge and the browser lands on the
                  column and not on the gap in front of it.

                  **Both of its numbers are measured, and neither is a flex rule.**
                  The width is `columnLayout`'s and the height is the track's own
                  layout, and the comment on `altoPista` says what happens when the
                  height is left to the boxes: nothing shrinks, a column with more
                  cards than fit is as tall as its content, and the board runs off the
                  bottom of the window.
                */
                  <View
                    key={state.id}
                    testID={`board-slot-${state.id}`}
                    style={{ width: anchoColumna, height: altoPista }}
                  >
                    <BoardColumn
                      state={state}
                      tasks={tasks}
                      tagColors={list.tagColors ?? {}}
                      readOnly={readOnly}
                      /*
                        **A card opens the state sheet and not the task panel**, and
                        this is the spec's sentence and not a preference: *"Tocar la
                        tarjeta abre la hoja de estado"* —
                        `docs/superpowers/specs/2026-10-03-tablero-de-estados-design.md`,
                        "Mover de estado". Moving a task between columns is the thing a
                        board is for and it had no way in from a card at all.

                        **The task panel is still mounted and it is still reachable**,
                        but not from the card's own press and **not through the icon
                        either**, which is what the first version of this comment
                        claimed and it was false: `task-row.tsx` draws the icon
                        pressable only as `{item.icon ? … : null}` and `icon` is
                        `null` on every task created in the app
                        (`item-record.ts`), so on an icon-less card — the default,
                        and every card this walkthrough seeded — the title, the
                        description, the urgency and the labels had **no route at
                        all**. The road now is the state sheet's own row
                        `board.editTask`, which opens this panel on the task that
                        was tapped. The spec puts it exactly there: *"Desde ahí se
                        entra al editor completo"*.

                        With `readOnly` there is no state sheet mounted below, so this
                        press has nowhere to go, and it is stopped here rather than
                        left to write an id that nothing reads — which is what Task 14
                        is for: it takes the panels down as well and puts the read-only
                        notice where the two of them used to be.
                      */
                      onOpenTask={(item) => {
                        if (readOnly) return;
                        setCambiandoEstado(item.id);
                      }}
                      onOpenIcon={(item) =>
                        setEditing({ itemId: item.id, page: "icon" })
                      }
                    />
                  </View>
                ))}
              </Animated.ScrollView>
            </GestureDetector>
          </View>
        ) : null}
      </View>

      {/*
        The panel of a task, mounted for good and opened by its prop. **It is the
        panel of the list screen and not another one**, and the reason is the same
        as the one that put the panel in `item-edit-sheet.tsx`: a task of a board is
        the same task, with the same title, the same description, the same icon, the
        same urgency and the same labels, and two panels for one kind of task is two
        panels that stop agreeing about what a task can have.

        **`showCompleted={false}`, and this is the one thing that differs.** In a
        board "done" is a state and not a tick, so the row has no checkbox and
        neither can the panel: a tick there would write `completed` on a board,
        which nothing on this screen reads, and the press would look like it worked
        and change nothing at all.
      */}
      <ItemEditSheet
        item={editingItem}
        listId={listId}
        mode={editing && editing.itemId === "" ? "create" : "edit"}
        startOn={editing?.page ?? "edit"}
        tagColors={list.tagColors ?? {}}
        showCompleted={false}
        onTagColor={(tag, color) => setTagColor(list, tag, color)}
        onClose={() => setEditing(null)}
      />

      {/*
        The state sheet, **mounted for good and opened by its prop**, for the reason
        `useLastValue` exists and `list-menu-sheet.tsx` tells at length: a sheet that
        unmounts with its argument takes the exit animation with it, and the
        dismissal was measured at forty-five milliseconds of a quarter of a second.

        **`readOnly` does not mount it at all, and that is the load-bearing half of
        the answer** — a viewer is not somebody to hand a panel of four columns that
        cannot be pressed, and rendering it empty would be a panel shaped like a bug.
        The sheet also refuses to draw itself when it is handed `readOnly`, so the
        rule survives the day somebody mounts it without checking.

        **`counts` and not `tasksInState` per row**: the numbers are the ones the
        tabs and the column headers are already drawing, built in one pass with
        `countInState`, and a sheet that counted again would be a second answer to a
        question the screen has already answered.

        `onEditStates` opens the states editor, **and this row is the second of its
        two doors.** It used to be wired to a function with an empty body, and it was
        that way deliberately: the editor is Task 11 and until it existed the honest
        thing was a body that says so rather than a row that was not drawn. It is
        live now, and the other door is the header button of this screen.

        **Two panels for one press is not what happens**: `state-picker-sheet` calls
        `onEditStates()` and then `onClose()` in the same handler, so the picker is
        asked to close in the same commit the editor is asked to open, and there is
        the same window of two `sheet-panel`s in the document that `onEditTask` has —
        measured, 220-241 ms in 15-16 of 22-44 sampled frames at 1440 x 900, and
        `scripts/verify-state-picker.mjs` block `1c` is where those numbers come
        from. `scripts/verify-state-editor.mjs`, bloque `9`, mide esa misma ventana
        para este relevo con el mismo instrumento — y encuentra todo lo contrario,
        que esta escrito en el punto 6.1 del informe de la tarea.
      */}
      {!readOnly ? (
        <StatePickerSheet
          item={tareaEstado}
          states={states}
          counts={counts}
          readOnly={readOnly}
          onPick={moverA}
          onCreate={(titulo) => void crearEstadoYMover(titulo)}
          /*
            The task's own panel, **and the id is read from `tareaEstado` and not
            carried as a second argument.** `onEditTask` is called **before**
            `onClose`, in the same handler and therefore in the same commit, so
            `cambiandoEstado` is still the id of the card that se toco cuando esto
            corre; las dos actualizaciones aterrizan juntas y `editingItem` de abajo
            resuelve la fila fuera de `items` por ese id, que es la misma busqueda
            que hace cualquier otra pulsacion.

            **Lo que esto NO es** es una lectura del `tarea` congelado de la hoja.
            Daria la misma respuesta hoy, y la seguiria dando para una pulsacion que
            llega 300 ms despues de que la hoja empezara a irse —`useLastValue`
            sigue dibujando la tarea que le dieron. El estado de arriba es el que
            sabe si hay una tarea, asi que es el que contesta.

            `page: "edit"` y no los iconos: el icono es su propio blanco en la
            tarjeta y esta fila es sobre la tarea entera.
          */
          onEditTask={() => {
            const fila = tareaEstado;
            if (!fila) return;
            setEditing({ itemId: fila.id, page: "edit" });
          }}
          onEditStates={abrirEditorDeEstados}
          onClose={() => setCambiandoEstado(null)}
        />
      ) : null}

      {/*
        The states editor, **mounted for good and opened by its prop**, for the same
        reason the sheet above is: `useLastValue` is what lets a panel keep drawing
        what it was drawing while it travels down the screen, and `sheet.tsx`
        measures what is lost without it.

        **`states` is the draft and not `list.states`.** That is the whole of the
        "one write on close" rule on this side: the panel hands back a new array
        through `onChange`, `borrador` keeps it, and `cerrarEditorDeEstados` is the
        only thing here that calls `updateList`. A rename, a colour and an added
        column are three `onChange` calls and **one** operation.

        **A column edited from another device while this panel was open is in the
        array it draws** — it is the list's array the draft started from, not a
        frozen copy — but the panel's own draft is what gets written at the end, and
        that is the documented limit of a field this wide: last write wins, whole.
        It is written down in `docs/architecture/offline-sync.md`.

        **`readOnly` does not mount it**, like the sheet above, and the sheet refuses
        to draw itself when handed `readOnly` anyway: a viewer is not somebody to
        hand a panel of controls that will not work.

        `onDelete` **es `borrarColumna`, la unica puerta por la que se borra una
        columna con tareas**, y la de las vacias no pasa por aqui: esa la decide el
        panel con `counts` y llama a `removeState` en el sitio. El bin de la ultima
        columna sale apagado porque el panel pregunta a `canDeleteState`, y con una
        sola columna esa papelera no es una puerta: no hay ni funcion a la que
        llamar. **El panel es el unico que decide las dos cosas y el que las dice**,
        que es lo que hace que "no se puede borrar el ultimo estado" sea una frase y
        no un `if` repartido por tres ficheros.
      */}
      {!readOnly ? (
        <StateEditorSheet
          list={editorAbierto ? list : null}
          states={borrador ?? states}
          counts={counts}
          readOnly={readOnly}
          onChange={cambiarEstados}
          onDelete={(columnaId, destinoId) => borrarColumna(columnaId, destinoId)}
          onClose={cerrarEditorDeEstados}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  medido: {
    flex: 1,
  },
  /**
   * The track of columns.
   *
   * **`flex: 1`, and it is load-bearing on native.** On the web the box stretches
   * across the width and takes the height that is left, but a horizontal scroll
   * view in a column with no height of its own measures its content — and the
   * content is a column of cards with a `flex: 1` inside it, which has no height to
   * measure. On a phone that is a board of zero height.
   *
   * The gap between two columns is the separator, and it is a gap and not a border
   * on each column: a border would put a line at the left of the first column and
   * at the right of the last, and that reads as the track itself having edges. What
   * tells one column from the next is inside `BoardColumn`, on its own muted fill.
   * And it is `gapColumnas` — the same number the widths are divided by — because a
   * separator that is not in the arithmetic is a separator that overflows.
   */
  pista: {
    flex: 1,
  },
  /**
   * The box that clips the track while a finger is on it.
   *
   * `flex: 1` so it is exactly the size of the track inside it, and
   * `overflow: hidden` so a track that has been dragged a whole column sideways is
   * cut at the edge of the track and not 380 points past it. Both platforms read
   * it: react-native-web writes it as `overflow: hidden` and React Native clips
   * there too, so there is one rule and not a web one with a native guess beside
   * it.
   */
  recorte: {
    flex: 1,
    overflow: "hidden",
  },
});
