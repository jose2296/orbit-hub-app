import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { BoardState, ListItem, TagColors } from "@orbit-hub/contracts";

import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { AppText } from "@/components/ui/text";
import {
  FLOATING_BUTTON_MARGIN,
  FLOATING_BUTTON_STACK_INSET,
} from "@/components/ui/floating-button";
import { pluralKey, useTranslation } from "@/lib/i18n";
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
  /** Opens the task. */
  onOpenTask: (item: ListItem) => void;
  /** Opens the pictures of the task, which are their own target and not the row. */
  onOpenIcon: (item: ListItem) => void;
  /**
   * Open this column's order sheet, **and absent in read-only.**
   *
   * A viewer has no order to change — the write would be refused — so the name
   * is not pressable for them, and the `···` is not drawn: two controls that
   * cannot write would be wearing the shape of sentences.
   */
  onOpenOrder?: (stateId: string) => void;
  /**
   * Open this column's menu (edit state, edit order), **and absent in
   * read-only.**
   *
   * The button is not drawn at all without it: a `···` that opened a menu of
   * two edits a viewer cannot make would be two dead presses wearing the shape
   * of a control.
   */
  onOpenMenu?: (stateId: string) => void;
}

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
  onOpenTask,
  onOpenIcon,
  onOpenOrder,
  onOpenMenu,
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
          /*
            **The room below the panel, and it is the floating button's own margin
            and not a number of its own.**
            Without it the panel is exactly as tall as the box it is given: measured
            in the browser with 16 cards in a column, the panel ended at 932 in a
            window of 932, at 900 in a window of 900 and at 480 in a window of 480 —
            **always flush with the last pixel row**, eight viewports and both
            themes, because `Screen` runs with `edgeToEdge` and that is what
            `edgeToEdge` does: `paddingBottom: 0`. So the bottom border was drawn
            *on* the edge of the window, with no background under the rounded
            corner to be a rounded corner against — measured, the last row of
            pixels at x=30 is the border colour and the row above is the panel's
            own fill, and below the panel there was nothing at all.

            Which is the complaint this margin answers, and the brief's own account
            of it — the `ScrollView` reserving `FLOATING_BUTTON_INSET` and the box
            "exceeding the track height" — **is not what the browser does**: the
            box was already capped, at 698 of client height against a track of 756
            in that same 430 x 932 measurement, `flex: 1 1 0%` and `min-height: 0`
            computed, with 416 points of content scrolling inside it. The box was
            never the thing that ran past the screen; the panel was, because nothing
            below it was reserved. See the report for the rest.

            **`FLOATING_BUTTON_MARGIN` and not `FLOATING_BUTTON_STACK_INSET`**, and
            the difference is deliberate: the corner has to be *seen*, so the gap
            under it has to beat the panel's own `radius.md`, which is 12. The
            buttons' full height would also clear it, but it would take 152 points
            off the height of every column of every board — measured at 430 x 932,
            a column goes from 756 to 604 and at 430 x 420 from 244 to 92 — and a
            column 92 points tall is a column with one card and a half in it. 24
            is the margin the `+` is drawn with, it is the smallest number here that
            is bigger than the radius, and it is the one the button already owns.
            **Not measured on a device**: no simulator or phone is attached to this
            machine, and a phone's own bottom inset is not something the browser can
            show.
          */
          marginBottom: FLOATING_BUTTON_MARGIN,
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
        {/*
          The name opens the order, **and it is the name that does it and not an
          icon beside it.** The task list opens its reorder sheet from its own
          header, and a column's name is that header here: the widest target in
          the row, saying what would be ordered. Without `onOpenOrder` — a viewer
          — it is plain text, because a pressable that opened nothing would be a
          control wearing the shape of a sentence.
        */}
        {onOpenOrder ? (
          <Pressable
            testID={`board-column-order-${state.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${state.title}, ${t("board.editOrder")}`}
            onPress={() => onOpenOrder(state.id)}
            style={styles.nombreBoton}
          >
            <AppText variant="callout" style={styles.nombre} numberOfLines={1}>
              {state.title}
            </AppText>
          </Pressable>
        ) : (
          <AppText variant="callout" style={styles.nombre} numberOfLines={1}>
            {state.title}
          </AppText>
        )}
        {/* The number and not the phrase. The whole header has to fit in a
            230-point column, and "4 elementos" beside "Waiting for review" leaves
            the name two thirds of the column; the phrase is what the header is
            *read* as, above, and a screen reader is the one that needs the words. */}
        <AppText variant="caption" tone="muted" testID={`board-count-${state.id}`}>
          {tasks.length}
        </AppText>
        {/*
          The menu of the column, **after the count and not before the name.**
          The name is what opens the order — it is the widest target in the
          header — and the `···` is the narrow one beside it for everything else,
          which is the same arrangement as the board's own header: the title says
          where you are and the dots say what you can do there.
        */}
        {onOpenMenu ? (
          <Button
            testID={`board-column-menu-${state.id}`}
            label={t("board.columnMenu")}
            variant="ghost"
            size="sm"
            icon="ellipsis-horizontal"
            iconOnly
            accessibilityHint={t("board.columnMenuHint")}
            fullWidth={false}
            onPress={() => onOpenMenu(state.id)}
          />
        ) : null}
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
              The room for the board's floating buttons, **and the buttons' own
              number.**

              Without it the last card of a column that happens to be the one under
              the corner button has half of itself behind it: the buttons are drawn
              over the content and the column ends where the window ends, so the
              card cannot be scrolled clear of anything. The column asks
              `floating-button.tsx` rather than writing a number, because a `82` here
              would be the second copy of a decision that file already made — and the
              copy would be *wrong* the moment a second button appeared above the
              `+`, which is what a board now has.

              **It is `FLOATING_BUTTON_STACK_INSET` and not `FLOATING_BUTTON_INSET`,
              and that is the whole of what the second button costs.** The stack is
              the `+`'s room plus a gap plus a second button's size, and the filter
              is the one that covers the cards *higher up* than the `+` does: a
              column that reserved room for the `+` alone finished its scroll with
              its last card sitting under the funnel. Measured on the board with 16
              cards in one column at 430 x 932, **152** — see the constant for the
              numbers and for what was not measured.

              It is not `Screen`'s `bottomInset`, and that is not an oversight:
              `screen.tsx` drops `bottomInset` when `edgeToEdge` is set, because the
              two are the same job in different places — and a board whose columns
              fill the window needs `edgeToEdge` or there is a band of background
              under them. So the room is reserved inside the column that scrolls,
              which is where it is needed and where a column narrower than the
              button still gets it.
            */
            paddingBottom: FLOATING_BUTTON_STACK_INSET,
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
          tasks.map((item) => (
            <Tarjeta
              key={item.id}
              item={item}
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
 * One card of a column: the row of the task, and nothing else.
 *
 * **It used to lift on a long press and travel to reorder**, with four shared
 * values, a gesture, a lift animation and a click listener swallowing the tap
 * that ended a drag. That gesture is gone — ordering lives in the order sheet
 * behind the header's name and `···` — and what is left is a box with the row
 * in it. It stays a component and not markup in the map because that is where
 * it has always lived, and the map stays readable.
 */
function Tarjeta({
  item,
  state,
  tagColors,
  onOpenTask,
  onOpenIcon,
}: {
  item: ListItem;
  state: BoardState;
  tagColors: TagColors;
  onOpenTask: (item: ListItem) => void;
  onOpenIcon: (item: ListItem) => void;
}) {
  const theme = useTheme();
  return (
    <View
      testID={`board-card-${item.id}`}
      style={[
        styles.tarjeta,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <TaskRow
        item={item}
        tagColors={tagColors}
        onEdit={() => onOpenTask(item)}
        onIcon={() => onOpenIcon(item)}
        edgeColor={iconColor(state.color)}
      />
    </View>
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
    /*
      **And it clips, because a rounded corner is only a rounded corner while
      nothing is painted over it.**
      Without `overflow: hidden` the radius on this panel rounds the *background*
      and the cards underneath go on past it in squares: a column whose last card
      was not scrolled clear of the bottom would have a square card in the corner
      the radius was supposed to describe. `overflow: hidden` reads on both
      targets — react-native-web writes it as `overflow: hidden` and React Native
      clips there too — so it is one rule and not a web one with a native guess
      beside it, the same argument `styles.recorte` on the board screen makes for
      the box that clips the track.
    */
    overflow: "hidden",
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
  /*
    The pressable around the name, **and it is the flex that the text had.**
    Wrapping the name must not change what the row measures: the flex and the
    shrink live on this pressable now, and the text inside keeps its style, so a
    long name still gives way to the count and the menu the same points as before.
  */
  nombreBoton: {
    flex: 1,
    minWidth: 0,
  },
  /**
   * The box of cards, and **it is capped at the height it is given rather than at
   * the height of what is in it.**
   *
   * `flex: 1` is the cap: measured in the browser it computes to `flex: 1 1 0%` with
   * `min-height: 0` on a column of sixteen cards, which is a box of **698** points
   * with **1114** of content inside it — the content scrolls and the box does not
   * grow. The `min-height: 0` is the half that is easy to leave out, and it is the
   * half that is load-bearing: a flex item whose `min-height` is `auto` refuses to
   * shrink below its content, which is how a column of cards comes to be taller than
   * the track and takes the panel's rounded bottom corners off the screen with it.
   * react-native-web writes that zero on its own and React Native's Yoga does not
   * owe it to anybody, so it is written here rather than trusted.
   *
   * `overflow: "hidden"` is on the panel above and not here, and the two are one
   * thing: this box is the thing that scrolls, and a scroller that is taller than
   * its box draws its content over whatever is around it.
   */
  cajas: {
    flex: 1,
    minHeight: 0,
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
    borderWidth: StyleSheet.hairlineWidth,
    // The row draws its own edge colour on the left with a border, and a rounded
    // box that does not clip turns that into a stripe with square corners
    // sticking out of the radius.
    overflow: "hidden",
  },
});
