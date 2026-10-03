import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";

import type { BoardStates } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { iconColor } from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";

export interface BoardTabsProps {
  /** The columns, **in the order of the array**, which is the order they are drawn. */
  states: BoardStates;
  /**
   * How many tasks each column has, by state id.
   *
   * A `Map` and not an array because the question is "how many in *this* one" and
   * it is asked once per column per render: an array would be a linear search per
   * answer. `countInState` builds it, and the counts come from it rather than
   * from `tasksInState(...).length` because counting does not sort.
   */
  counts: Map<string, number>;
  /**
   * The column the board is anchored on, or `null` when there are none.
   *
   * `null` rather than the first state id on purpose: `states[0]?.id ?? null` is
   * what a caller with nothing to show has, and a tab strip that highlights a
   * column that is not there is worse than one that highlights nothing.
   */
  currentId: string | null;
  /** Which column the board should be anchored on. */
  onSelect: (id: string) => void;
}

/**
 * The strip of columns along the top of a board: one pill per state, with its
 * colour dot and its count.
 *
 * **It stays in both widths, and that is the decision that is easy to get wrong.**
 * On a narrow screen it is the only way to know which states exist and how many
 * tasks are in each. On a wide one, where four columns are visible at once in the
 * widest track measured —1120 points, which is a 1440-point window with the drawer
 * open, and a fifth would need about 1200— it looks redundant, and it is not: the
 * board shows as many columns as fit, so **the fifth state of a board with eight is
 * not on screen**, and the strip is what makes it reachable in one tap instead of by
 * scrolling the track to find it. A strip that only appeared on narrow screens would
 * be the one place where "there is more to the right" is impossible to act on.
 *
 * **The active pill is filled with the theme's text colour, not with the state's.**
 * The state colour is a mid-tone from the icon palette (`ICON_COLORS` in
 * `lib/lists/item-icons.ts`), and a caption written in one of them on a pill of
 * that same colour is a contrast decision that only three of the twelve can pass
 * in either theme — the same measurement `lib/lists/tag-colors.ts` records for
 * labels, with the same rule: the colour is used where it can be read and the
 * theme's text is used everywhere else. Here the fill is the theme's text on
 * purpose, because that pair is the one the two themes were drawn to guarantee:
 * **the twelve colours never have to pass anything**, and the state is still said
 * by the dot beside the name.
 *
 * **It scrolls the current pill into the middle, and only when it does not fit.**
 * `onContentSizeChange` is what answers "is there anything off screen": with four
 * columns on a wide board the whole strip is narrower than the window, and
 * centring a pill that is already visible would slide the strip under a tap for
 * no reason. When there *is* more, the pill is centred so the name and the count
 * are both readable rather than half off the edge.
 */
