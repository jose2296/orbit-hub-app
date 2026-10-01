import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/theme";

/**
 * The size of the corner that is kept, and the ribbon inside it.
 *
 * **A straight band cannot both touch the corner and reach the two edges that
 * meet there.** A band that covers the corner is cut by the corner, and what is
 * left of it is a triangle whose legs are as long as the band is thick. So the
 * triangle is the design and the numbers are the whole of it:
 *
 * - the band is `GRUESO` thick, so the legs are `GRUESO × √2`;
 * - its middle line is translated to `CENTRO` on each axis, which puts the outer
 *   edge at about seventy and leaves the eye room inside. Left at the origin the
 *   band floats in the middle of the poster as a stripe instead of a corner;
 * - it is `LARGO` so that both of its ends are outside the square and the shape is
 *   the diagonal and not the ends.
 *
 * Fifty thick and a middle line at seventeen and a half gives legs of about
 * seventy, which is what the eye needs: a sixteen point glyph at fifteen from the
 * corner has its far corner at (23, 23) and the colour's edge is at seventy, so it
 * sits inside with room to spare. At forty-six thick, measured in a browser, the
 * eye hung half over the edge onto the poster.
 */
const LADO = 80;
const LARGO = 140;
const GRUESO = 50;

/** Where the band's middle line crosses the corner's diagonal, on each axis. */
const CENTRO = 17.5;

/** Where the eye goes, and why: inside the diagonal and near the corner. */
const OJO = 15;

export interface SeenRibbonProps {
  /**
   * Whether it has been seen. **Both states draw something**, and that is the
   * point: the ribbon is a corner, and a corner that is sometimes there and
   * sometimes not is a corner the eye has to check for.
   */
  completed: boolean;
  /**
   * Whether this title is a row of the list being looked at.
   *
   * `undefined` means "the caller only draws this for its own list", which is what
   * the carousel does: every poster on that screen is a row of that list, so
   * asking again would be asking about the screen. A card of related titles and a
   * row of search results both have titles that are *not* in the list, and for
   * those there is no state to draw.
   */
  inList?: boolean;
  /** What a screen reader should hear, and it is a sentence and not a word. */
  label: string;
  /**
   * How big the corner is, in points.
   *
   * **The geometry is one set of numbers and it is scaled, not redrawn.** Every
   * number above is a fraction of `LADO`, so a ribbon on a 52-point card is the
   * same triangle as the one on an 80-point poster — and a ribbon sized for a
   * poster on a 52-point card is not a smaller ribbon, it is a triangle that has
   * eaten two thirds of the card.
   */
  size?: number;
  /**
   * How long to wait before it appears, in milliseconds.
   *
   * The ribbon arrives after the card, and without this they arrive together and
   * the corner is simply *there* — the eye never travels anywhere, so the eye does
   * not read as something that was put there on purpose. Two hundred milliseconds
   * is long enough to be a movement and short enough to be part of the same
   * action.
   */
  delay?: number;
  testID?: string;
}

/**
 * Whether this title is in the list and, if it is, **whether it has been seen** —
 * as a ribbon folded into the corner.
 *
 * It is one component and not a drawing per screen because the corner is the one
 * place in the app where the same fact has to be said in the same way: on the
 * carousel, on a related title, on a collection and on a search result, a title in
 * your list looks the same or it does not look the same. Four copies of a triangle
 * is four chances to have one of them at forty-six instead of fifty.
 *
 * **The two states are two different things and not one thing dimmed.** Seen is
 * the success colour and a shut eye; not seen is a muted corner and an open one.
 * That is the honest shape for the other half of the list too: a film you added
 * and have not watched is a real state, and a list of thirty pending posters with
 * nothing in the corner is a list where the corner means "watched" and the absence
 * of it means nothing at all.
 *
 * The colour is muted and not transparent for the pending one, because a
 * translucent corner over a pale poster is a corner you cannot see, and a badge
 * that only shows on half the pictures is worse than none.
 *
 * **Nothing is drawn for a title that is not in the list.** The app has no row for
 * it, so it has nothing to say about it: "not seen" is only true of something you
 * meant to watch. The caller decides that by not rendering this.
 */
export function SeenRibbon({
  completed,
  inList,
  label,
  size = LADO,
  delay = 200,
  testID,
}: SeenRibbonProps) {
  const theme = useTheme();

  const presente = inList !== false;

  /** Every length above, as a fraction of the corner, applied to this corner. */
  const k = size / LADO;

  const entrada = useSharedValue(0);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    if (!presente) {
      setMontado(false);
      return;
    }
    entrada.value = 0;
    setMontado(true);
    /*
      It grows **in place**, and it does not travel.

      It came in from above with a small offset, and the offset was applied to the
      zone that clips the ribbon — so for a third of a second the corner was drawn
      over whatever is above the poster, which is the one thing a corner marker must
      never be. Growing inside a fixed corner cannot leave the picture: the clip is
      the same square the whole time and the triangle simply fills more of it.
    */
    const id = setTimeout(() => {
      entrada.value = withTiming(1, { duration: 340, easing: Easing.out(Easing.back(1.1)) });
    }, delay);
    return () => clearTimeout(id);
  }, [completed, delay, entrada, presente]);

  const estilo = useAnimatedStyle(() => ({
    opacity: entrada.value,
    transform: [{ scale: 0.55 + entrada.value * 0.45 }],
  }));

  /*
    The six degrees, **on the drawing and not on the corner.**

    A ribbon that straightens as it grows reads as a corner being folded into
    place rather than a triangle getting bigger, and six is the number where the
    two are told apart without being watched: less and the marker only appears,
    more and it visibly swivels.

    **And it is inside the clip, on purpose.** Turning the clipping square itself
    would turn the clip — a rotated square does not cover the corners of the
    upright one it replaced, and the first thing that came out was a corner of the
    band sitting on the poster for a third of a second, which is the one thing this
    component exists to never do. So the square stays upright and still, and what
    turns is the two things drawn inside it.
  */
  const giro = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(1 - entrada.value) * -6}deg` }],
  }));

  if (!presente || !montado) return null;

  return (
    <Animated.View
      style={[styles.zona, { width: size, height: size }, estilo]}
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
    >
      <Animated.View
        style={[
          styles.contenido,
          { width: size, height: size },
          giro,
        ]}
      >
        <View
          style={[
            styles.banda,
            {
              // The seen one is the accent of the app's own success; the pending one
              // is the muted text colour, which is a mid grey in both themes and so
              // reads on a pale poster and on a dark one.
              backgroundColor: completed ? theme.colors.success : theme.colors.textMuted,
              width: LARGO * k,
              height: GRUESO * k,
              transform: [
                { translateX: (CENTRO - LARGO / 2) * k },
                { translateY: (CENTRO - GRUESO / 2) * k },
                { rotate: "-45deg" },
              ],
            },
          ]}
        />
        <View style={[styles.ojo, { top: OJO * k, left: OJO * k }]}>
          <Ionicons
            name={completed ? "eye-off" : "eye"}
            size={16 * k}
            color={completed ? theme.colors.onAccent : theme.colors.background}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * The square that is kept. **`overflow: hidden` is the ribbon**: without it the
   * band is a long diagonal stripe lying across the poster, and with it the band
   * is a corner. It is also what stops the entrance from drawing over the picture
   * or over whatever is above it.
   */
  zona: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
  },
  /*
    What turns, and **it has the size of the corner so the absolute children inside
    still have a box to be placed against.**
  */
  contenido: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  banda: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  ojo: {
    position: "absolute",
  },
});
