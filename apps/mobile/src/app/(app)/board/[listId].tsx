import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useA11yHint } from "@/components/ui/a11y-hint";
import { BoardColumn } from "@/components/lists/board-column";
import { BoardTabs } from "@/components/lists/board-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemEditSheet } from "@/components/lists/item-edit-sheet";
import { Screen } from "@/components/ui/screen";
import { useListItems, useLists } from "@/hooks/use-lists";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useTranslation } from "@/lib/i18n";
import { countInState, tasksInState } from "@/lib/lists/board";
import { routeForList } from "@/lib/lists/route";
import { useTheme } from "@/theme";

/**
 * From this width up, a board shows more than one column.
 *
 * **720 is `READING_WIDTH`, and that is not a coincidence.** Every screen of the
 * app caps its content at that width so a line of text is not a line that runs
 * from the left edge of a laptop to the right one; a board is `width="full"` and
 * does not cap itself, because its columns are measured against what there is. The
 * number is where "a screen's worth of columns" and "a screen's worth of reading"
 * meet, and it is `READING_WIDTH` and not a number of columns because the answer
 * changes with what the window is: **a phone-width window is one state full-screen,
 * and a tablet-width one is a board.** Measured: 720 gives three columns of 232,
 * 800 gives three of 259, 1120 gives four of 271, and 368 — a 400-point window with
 * the drawer closed — gives one column of the whole width.
 */
const UMBRAL_UNA_COLUMNA = 720;

/**
 * The narrowest a column is drawn, **and it is 230 rather than 320.**
 *
 * The wide number came first and was wrong: in a track of 1120 —a 1440-point
 * window with the drawer open— it fits three columns of 320 and leaves a board of
 * eight half out of sight. At 230 the same track fits four. **Five or six columns
 * at once is what makes a board readable at a glance**, and comparing columns is
 * the whole point of a board: it needs more than one in the same look. A card with
 * a title, an icon and two labels is comfortable at 230, and a title has two lines
 * to be comfortable in.
 */
const ANCHO_MINIMO_COLUMNA = 230;

/**
 * The board of a list.
 *
 * **One screen for the three targets, and the width is what decides.** A narrow
 * window shows one state full-screen; a wide one divides the width between as
 * many columns as fit at `ANCHO_MINIMO_COLUMNA` and scrolls sideways with
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
 * prop would be read by nobody. The alternatives are to drop `pagingEnabled` in the
 * wide case, which loses the per-column snap that the web gets for free, or to
 * wait for the swipe of Task 9, which is the gesture that decides this on every
 * target anyway. **This is unverified on a device**: no simulator or phone is
 * attached to this machine, and the only target that was looked at is the browser.
 *
 * **There is no swipe yet.** The gesture that moves from one state to the next is
 * Task 9, and the cards cannot be picked up until Task 13. This screen is the
 * board as it is painted before either of those: it is deliberate that this is the
 * task where it can be *looked* at, because a swipe nobody has seen drawn is a
 * swipe nobody has checked.
 */
