import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type ViewStyle } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTheme } from "@/theme";

export interface RatingProps {
  /** The number the provider gave, on the scale it chose. */
  score: number;
  /** Which scale, because a book rated 3 out of 5 is not 3 out of 10. */
  outOf: number;
  /** How big the whole thing is, in points. */
  size?: number;
}

/** How thick the line of the ring is. */
const GROSOR = 7;

/** How long it takes to fill. The old app used a second. */
const DURACION = 850;

/**
 * The score as a ring that fills up, with the number in the middle.
 *
 * **It is the old app's ring**: a circle that fills in green, amber or red with
 * the score in the middle, and it fills when it appears.
 *
 * **How it is drawn, and why it is two halves that sweep and not a shape that
 * turns.** The first attempt clipped the ring into four quadrants and turned each
 * one, and it came out as four disconnected arcs with the number hanging outside:
 * a ring is **rotationally symmetric**, so turning it inside a window that does
 * not move shows exactly the same ring. You cannot reveal part of a circle by
 * rotating the circle.
 *
 * What does work is turning the **window**. Two half-annuli, each a window of half
 * the box with the ring's own colour inside it, sweep round on top of the ring and
 * wipe it; the part neither has reached is the arc that is showing. Each window has
 * a hole in the middle, which is why the number is never covered — and that is the
 * only reason this is not just two half-discs.
 *
 * No drawing library: `react-native-svg` is what the old app used and it is not a
 * dependency here, and adding a native module for one ring is not something to do
 * without a device to try it on.
 *
 * **The number is never rescaled to a hundred to fill a shape.** A book rated
 * three out of five shown as "60%" is a book nobody liked wearing a nicer hat.
 * The ring fills to `score / outOf` and the digits are not changed by that.
 */
export function Rating({ score, outOf, size = 72 }: RatingProps) {
  const theme = useTheme();

  const ratio = Math.max(0, Math.min(1, outOf === 0 ? 0 : score / outOf));
  const color = colorFor(ratio, theme.colors);
  const giroFinal = 360 * ratio;

  const progreso = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    /*
      From zero every time, and not from wherever it was left.

      This screen is opened again and again on the same title, and a ring that
      starts where it was left means the animation happens the first time and
      never again.
    */
    progreso.setValue(0);
    const animacion = Animated.timing(progreso, {
      toValue: giroFinal,
      duration: DURACION,
      easing: Easing.out(Easing.cubic),
      // The only thing that moves is a rotation, and that can go off the JS thread.
      useNativeDriver: true,
    });
    animacion.start();
    return () => animacion.stop();
  }, [giroFinal, progreso]);

  const anillo: ViewStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: GROSOR,
  };

  return (
    <View
      style={[styles.caja, { width: size, height: size }]}
      accessibilityRole="text"
      accessibilityLabel={`${score} de ${outOf}`}
      testID="rating-ring"
    >
      {/* The track: the same ring, in the muted colour, under everything. */}
      <View style={[anillo, { borderColor: theme.colors.surfaceMuted }]} />

      {/* The fill, the whole ring, under the two windows that wipe it. */}
      <View style={[anillo, { borderColor: color }]} />

      {/*
        The two windows, and **they turn and the ring does not**.

        Each is the full box so its rotation is about the ring's centre, with a
        half-inside that clips it to one side. Both are the ring's own colour: they
        are paint, not a hole, so what they cover is gone and what they have not
        reached is the score. The second one starts a half turn away, which is what
        makes the two of them leave a wedge between them instead of covering the
        circle twice.
      */}
      <Animated.View pointerEvents="none" style={styles.girador}>
        <View style={[styles.ventana, { width: size / 2, height: size, left: 0 }]}>
          <View
            style={[anillo, { borderColor: theme.colors.background }]}
          />
        </View>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.girador,
          { transform: [{ rotate: progreso }, { rotate: "181.5deg" }] },
        ]}
      >
        <View style={[styles.ventana, { width: size / 2, height: size, right: 0 }]}>
          <View
            style={[anillo, { borderColor: theme.colors.background }]}
          />
        </View>
      </Animated.View>

      {/*
        And the score, on top of everything, in the middle the windows leave
        alone. It is not in the ring's own coordinates: it is centred in the box,
        which is the same point, and saying it that way is what makes it obvious
        that the two rotations cannot reach it.
      */}
      <View style={styles.centro} pointerEvents="none">
        <AppText variant="heading" style={{ color: theme.colors.text, fontSize: size * 0.26 }}>
          {score.toFixed(1)}
        </AppText>
        <AppText variant="caption" tone="subtle" style={{ fontSize: size * 0.14 }}>
          /{outOf}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    alignItems: "center",
    justifyContent: "center",
  },
  girador: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
  ventana: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
  },
  centro: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * Green, amber, red, **with the old app's thresholds and the app's own colours**.
 *
 * They were three hex written in this file, which made it the one place in the
 * app where a colour could not be changed by whoever owns the palette. The
 * thresholds stay because they are a judgement about a score and not a brand
 * decision.
 */
function colorFor(
  ratio: number,
  colors: { success: string; warning: string; danger: string },
): string {
  if (ratio >= 0.75) return colors.success;
  if (ratio >= 0.5) return colors.warning;
  return colors.danger;
}
