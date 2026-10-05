import { useCallback, useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import type { BoardState, ListItem, TagColors } from "@orbit-hub/contracts";

import { EmptyState } from "@/components/ui/empty-state";
import { AppText } from "@/components/ui/text";
import { FLOATING_BUTTON_INSET } from "@/components/ui/floating-button";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { dropIndex, rowShift } from "@/lib/lists/drag-shift";
import { iconColor } from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";

import { TaskRow } from "./task-row";

export interface BoardColumnProps {
  /** The column, and its colour is the one the rows are edged with. */
  state: BoardState;
  /**
   * The tasks drawn in it, **already filtered by `tasksInState`**.
   *
   * A list and not a board: this component draws what it is given and decides
   * nothing about which column a row belongs to. `tasksInState` is the only thing
   * that answers that, and it answers it through `stateOf`, so a row with no state
   * of its own —which is every row created on a board— lands in the first column
   * instead of in no column at all. A screen that filtered by `item.stateId` here
   * would drop those rows with nothing failing anywhere.
   */
  tasks: ListItem[];
  /**
   * How many tasks this column holds **before any filter**, which is the number the
   * tab above it shows and not the one this header shows.
   *
   * **It is here only to tell an empty column from one a filter emptied**, and it is
   * the same number and not a boolean flag because the fact is two numbers and not one:
   * `tasks.length === 0 && totalTasks > 0` is a column that held work and is showing
   * none, and that can only be a filter. A flag could disagree with the counts it is
   * meant to explain —a filter on over a column that genuinely has nothing would print
   * "the filter hides 0 tasks" under a tab that says 0— and then the sentence is the
   * thing that is wrong. Two numbers cannot disagree with themselves.
   *
   * **It is not what the header counts, and this is the load-bearing half.** The header
   * draws `tasks.length` —what is in front of you— and this is what the column holds.
   * Both are right: the tab is the map of the whole board and the header labels the
   * cards underneath it. The two of them differ exactly when a filter is on, which is
   * why the empty state has to be able to say *why*.
   */
  totalTasks: number;
  /**
   * This list's chosen label colours, handed down from the screen's `list`.
   *
   * The same prop `TaskRow` takes and for the same reason: a label's colour is
   * chosen per list, so a row cannot go and find it for itself.
   */
  tagColors: TagColors;
  /**
   * Whether this board can be written to at all.
   *
   * **It gates the gesture, and it is the first term of `sePuedeReordenar`.** A
   * viewer is not somebody to hand a card that lifts and travels: the write it ends
   * in would be refused by the server —`assertCanWrite` requires `editor`— and a
   * rejected operation is invisible from the screen, so the card would come back to
   * its place with nothing said. The screen also stops passing `onReorder` to a
   * read-only board, so the two guards are independent and neither is the only one.
   *
   * **It does not grey anything out and it does not disable the tap.** `onOpenTask`
   * is already stopped by the screen for a viewer, and the rest of the column is
   * the same drawing it was.
   */
  readOnly: boolean;
  /** Opens the task. */
  onOpenTask: (item: ListItem) => void;
  /** Opens the pictures of the task, which are their own target and not the row. */
  onOpenIcon: (item: ListItem) => void;
  /**
   * Commits a drop inside this column, **and the caller writes**.
   *
   * **An id and an index, and not the new order**, because the column is the only
   * thing that knows its own rows and their order — it is handed `tasks` already
   * sorted by `tasksInState` — and the arithmetic of the drop belongs to
   * `nextOrderFromDrop`, which is tested and is not reimplemented here. The screen
   * receives the two numbers and decides which rows get a `position`.
   *
   * **Absent means there is no drag at all**, which is how a read-only board and a
   * board of one card end up with the same gesture: `sePuedeReordenar` below.
   */
  onReorder?: (taskId: string, toIndex: number) => void;
}

/**
 * What the cards of one column share while one of them is being dragged.
 *
 * **Shared values and not React state**, for the reason `draggable-row.tsx` gives:
 * a drag fires a move per frame and a state change per frame is a render of the
 * whole column per frame. A shared value read by an animated style costs a style
 * recalculation.
 *
 * **`paso` is the pitch and not the height**, and the comment on the `onLayout`
 * that writes it says why in full. `dropIndex` divides how far the finger went by
 * it, so a number that is only the height leaves every card further down a gap's
 * width out — on a column of twelve the drop lands more than a card away from the
 * hole that opened for it.
 */
interface OrdenColumna {
  /** The card being dragged, or null. */
  arrastrada: SharedValue<string | null>;
  /** Where it was when the finger went down. */
  desde: SharedValue<number>;
  /** Where it would land if the finger lifted now. */
  hasta: SharedValue<number>;
  /** The distance from one card to the next: the height of a card plus the gap. */
  paso: SharedValue<number>;
  /** Writes the drop. The screen owns `position`; this only hands over two numbers. */
  soltar: (taskId: string, toIndex: number) => void;
}

/**
 * How long a finger has to be still before the card under it lifts, **in
 * milliseconds.**
 *
 * **Two hundred and sixty, and it is a number read off two neighbours rather than
 * chosen.** React Native's `Pressable` calls something a long press at **500**
 * (`delayLongPress`'s default, which is what `task-row.tsx` uses for the name of a
 * task) and the same file's own sheet of long names asks for **320** explicitly
 * (`full-title.tsx`, `delayLongPress={320}`). This one has to be **shorter** than
 * the 500 for the reason the last section of this file's `TaskRow` note is about: at
 * 500 or more, holding a card still long enough to read what happens is the same
 * thing as picking it up, and the two gestures cannot both own the hold.
 *
 * **`activateAfterLongPress`, and not a `LongPress` in front of a `Pan`.** The
 * pan's own API already means "this pan only counts after a long press", and on the
 * web it is literally a timer inside the handler — `PanGestureHandler.js`, in
 * `tryBegin`: `this.activationTimeout = setTimeout(() => this.activate(), …)`.
 * Two gestures for one finger would be the race `state-editor-sheet.tsx` writes
 * about — *"two `Gesture.Pan`s claiming the same finger"* — and the timer is one
 * gesture.
 *
 * **And the same handler is what gives the vertical back.** On the web its
 * `shouldFail` gives the gesture up as soon as the pointer has moved more than the
 * touch slop —**15** points, `DEFAULT_TOUCH_SLOP` in `web/constants.js`— before the
 * timer fires, so a pointer that travels is a scroll and a pointer that waits is a
 * lift. That, and not the 260, is what makes this gesture safe next to the pager:
 * the board's `swipe` has `failOffsetY([-12, 12])` and **is not touched by this
 * task**, so a clearly vertical gesture never reaches the pager and a clearly
 * horizontal one never reaches here.
 *
 * **Measured in the browser**, con un raton: una pulsacion sin movimiento levanta la
 * tarjeta **260 ms** despues —contado en los fotogramas que llevan la sombra de
 * `theme.shadow.floating`— y un movimiento de **120 puntos** en horizontal antes de
 * ese plazo **no** la levanta y **si** cambia de columna
 * (`scripts/verify-state-editor.mjs`, bloque 20, que instala el muestreo **antes**
 * del gesto y lo lee despues). **En un telefono el numero que decide es el
 * `ViewConfiguration` de la plataforma y no este**, asi que **no esta medido**: no
 * hay simulador ni movil conectado a esta maquina.
 */
const LEVANTAR = 260;

/**
 * The pitch of a column before any card has reported its layout, **and it is the
 * state editor's number and not one of its own.**
 *
 * A shared value that no card has written is `0`, and `dropIndex` answers
 * `Math.round(translationY / 1)` to that — **every card of the column** — which is a
 * drag that flies to the end and lands somewhere nobody chose. The two clauses of
 * `OrdenEstados` say the same thing about their own default.
 */
const PASO_POR_DEFECTO = 56;

/**
 * How long the card takes to go down and to come back, **and they are two numbers
 * because they are two feelings.**
 *
 * The lift is **130 ms** and the drop is the **170 ms** of
 * `draggable-row.tsx`'s `SOLTAR`, which is `Easing.out(Easing.cubic)` in both
 * cases and not a spring: a spring overshoots by arithmetic and a card that passes
 * the row it was dropped on and comes back is the bounce, on every drop.
 *
 * **The lift is shorter because it answers the finger, not the card**: 130 ms after
 * 260 ms of holding is 390 ms from the finger landing to the card being visibly
 * off the plane, and a second and a half of that is a card that does not feel
 * picked up.
 */
const ALZAR = { duration: 130, easing: Easing.out(Easing.cubic) } as const;
const SOLTAR = { duration: 170, easing: Easing.out(Easing.cubic) } as const;

/**
 * How much bigger a lifted card is drawn, **and 2% and not more.**
 *
 * A card on a board is a physical thing being picked up, and `scale` is the only
 * part of a lift a `withTiming` can actually interpolate — a `boxShadow` is a
 * string and there is nothing to interpolate between two of them, so the shadow is
 * swapped at the halfway point of this same value and the size carries the motion.
 * **Not measured: at what scale a card reads as lifted**, because there was nothing
 * to compare it against; 2% is what `draggable-row.tsx` reaches with a shadow alone
 * and it is the smallest number that is visible at a 68-point card.
 */
const ESCALA_ALZADA = 1.02;

/**
 * The shadow a card that is not lifted has, **written out because
 * `draggable-row.tsx` writes the same one and a card has to come back to it.**
 *
 * `'0px 0px 0px rgba(0, 0, 0, 0)'` and not `'none'`: `boxShadow` is animated by
 * value and `none` is not a colour, so a style that swapped `none` in and out would
 * leave the property invalid for a frame.
 */
const SIN_SOMBRA = "0px 0px 0px rgba(0, 0, 0, 0)";

/**
 * One column of a board: the name of the state with its count, and the cards of
 * the tasks that are in it.
 *
 * **The card is the row of a task list, without the tick.** `TaskRow` takes
 * `onToggle` as optional and this column does not pass it, and that is what
 * removes the checkbox rather than greying it out: on a board "done" is a state,
 * and a disabled tick in the margin of every card is furniture that says nothing.
 * What replaces it is `edgeColor`, the colour of the state down the left edge, so
 * a card keeps saying which state it is in when it is read away from its column.
 *
 * **The state colour is a colour key and not a theme colour.** It is chosen per
 * board out of the twelve the app already draws icons in, and `iconColor` is what
 * turns that key into a value — the same door `ItemIcon` goes through, so a state
 * and an icon of the same key are the same colour on the same screen. It is not
 * looked up in the theme because the theme does not know what states this list
 * has.
 *
 * **The fill is `surfaceMuted` and the edge is `border`, and that is what makes a
 * board read as a board.** Without them the columns are four lists of cards with
 * gaps between them and the eye reads a wall. The name of the state is at the top
 * of its own column and **not on the card**: on a phone you already know which
 * column you are in, and in a wide window the header above the cards says it. On
 * the card it would be a second place saying something the screen already says.
 */
export function BoardColumn({
  state,
  tasks,
  totalTasks,
  tagColors,
  readOnly,
  onOpenTask,
  onOpenIcon,
  onReorder,
}: BoardColumnProps) {
  const theme = useTheme();
  const t = useTranslation();

  /** The header read as one thing, with the count said and not printed. */
  const encabezado = t(pluralKey("lists.itemCount", tasks.length), {
    count: tasks.length,
  });

  /**
   * Whether this column is empty **because of a filter**, and not because it holds
   * nothing.
   *
   * **It is the difference between two numbers and not a flag from the screen**, and
   * `totalTasks` is where the second one comes from: the tab above this column says
   * 2, this column draws nothing, and "Sin tareas" under a tab that says 2 is a
   * column that has lost two tasks without anybody having lost anything. That is the
   * reading the brief sent me to look for, and it is the first thing anybody who
   * filters a board sees.
   *
   * **A column that genuinely holds nothing keeps its own sentence.** With no filter
   * on, both numbers are 0 and the column really is empty; with a filter on over a
   * column that never had tasks —"Hecho" in the walkthrough's board— it is still
   * empty, and "the filter hides 0 tasks" would name a hiding that is not happening.
   * So the term that decides is `totalTasks > 0`, not "is a filter on".
   */
  const vaciaPorFiltro = tasks.length === 0 && totalTasks > 0;

  /**
   * What the empty state says, **and it is one of two sentences that are not the same
   * sentence.**
   *
   * The filtered one **carries the number that is hidden**, which is `totalTasks` and
   * not `tasks.length`: that number is the one the tab above is already showing, so
   * the two figures on screen end up counting each other and nobody has to subtract
   * anything to find out where the two cards went. The hint below it then says what
   * to do about it, and it talks about **the column** rather than the tasks, because
   * "quitá el filtro para verlas" has to change its pronoun with the count and this
   * one does not.
   *
   * `EmptyState` is what draws the description, and it was already a prop it had: the
   * empty state of a board with no states is the same component.
   */
  const vacio = vaciaPorFiltro
    ? {
        titulo: t(pluralKey("board.emptyColumnFiltered", totalTasks), {
          count: totalTasks,
        }),
        descripcion: t("board.emptyColumnFilteredHint"),
      }
    : { titulo: t("board.emptyColumn"), descripcion: undefined };

  /**
   * Whether a card of this column can be picked up, **and it is three terms
   * because each of them is a different reason not to.**
   *
   * - `!readOnly`: a viewer has no write behind the drop, and a gesture that
   *   cannot be finished is worse than no gesture;
   * - `onReorder`: **the caller writes**, so no callback means nobody to write to.
   *   The screen stops passing it for a read-only board, which makes this term and
   *   the first one two doors to the same lock rather than one door and a comment;
   * - `tasks.length > 1`: **there is nowhere for a card to go.** The destination is
   *   a card's index inside its own column, and a column of one card has exactly
   *   one of those — so the drop would be `nextOrderFromDrop` handing back the very
   *   array it was given, which is a lift with no landing on the only card of the
   *   only column where a lift says nothing true.
   */
  const sePuedeReordenar = !readOnly && onReorder !== undefined && tasks.length > 1;

  /*
    --------------------------------------- el reordenado de las tarjetas de esta columna --
    Los cuatro valores compartidos, y **están aquí y no en la tarjeta** porque los
    escriben las tarjetas y tienen que sobrevivir a la que se está moviendo: la que
    levanta la tarjeta se desmonta si la columna cambia de largo, y una tarjeta
    desmontada se lleva por delante el `arrastrada` de las otras —que entonces nunca
    vuelve a `null` y deja un agujero abierto para siempre—.
  */
  const arrastrada = useSharedValue<string | null>(null);
  const desde = useSharedValue(0);
  const hasta = useSharedValue(0);
  const paso = useSharedValue(PASO_POR_DEFECTO);

  /**
   * What every card of this column reads, **and it is one object for the whole
   * column and not one per card**: a card that does not know who is being dragged
   * cannot make room, and the whole of a live reorder is that the cards around the
   * one being dragged step out of the way while the finger is still down.
   */
  const orden = useMemo<OrdenColumna>(
    () => ({
      arrastrada,
      desde,
      hasta,
      paso,
      soltar: (taskId, toIndex) => onReorder?.(taskId, toIndex),
    }),
    [arrastrada, desde, hasta, paso, onReorder],
  );

  return (
    <View
      testID={`board-column-${state.id}`}
      style={[
        styles.columna,
        {
          gap: theme.spacing.md,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <View
        style={[styles.cabecera, { gap: theme.spacing.sm }]}
        accessible
        accessibilityRole="header"
        /**
         * **The label carries the same reason the empty state does, and not only the
         * visible text does.**
         *
         * A screen reader reaches this header before the empty box under it, so
         * "En curso, 0 elementos" is the first thing it says about a column whose tab
         * says 2 — which is the whole confusion, said out loud to the people who
         * cannot see the tab next to it and count. Appending the sentence makes the
         * two numbers explain each other in the ear as well as on the screen.
         *
         * And it is the **same** `vacio.titulo` the box below draws, so there is one
         * sentence and not two that can drift apart.
         */
        accessibilityLabel={`${state.title}, ${encabezado}${
          vaciaPorFiltro ? `, ${vacio.titulo}` : ""
        }`}
      >
        {/* The colour of the state, as the dot the tab strip also draws: two
            shapes of the same size, so the eye matches a column to its tab. */}
        <View
          style={[
            styles.punto,
            {
              backgroundColor: iconColor(state.color),
              borderRadius: theme.radius.pill,
            },
          ]}
        />
        <AppText variant="callout" style={styles.nombre} numberOfLines={1}>
          {state.title}
        </AppText>
        {/* The number and not the phrase. The whole header has to fit in a
            230-point column, and "4 elementos" beside "Waiting for review" leaves
            the name two thirds of the column; the phrase is what the header is
            *read* as, above, and a screen reader is the one that needs the words. */}
        <AppText variant="caption" tone="muted" testID={`board-count-${state.id}`}>
          {tasks.length}
        </AppText>
      </View>

      {/*
        The cards scroll inside the column and the page does not scroll at all,
        and that is the arrangement that lets a board be taller than the window
        with the header and the tabs still there: they are outside this box. The
        two scrollers are on different axes —this one vertical, the track around
        it horizontal— so a drag that is clearly vertical cannot page the board
        and a drag that is clearly horizontal cannot scroll a column.
      */}
      <ScrollView
        testID={`board-cards-${state.id}`}
        style={styles.cajas}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.cajasContenido,
          {
            gap: theme.spacing.sm,
            /*
              The room for the board's `+`, **and the button's own number.**
              Without it the last card of a column that happens to be the one under
              the corner button has half of itself behind it: the button is drawn
              over the content and the column ends where the window ends, so the
              card cannot be scrolled clear of anything. `FLOATING_BUTTON_INSET` is
              the button's `bottom` plus its larger size, and the column asks the
              button rather than writing a number that would be the second copy of a
              decision somebody else already made.

              It is not `Screen`'s `bottomInset`, and that is not an oversight:
              `screen.tsx` drops `bottomInset` when `edgeToEdge` is set, because the
              two are the same job in different places — and a board whose columns
              fill the window needs `edgeToEdge` or there is a band of background
              under them. So the room is reserved inside the column that scrolls,
              which is where it is needed and where a column narrower than the
              button still gets it.
            */
            paddingBottom: FLOATING_BUTTON_INSET,
          },
        ]}
      >
        {tasks.length === 0 ? (
          /*
            In the middle of the column and not at the top of it, which is what
            `flex: 1` on an empty state buys: an empty column that says "no tasks"
            in its first line reads as a list that has been cut off, and the same
            sentence in the middle of the box reads as the state it is.

            **And which of the two sentences it is comes from `vacio` and not from
            here.** A column that a filter emptied and a column that holds nothing
            look the same on the screen and are not the same fact, and writing one
            sentence for both is what put "Sin tareas" under a tab that said 2. The
            description below the title is only there in the filtered case, and it
            says what to do about it.
          */
          <EmptyState
            title={vacio.titulo}
            description={vacio.descripcion}
            compact
            style={styles.centrado}
          />
        ) : (
          tasks.map((item, index) => (
            <Tarjeta
              key={item.id}
              item={item}
              index={index}
              total={tasks.length}
              ordenable={sePuedeReordenar}
              hueco={theme.spacing.sm}
              orden={orden}
              state={state}
              tagColors={tagColors}
              onOpenTask={onOpenTask}
              onOpenIcon={onOpenIcon}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One card of a column: the row of the task, and **the gesture that picks the card
 * up and the two styles that come out of it.**
 *
 * **It is a component and not more markup inside the map of the column**, because
 * there are three things here that the column itself cannot hold: four shared
 * values that belong to the card and not to the column — the finger's travel and
 * how far off the plane it is — a `Gesture` that has to know its own index in the
 * column, and a listener on the card's DOM node for the click that follows a drop.
 * The first two would be re-created for every card on every render of the column if
 * they were written inline, and the third needs a `useEffect` of its own.
 *
 * **The whole gesture lives here and not on the column**, for the reason
 * `state-editor-sheet.tsx` writes on `AsaEstado`: one gesture, one finger. Two
 * `Gesture.Pan`s claiming the same touch is a race for it, and the one on the bigger
 * target —the column, here— would win.
 */
function Tarjeta({
  item,
  index,
  total,
  ordenable,
  hueco,
  orden,
  state,
  tagColors,
  onOpenTask,
  onOpenIcon,
}: {
  item: ListItem;
  /** Which card of the column this is, counted from zero, in the order it is drawn. */
  index: number;
  /** How many cards the column has: the destination is clipped to `total - 1`. */
  total: number;
  /** Whether the finger may pick this card up at all. See `sePuedeReordenar`. */
  ordenable: boolean;
  /** The space the column leaves between cards, which is `spacing.sm`. */
  hueco: number;
  /**
   * What the column shares, **handed down and not read from a context.**
   *
   * `state-editor-sheet.tsx` puts its three values in a context because its rows are
   * rendered by a `FlatList` and a context is the way to stop threading four props
   * through `renderItem`. **These cards are two levels down in a `map` and no
   * further**, so a context here would be an indirection with nothing behind it — and
   * a nullable one, which turns every read of a shared value into a `if (!orden)`
   * that can never be false. The provider is still above the list because the four
   * shared values are written by the cards and have to outlive one card: see
   * `OrdenColumna`.
   */
  orden: OrdenColumna;
  state: BoardState;
  tagColors: TagColors;
  onOpenTask: (item: ListItem) => void;
  onOpenIcon: (item: ListItem) => void;
}) {
  const theme = useTheme();

  /** How far the finger has taken the lifted card, in points. */
  const dedo = useSharedValue(0);
  /** Zero flat, one off the plane: what the shadow, the scale and `zIndex` read. */
  const alzada = useSharedValue(0);

  /**
   * The step of this column, **and it is shared on purpose and not a prop.**
   *
   * Every card of the column writes the same number here on its `onLayout` —height
   * plus gap— and the value the gesture divides by is whatever the last card to be
   * laid out said. **A column whose cards are of different heights therefore has one
   * pitch, and it is the pitch of whichever card was measured last.** With cards of
   * one height, as `verify-state-editor.mjs`'s block 20 measures before dragging
   * anything, the question does not arise; with a task with a long title and one with a
   * short one it does, and it is the same limitation `draggable-row.tsx` has and does
   * not solve: both are "the distance to the next row", which needs a next row to
   * exist. **It is written here rather than left implicit because it is a property of
   * the layout and not of the gesture.**
   */

  /**
   * The theme's two numbers for a lifted thing, **taken out of the theme because a
   * worklet cannot close over one.**
   *
   * `theme.shadow.floating` is the token `FloatingButton` uses
   * (`floating-button.tsx:133`), so a card that is picked up has the same shadow as
   * the app's other floating thing — and not `shadow.card`, which is what every
   * flat card in this app already has and would be invisible as a change.
   *
   * `boxShadow` is a string and there is nothing to interpolate between two
   * shadows, so the shadow is **swapped at the halfway point of `alzada`** and what
   * the `withTiming` animates is the size: see `ESCALA_ALZADA`.
   */
  const sombraAlzada = theme.shadow.floating.boxShadow ?? SIN_SOMBRA;
  const elevacionAlzada = theme.shadow.floating.elevation ?? 0;

  /**
   * The card was picked up, **and the `click` that ends it is not a tap.**
   *
   * On a phone the release that follows a long press is not a press: React Native
   * delivers it to whoever has the gesture, and a `Pressable` under a lifted card
   * does not fire. **On the web it is a `click` and it does fire** — react-native-web
   * binds a DOM `click` on the pressable and the browser raises one whenever the
   * press and the release land on the same element, **however far the finger
   * travelled**. So the drop is a drag *and* a tap, and every card that opens on
   * tap opened itself at the end of every drag: the order changed and a state sheet
   * came up over it a moment later, which reads as the drag not taking. This is
   * the fix `draggable-row.tsx` already carries, and the flag is armed by the
   * gesture **activating** so a plain tap — which never activates it — is untouched.
   *
   * **Measured in the browser**, in both directions: a quick tap opens the state
   * sheet and a long press with no movement does not
   * (`scripts/verify-state-editor.mjs`, block 20). **Not measured on a device**:
   * there is no document there, so the listener does not exist and there is nothing
   * to swallow.
   */
  const recien = useRef(false);
  const marcarRecien = useCallback((value: boolean) => {
    recien.current = value;
  }, []);
  const nodo = useRef<View>(null);
  useEffect(() => {
    // `addEventListener` only exists on a DOM node, which is the whole point: on
    // Android and iOS this is not a branch, it is a no-op.
    const el = nodo.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const alPulsar = (event: Event) => {
      if (!recien.current) return;
      recien.current = false;
      // In the capture phase and not the bubble one, because the row's own
      // `onPress` has already been bound by the time anything could stop it.
      event.preventDefault();
      event.stopPropagation();
    };
    el.addEventListener("click", alPulsar, true);
    return () => el.removeEventListener("click", alPulsar, true);
  }, []);

  /**
   * The drag, **and the whole of what separates a lift from a tap from a swipe**.
   *
   * - `.enabled(ordenable)`: a viewer, a column of one card and a board with no
   *   writer all get no gesture at all, and a handler that is disabled also stops
   *   writing `touch-action` on the web, so the column keeps its own scroll;
   * - `.activateAfterLongPress(LEVANTAR)`: a finger that waits lifts the card and a
   *   finger that travels does not — see `LEVANTAR`, which is also where the reason
   *   for not touching the board's own `failOffsetY([-12, 12])` is written down;
   * - `.minDistance` is left alone on purpose. The default, which is what makes
   *   `shouldFail` fire on the web, **is** the guarantee that a movement before the
   *   long press cancels this gesture, and a smaller number here would be a
   *   gesture that gives up too early and steals the column's scroll.
   */
  const gesto = Gesture.Pan()
    .enabled(ordenable)
    .activateAfterLongPress(LEVANTAR)
    .onStart(() => {
      orden.arrastrada.value = item.id;
      orden.desde.value = index;
      orden.hasta.value = index;
      dedo.value = 0;
      alzada.value = withTiming(1, ALZAR);
      // The flag the click listener below reads, and the reason it is armed by the
      // gesture activating and not by the drop moving: see that listener.
      runOnJS(marcarRecien)(true);
    })
    .onUpdate((event) => {
      dedo.value = event.translationY;
      /**
       * `dropIndex`, imported and not written again. **The brief names
       * `dropTargetIndex` and this is the same arithmetic in the one file that can
       * be called from the interface thread**: `drag.ts` has no worklet directive
       * on `dropTargetIndex` and `drag-shift.ts` has one on `dropIndex` and on
       * `rowShift`, and a function without the directive is a call to the JavaScript
       * thread from the UI thread, which answers on the web —same thread, nothing to
       * see— and does not answer on a device. The two are the same formula —
       * `Math.round(translationY / pitch)` clipped to `[0, total - 1]` — and they
       * differ in one thing: `dropTargetIndex` answers `fromIndex` when the pitch is
       * not measured yet and `dropIndex` answers with a division by one. Which is
       * why `paso` starts at `PASO_POR_DEFECTO` rather than at zero.
       */
      orden.hasta.value = dropIndex({
        index,
        total,
        translationY: event.translationY,
        rowHeight: orden.paso.value,
      });
    })
    .onEnd(() => {
      const destino = orden.hasta.value;
      /**
       * **A drop that goes nowhere writes nothing**, and it is checked here and not
       * left to the writer: `nextOrderFromDrop` hands back the very array it was
       * given, so a long press and a release with no movement would otherwise send
       * the writer a drop onto the index the card came from, and the writer would
       * compare every position and find them all equal and write nothing — which is
       * the right answer reached through a function call for nothing. This is the
       * same `from === to` guard `AsaEstado`'s `mover` has.
       */
      if (destino !== index && destino >= 0 && destino < total) {
        runOnJS(orden.soltar)(item.id, destino);
      }
      orden.arrastrada.value = null;
      dedo.value = withTiming(0, SOLTAR);
      alzada.value = withTiming(0, SOLTAR);
    })
    .onFinalize(() => {
      /**
       * Cancelled — the finger left the bounds, the browser took the touch for a
       * scroll, a second finger arrived — **and `onEnd` may not have run.** A pan
       * that is cancelled with its shared values still set leaves a card that is
       * lifted for ever and a hole that never closes, so the reset is written here
       * as well as in `onEnd`, and `onEnd`'s is the one that lands first.
       */
      orden.arrastrada.value = null;
      dedo.value = withTiming(0, SOLTAR);
      alzada.value = withTiming(0, SOLTAR);
    });

  /**
   * **The one animated style of the card, and both of its motions are in it**
   * because Reanimated writes the whole `transform` array a style declares: two
   * styles that each had a `transform` would be the second one overwriting the
   * first, and a card that is picked up and does not follow the finger is the
   * gesture that looks broken.
   *
   * `rowShift` for the cards that are making room and the finger's travel for the
   * card being dragged, both read on the interface thread: no render per frame.
   */
  const estilo = useAnimatedStyle(() => {
    const yo = orden.arrastrada.value === item.id;
    const huecoDe = rowShift({
      draggingId: orden.arrastrada.value,
      id: item.id,
      index,
      from: orden.desde.value,
      to: orden.hasta.value,
      rowHeight: orden.paso.value,
    });
    return {
      transform: [
        { translateY: yo ? dedo.value : huecoDe },
        { scale: interpolate(alzada.value, [0, 1], [1, ESCALA_ALZADA]) },
      ],
      /**
       * Above its neighbours while it is up, **and it needs `position: relative` on
       * the card for that to be true on the web**: `z-index` on a static element is
       * ignored by CSS, and react-native-web writes `z-index: 10` on a card that is
       * not positioned into nothing at all, so a lifted card slides *under* the ones
       * it is passing.
       */
      zIndex: alzada.value > 0 ? 10 : 0,
      elevation: Math.round(alzada.value * elevacionAlzada),
      boxShadow: alzada.value > 0.5 ? sombraAlzada : SIN_SOMBRA,
    };
  });

  return (
    /**
     * **`touchAction="pan-y"` is load-bearing and it is web only.** React Native
     * Gesture Handler writes `touch-action: none` on whatever view a gesture is
     * attached to (`GestureHandlerWebDelegate.js`, `this.view.style['touchAction'] =
     * touchAction ?? 'none'`), which on the web would take the **vertical** away from
     * the column this card is in: a column with more cards than fit —which is what
     * the twelve-card board of the check is— would stop scrolling under a finger.
     * `pan-y` says the browser may pan vertically and not horizontally.
     *
     * **What that costs, and it is a cost and not a free win**: with `pan-y` the
     * browser keeps the vertical for itself, so **the reorder needs a mouse on the
     * web and not a finger** — a finger that moves vertically after the long press
     * is a scroll, and the browser cancels the pointer. On a phone the handler is a
     * native one and `activateAfterLongPress` claims the touch after the hold, so
     * the drag is a finger there; **that half is written from the API and is not
     * measured, because there is no simulator or phone attached to this machine.**
     * The alternative —leaving the default `none`— was not taken because it costs
     * the column its scroll on a target where a long press can be done with a
     * mouse, which is the target this repo can check.
     */
    <GestureDetector gesture={gesto} touchAction="pan-y">
      <Animated.View
        ref={nodo}
        testID={`board-card-${item.id}`}
        style={[
          styles.tarjeta,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
          },
          estilo,
        ]}
        onLayout={(event) => {
          /**
           * **The pitch, measured as the distance to the next card and not as the
           * height.** The card's height plus the space the column leaves between
           * cards, because both `dropIndex` and `rowShift` do arithmetic of "one card
           * further down". A number that is only the height is a gap's width short on
           * every card, and on a column of twelve the drop lands more than a card
           * away from the hole that opened for it — the finger is over the fifth
           * card and the row goes to the fourth, and it reads as the drag not taking.
           *
           * `hueco` is the `gap` of the column's content, handed down by the caller
           * rather than read from the theme here, because whoever lays the cards out
           * is the only one who knows it. `alto > 0` because a layout of zero is a
           * frame that has not measured yet and writing `paso = hueco` from it would
           * be a pitch of one gap.
           */
          const alto = event.nativeEvent.layout.height;
          if (alto > 0) orden.paso.value = alto + hueco;
        }}
      >
        <TaskRow
          item={item}
          tagColors={tagColors}
          onEdit={() => onOpenTask(item)}
          onIcon={() => onOpenIcon(item)}
          edgeColor={iconColor(state.color)}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  /**
   * The column, and **it has no width and no height of its own.**
   *
   * Both are measured by the screen and handed down: the width through the wrapper
   * around this component —inside the content box of a horizontal scroll view a
   * child with no width takes **the width of its content**, because neither React
   * Native nor `react-native-web` gives a view a `flexBasis`— and the height
   * because nothing in the chain of boxes below the track would shrink. See the
   * comment on `altoPista` in the screen for the measurement that came out of that.
   *
   * `flexGrow: 1` **and** `flexShrink: 1`, and the shrink is the half that is easy
   * to leave out: the grow fills the box it is given and the shrink is what keeps a
   * column with more cards than fit inside it instead of growing past the bottom of
   * the window. Both act on the **height**, because the box that holds this column
   * is a column on the two targets alike —the screen's wrapper is one, and the extra
   * box `pagingEnabled` puts between the track and the wrapper on the web is one as
   * well— so neither of them has an opinion about the width.
   */
  columna: {
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cabecera: {
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * Ten points, and it is the only size in this file written by hand: it is the
   * shape of a dot and not a gap, and the theme has no token that means "how big
   * is a dot". It is the same ten the tab strip draws, which is what lets the eye
   * match a column to its tab.
   */
  punto: {
    width: 10,
    height: 10,
  },
  /**
   * The name of the state, and it **gives up its width before the count does.**
   *
   * Two children of a row cannot shrink on their own on the web —
   * `react-native-web@0.21` writes `flexShrink: 0` on every `View` it makes, the
   * same trap the `styles.nombre` of `task-row.tsx` is measured against — so a
   * state called "Waiting for review" pushed its count off the right edge of a
   * 230-point column, and the column header lost the number that says how much is
   * in it. `minWidth: 0` here is what lets the name narrow to one line instead of
   * the column widening.
   */
  nombre: {
    flex: 1,
    minWidth: 0,
  },
  cajas: {
    flex: 1,
  },
  /** The empty state of a column, in the middle of it rather than at the top. */
  centrado: {
    flex: 1,
  },
  /**
   * The cards go edge to edge, so the last one is not glued to the bottom of the
   * column and the first one is not glued to the header. The column's own padding
   * already gives the sides.
   *
   * And it grows, so an empty column's `EmptyState` can sit in the middle of the
   * box: without it the content is as tall as its own children and the empty state
   * is at the top of the column, which reads as a list that was cut off.
   */
  cajasContenido: {
    flexGrow: 1,
  },
  /**
   * The card, and it is a box because **a card on a board is not a row of a
   * list**.
   *
   * The rows of a list are one flat column of things that belong together and the
   * page's own background shows between them. A card is a thing that will be
   * picked up and dropped into another state, so it gets a surface and a radius of
   * its own on the muted fill of the column: without them the board is the flat
   * list with headings, which is exactly what it is not. The hairline is what
   * separates it from that fill, which is one step away from it and not two.
   */
  tarjeta: {
    /**
     * **`position: "relative"` and it is for the web alone**, and the reason is the
     * animated style of the card: it writes `zIndex: 10` while the card is lifted so
     * that it paints over the ones it passes, and **CSS ignores `z-index` on an
     * element that is not positioned** — so on react-native-web a lifted card slid
     * *under* the neighbours it was travelling between, which is the opposite of
     * what "picked up" looks like. On Android and iOS `relative` is already the
     * default of a view, so this changes nothing there.
     */
    position: "relative",
    borderWidth: StyleSheet.hairlineWidth,
    // The row draws its own edge colour on the left with a border, and a rounded
    // box that does not clip turns that into a stripe with square corners
    // sticking out of the radius.
    overflow: "hidden",
  },
});
