import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import type { BoardStates } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { iconColor } from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";

/**
 * How much of the strip's own width the pills travel for a whole column of drag.
 *
 * **A fraction and not a number of points**, and the reason is that the track and
 * the strip are two different widths: at a 400-point window the track moves a
 * column of 380 and the strip is 368 wide, so a fixed displacement would be a
 * slightly different parallax on a phone than on a tablet, and the only width
 * that makes it agree everywhere is the width of the strip itself.
 *
 * A third of it is what makes the parallax noticeable without it reading as
 * movement: the pills lag about 35 points behind the columns for every 100 the
 * finger travels, which is enough to feel like there are two layers and not enough
 * to look like the names are sliding away.
 */
const PARALAJE_TIRA = 0.35;

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
  /**
   * How far along the board the finger is, **zero at rest and signed**, and it is
   * what the pills travel by while the columns travel further.
   *
   * **A shared value and not a `number`, and that is a cost and not a style.** This
   * changes on every frame of a drag, so a `number` in React state would re-render
   * the whole strip — **twenty-four pills at the contract's cap** — sixty times a
   * second, on top of the re-render of the screen that would have carried the
   * number. The scroll offset a few lines down is kept in a ref for the same
   * reason and says so in as many words; a shared value is that, plus being
   * readable inside an animated style with no render at all.
   */
  progress: SharedValue<number>;
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
 *
 * **And it moves less than the board while a finger is on the board**, which is
 * the whole of the parallax and the reason for the `progress` prop: the idea is
 * the one in `components/ui/media-carousel.tsx`, where a row of titles gathers
 * towards the middle of the window and you can see what is coming before you get
 * to it. Here the pills travel 35 per cent of what the columns travel, so the name
 * of the column on the other side of the edge arrives before the column does.
 */
export function BoardTabs({
  states,
  counts,
  currentId,
  progress,
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
   * The displacement of the pills, **and it is read from a shared value and not
   * from a number**, so a drag moves the strip without rendering any of it.
   *
   * The width it multiplies is `anchoTira`, the state above and not a second
   * measurement: it is already there for the centring effect, it changes once, and
   * a value shared for the same number would be a number with two owners. And it is
   * declared **above** this style rather than beside it because `useAnimatedStyle`
   * runs its worklet during the render and a `const` read before its declaration is
   * a `ReferenceError` on the first paint — which is the same class of bug as the
   * one the typecheck cannot see for the same reason.
   */
  const estilo = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * anchoTira * PARALAJE_TIRA },
    ],
  }));
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
      contentContainerStyle={styles.contenido}
    >
      {/*
        The row of pills, **in an `Animated.View` of their own, and that is where
        the parallax is.**

        It cannot be the `contentContainerStyle`: Reanimated animates the `style`
        prop of a component and reads `props.style` when it attaches one, so an
        animated style handed to `contentContainerStyle` is quietly ignored — the
        strip would sit still and the parallax would be a number in a prop that
        nothing draws. And it cannot be the strip's own `style` either: a
        transform on the scroll view takes its **box** sideways, which leaves 129
        points of empty strip on the right while a drag is in flight — measured at a
        400-point window, where the strip is 368 wide and a whole column of travel
        moves the pills 129 — and draws the first pill out over the padding the
        screen gave the board.

        So the pills get a box inside the strip, which moves with them and is cut
        by the strip at both ends. The gap moved in with them, which is what keeps
        the pills the same distance apart while they travel, and the strip's own
        scroll — the one that centres the chosen pill — is untouched: `cajas` still
        measures positions inside this box, and the box starts where the content
        container starts.
      */}
      <Animated.View
        style={[styles.pastillas, { gap: theme.spacing.xs }, estilo]}
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
                  previas[state.id]?.x === x &&
                  previas[state.id]?.width === width
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
      </Animated.View>
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
  /**
   * The row of pills inside the strip, **and `flexDirection: 'row'` written down
   * rather than inherited.**
   *
   * The content container of a horizontal scroll view is a row, so the wrapper
   * would lay its pills out side by side even without this. It is written anyway
   * because the wrapper is the box the parallax moves, and a row that became a
   * column the day somebody reordered two styles would put the four states under
   * each other — taller than the strip, cut off by it, and with nothing failing.
   */
  pastillas: {
    flexDirection: "row",
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