export default function BoardScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { listId } = useLocalSearchParams<{ listId: string }>();

  const { lists, isLoading: isLoadingLists, setTagColor } = useLists({});
  const list = useMemo(
    () => lists.find((item) => item.id === listId) ?? null,
    [lists, listId],
  );
  const { workspaces } = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.find((item) => item.id === list?.workspaceId) ?? null,
    [workspaces, list?.workspaceId],
  );
  const { items, isLoading: isLoadingItems } = useListItems(listId);

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

  /** The width the board is given, measured, and zero until it has been. */
  const [ancho, setAncho] = useState(0);
  /** Which column the board is anchored on, by index — the tabs' and the track's. */
  const [actual, setActual] = useState(0);
  const pista = useRef<ScrollView>(null);

  /**
   * How many columns fit, and how wide each one is.
   *
   * **Measured, and not a `snapToInterval`.** The interval would be the obvious
   * way to tell a scroller how wide a page is, and on the web it does not exist:
   * `react-native-web@0.21` ignores `snapToInterval` and implements only
   * `pagingEnabled`, as CSS scroll-snap over the children. So the number has to be
   * computed here from the width the box reports, and the box is the content box of
   * the screen rather than the window, because the screen's padding comes off
   * first.
   *
   * **Two behaviours and one screen.** Below `UMBRAL_UNA_COLUMNA` a column is the
   * whole width and one state is all there is; above it, as many columns as fit at
   * `ANCHO_MINIMO_COLUMNA`, and a sideways scroll with anchoring when they do not
   * all fit.
   *
   * **The gaps come out of the division, and that is measured rather than
   * reasoned.** Dividing the width by the number of columns and adding a gap
   * afterwards is the obvious way and it does not add up: with four columns at 280
   * and three gaps of 12 in a track of 1120, the columns ask for 1156 and **the
   * board always scrolls 36 points with every column already on screen**. So the
   * gap is part of what a column costs — `cuantasCaben` counts `ancho + gap` over
   * `ANCHO_MINIMO_COLUMNA + gap`, and the width of each one is what is left after
   * the gaps of the ones before it are taken out.
   *
   * `Math.max` with the minimum stays as the floor. With the division above it
   * cannot be reached — a count that fits at 230 also fits after the gap is
   * discounted — and if it ever were, the board would scroll, which is what a
   * column narrower than it can be read is worth.
   */
  const gapColumnas = theme.spacing.md;
  const cuantasCaben = Math.max(
    1,
    Math.floor((ancho + gapColumnas) / (ANCHO_MINIMO_COLUMNA + gapColumnas)),
  );
  const unaSolaColumna = ancho < UMBRAL_UNA_COLUMNA;
  /** Zero while the board has not been measured, which is what keeps it hidden. */
  const anchoColumna =
    ancho <= 0
      ? 0
      : unaSolaColumna
        ? ancho
        : Math.max(
            ANCHO_MINIMO_COLUMNA,
            (ancho - gapColumnas * (cuantasCaben - 1)) / cuantasCaben,
          );

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
   * Anchor the board on a column, **and move the track to it as well.**
   *
   * On a narrow window the tabs change which column is on screen, and on a wide
   * one they are the only way to reach the columns that did not fit: the tab strip
   * scrolls itself to show the chosen name and this scrolls the track to show the
   * chosen column, which are two halves of one jump. It is done here and not in an
   * effect on `actual` so that the swipe of Task 9, which also sets `actual`,
   * settles where the gesture left it instead of fighting it with a second
   * `scrollTo`.
   */
  function irA(id: string) {
    const index = states.findIndex((state) => state.id === id);
    // An id that is not a column of this board is not something to scroll to.
    if (index < 0) return;
    setActual(index);
    pista.current?.scrollTo({ x: index * anchoColumna, animated: true });
  }

  const pistaCrear = useA11yHint(t("itemCreate.titleHint"));

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
          onSelect={irA}
        />

        {/*
          The track waits for the measurement, and that is the only thing it waits
          for: a column of zero width is a column nobody can read, and one frame of
          a strip of tabs with nothing under it is the honest version of a column
          that has not been sized yet.
        */}
        {anchoColumna > 0 ? (
          <ScrollView
            ref={pista}
            testID="board-track"
            style={styles.pista}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: gapColumnas }}
          >
            {states.map((state) => (
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

                And the wrapper is also what `pagingEnabled` snaps:
                react-native-web marks each **child of the track** as a snap point,
                so the wrapper's left edge is the column's left edge and the browser
                lands on the column and not on the gap in front of it.

                **`flexGrow: 1`, and the reason is one level of box that only the web
                has.** On the web the snap point puts another box between the track
                and this one, and that box is a **column** —so the cross axis of this
                wrapper is its width, which is already decided, and its height is the
                main axis, which is what grows.* React Native has no such box: its
                children of a horizontal scroll view are stretched across the height
                directly. Measured with it missing, at 1440 points: every column was
                122 tall —its header and its empty state and nothing else— in a
                track of 776, so the board was four short bars at the top of the
                screen instead of four columns of it.
              */
              <View
                key={state.id}
                testID={`board-slot-${state.id}`}
                style={{ width: anchoColumna, flexGrow: 1 }}
              >
                <BoardColumn
                  state={state}
                  // `tasksInState` and not a filter of this component's own: it is
                  // the function that resolves a null `stateId` to the first
                  // column, and a row created on a board has nothing else.
                  tasks={tasksInState(items, states, state.id)}
                  tagColors={list.tagColors ?? {}}
                  readOnly={readOnly}
                  onOpenTask={(item) =>
                    setEditing({ itemId: item.id, page: "edit" })
                  }
                  onOpenIcon={(item) =>
                    setEditing({ itemId: item.id, page: "icon" })
                  }
                />
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {/*
        The one button that adds to this list, in the same corner as on every
        screen of the app: it is the same task row and the same panel, so it is the
        same button. A board with no way to add a task would be a screen nobody can
        put anything into, and the row that is created lands in the **first**
        column, which is what `stateId: null` means and is why creating a task here
        is the same code that creates one on any other list.
      */}
      <Pressable
        testID="item-create-button"
        accessibilityRole="button"
        accessibilityLabel={t("itemCreate.title")}
        {...pistaCrear.props}
        onPress={() => setEditing({ itemId: "", page: "edit" })}
        style={({ pressed }) => [
          styles.createButton,
          theme.shadow.floating,
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
      {pistaCrear.node}

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
  createButton: {
    position: "absolute",
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
});