export function BoardTabs({
  states,
  counts,
  currentId,
  onSelect,
}: BoardTabsProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tira = useRef<ScrollView>(null);

  /**
   * Where each pill is and how wide it is, measured rather than assumed: pill
   * widths come from the length of the state name, which the app does not
   * control, so "the third one is at 180" is a guess that is wrong for every
   * board with different names.
   */
  const [cajas, setCajas] = useState<Record<string, { x: number; width: number }>>({});
  const [anchoTira, setAnchoTira] = useState(0);
  const [anchoContenido, setAnchoContenido] = useState(0);
  /**
   * How far the strip is scrolled, **in a ref and not in a state**: this changes
   * on every frame of a drag, and putting it in a state would re-render twenty-four
   * pills on each of them. The effect that reads it runs when the anchored column
   * changes, and the value it wants is the offset the strip is sitting at right
   * now.
   */
  const desplazamiento = useRef(0);

  const actual = currentId ? cajas[currentId] : undefined;

  useEffect(() => {
    // Nothing to centre: the strip has not been measured, or there is nothing off
    // screen, or the board has no columns to point at.
    if (!actual || anchoTira <= 0) return;

    if (anchoContenido <= anchoTira) {
      /*
        Everything fits, **so the strip goes back to the beginning.**
        Without this the offset of a strip that was scrolled when it did not fit
        survives the resize that made it fit: measured at 1120 points after being
        scrolled at 400, the four pills sat 31 points to the right of the left edge
        of the track, out of line with the column they name. Not a `scrollTo`
        without an animation — it is a correction, and a corrected position does
        not travel.
      */
      if (desplazamiento.current !== 0) {
        desplazamiento.current = 0;
        tira.current?.scrollTo({ x: 0, animated: false });
      }
      return;
    }

    const izquierda = actual.x;
    const derecha = actual.x + actual.width;
    const visibleIzquierda = desplazamiento.current;
    const visibleDerecha = visibleIzquierda + anchoTira;
    if (izquierda >= visibleIzquierda && derecha <= visibleDerecha) return;

    const x = Math.max(
      0,
      Math.round(izquierda - (anchoTira - actual.width) / 2),
    );
    tira.current?.scrollTo({ x, animated: true });
  }, [actual, anchoTira, anchoContenido]);

  return (
    <ScrollView
      ref={tira}
      testID="board-tabs"
      style={styles.tira}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(event: LayoutChangeEvent) =>
        setAnchoTira(event.nativeEvent.layout.width)
      }
      // Two numbers and not an event: `onContentSizeChange` has always been called
      // with the width and the height of the content, on native and on
      // react-native-web alike (`ScrollView/index.js` in the latter), and the
      // `contentSize` of an event is the other spelling of the same thing.
      onContentSizeChange={(width: number) => setAnchoContenido(width)}
      onScroll={(event) => {
        desplazamiento.current = event.nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={32}
      contentContainerStyle={[styles.contenido, { gap: theme.spacing.xs }]}
    >
      {states.map((state) => {
        const count = counts.get(state.id) ?? 0;
        const activa = state.id === currentId;
        const color = iconColor(state.color);

        return (
          <Pressable
            key={state.id}
            testID={`board-tab-${state.id}`}
            onLayout={(event: LayoutChangeEvent) => {
              const { x, width } = event.nativeEvent.layout;
              setCajas((previas) =>
                previas[state.id]?.x === x && previas[state.id]?.width === width
                  ? previas
                  : { ...previas, [state.id]: { x, width } },
              );
            }}
            onPress={() => onSelect(state.id)}
            accessibilityRole="tab"
            /*
              Which one is chosen, **in both the spellings the two platforms read.**

              Measured in the browser: with only `accessibilityState={{ selected }}`
              the four tabs of the strip carry `role="tab"` and **no `aria-selected`
              at all** —not on the chosen one either. `react-native-web@0.21.2`
              builds its ARIA out of the `aria-*` props and ignores the state object
              for this one (`createDOMProps`, which reads `aria-selected` and calls
              `accessibilitySelected` deprecated), while on native the state object
              is what VoiceOver and TalkBack read. `Segmented` had to write its
              `aria-checked` by hand for the same reason.
            */
            aria-selected={activa}
            accessibilityState={{ selected: activa }}
            // The number is spoken with its word and not as a bare digit, which is
            // what a screen reader would otherwise read. `lists.itemCount` is the
            // same phrase the row of a list uses, so it is one thing to hear.
            accessibilityLabel={`${state.title}, ${t(pluralKey("lists.itemCount", count), {
              count,
            })}`}
            style={({ pressed }) => [
              styles.pastilla,
              {
                gap: theme.spacing.sm,
                paddingVertical: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                // The two halves of one pair, and both written here so that they
                // are read together: the chosen pill is filled with the theme's text
                // colour and its label is the theme's background, which is the pair
                // the two themes were drawn to guarantee.
                backgroundColor: activa
                  ? theme.colors.text
                  : theme.colors.surfaceMuted,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            {/* The colour of the state, as a dot and not as the name's colour: it is
                the one thing on the pill that can carry a mid-tone without anybody
                having to read a word in it. */}
            <View
              style={[styles.punto, { backgroundColor: color, borderRadius: theme.radius.pill }]}
            />
            <AppText
              variant="callout"
              numberOfLines={1}
              /*
                The chosen pill's label is the theme's **background**, written as a
                style and not as a tone: the fill of that pill *is* the theme's text
                colour, so `tone="default"` —which is `colors.text`— would be text
                on text. The pair that the two themes were drawn to guarantee is
                text on background, and it is not one of `AppText`'s tones, so it is
                spelled out here. `style` goes last in `AppText`'s array, which is
                what lets it win over the tone beside it.
              */
              style={
                activa
                  ? { color: theme.colors.background, fontWeight: "600" }
                  : undefined
              }
              tone={activa ? "default" : "muted"}
            >
              {state.title}
            </AppText>
            <AppText
              variant="caption"
              style={activa ? { color: theme.colors.background } : undefined}
              tone={activa ? "default" : "subtle"}
            >
              {count}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /**
   * The strip is **as tall as its pills and no taller.**
   *
   * It has to be said because the default is the opposite of it: React Native Web
   * writes `flexGrow: 1` on every scroll view it makes (`commonStyle` in
   * `react-native-web/dist/exports/ScrollView/index.js`), so a horizontal strip in a
   * column that also holds the track grows into what is left and the two share it.
   * Measured in the browser at 1440 points: the strip took 424 of the 828 points of
   * height and the columns got the other 388, with four tabs drawn in a band as tall
   * as the cards.
   *
   * React Native itself gives a scroll view no grow, so this is the same value on
   * both targets and only the web needed it written down.
   */
  tira: {
    flexGrow: 0,
    flexShrink: 0,
  },
  /**
   * The strip's own box, and **no padding of its own on purpose**: the strip lives
   * inside the same padded box as the track of columns, so the first pill and the
   * first column already start at the same distance from the edge of the window.
   * Padding here would push the strip's names out of line with the columns they
   * are jumping to, which is the one thing two strips that sit on top of each
   * other must not do.
   */
  contenido: {
    alignItems: "center",
  },
  pastilla: {
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * The dot of the state colour.
   *
   * Ten points, and it is the only size in this file that is written by hand: it
   * is a shape and not a gap, and the theme has no token for "how big is a dot",
   * so the alternative would be a spacing token chosen to mean something it does
   * not. It matches the size of the dot in a column header, which is the same
   * element seen twice.
   */
  punto: {
    width: 10,
    height: 10,
  },
});
