import { ScrollView, StyleSheet, View } from "react-native";

import type { BoardState, ListItem, TagColors } from "@orbit-hub/contracts";

import { EmptyState } from "@/components/ui/empty-state";
import { AppText } from "@/components/ui/text";
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
   * This list's chosen label colours, handed down from the screen's `list`.
   *
   * The same prop `TaskRow` takes and for the same reason: a label's colour is
   * chosen per list, so a row cannot go and find it for itself.
   */
  tagColors: TagColors;
  /**
   * Whether this board can be written to at all.
   *
   * **It is in the interface this screen fixed and nothing reads it yet.** The
   * gesture of Task 9 and the two sheets of Tasks 10 and 14 are what read it, and
   * the screen is already using it to decide whether to mount the sheet. A prop
   * that faked an effect here —greyed cards, cards that ignore the tap— would be
   * a lie in the code that somebody would have to find and undo, and the honest
   * version of "not wired yet" is a comment that says so.
   */
  readOnly: boolean;
  /** Opens the task. */
  onOpenTask: (item: ListItem) => void;
  /** Opens the pictures of the task, which are their own target and not the row. */
  onOpenIcon: (item: ListItem) => void;
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
  tagColors,
  onOpenTask,
  onOpenIcon,
}: BoardColumnProps) {
  const theme = useTheme();
  const t = useTranslation();

  /** The header read as one thing, with the count said and not printed. */
  const encabezado = t(pluralKey("lists.itemCount", tasks.length), {
    count: tasks.length,
  });

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
        accessibilityLabel={`${state.title}, ${encabezado}`}
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
        {/* The number and not the phrase.** The whole header has to fit in a
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
          { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
        ]}
      >
        {tasks.length === 0 ? (
          /*
            In the middle of the column and not at the top of it, which is what
            `flex: 1` on an empty state buys: an empty column that says "no tasks"
            in its first line reads as a list that has been cut off, and the same
            sentence in the middle of the box reads as the state it is.
          */
          <EmptyState title={t("board.emptyColumn")} compact style={styles.centrado} />
        ) : (
          tasks.map((item) => (
            <View
              key={item.id}
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
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The column, and **it has no width of its own.**
   *
   * The width is measured by the screen —one column, or as many as fit— and it
   * arrives on a wrapper around this component, because inside the content box of
   * a horizontal scroll view a child with no width takes **the width of its
   * content**: neither React Native nor `react-native-web` gives a view a
   * `flexBasis`, and both default to `flexShrink: 0`.
   *
   * **`flexGrow: 1` and not `flex: 1`, and the height is what it is for.** A
   * `flex: 1` here would put `flex-basis: 0` on the main axis of whatever holds the
   * column, and that is a **column** —the wrapper the screen wraps it in— so the
   * basis would be its height. What fills a height is a grow with the basis left
   * alone. It is the same on both targets: on native the wrapper is stretched
   * across the height of the track and this fills it; on the web there is one more
   * box between the two, because `pagingEnabled` marks each child of the track as a
   * snap point, and it is a column too.
   *
   * Without it, every column is as tall as its own cards —measured at 122 points
   * inside a track of 776— and the board is four short bars at the top of the
   * screen instead of four columns of it.
   */
  columna: {
    flexDirection: "column",
    flexGrow: 1,
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