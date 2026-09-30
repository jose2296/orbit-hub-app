import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type ViewStyle } from "react-native";

import { cuartosDeProgreso } from "@/components/media/ring-geometry";
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
 * the score in the middle. The old one drew it with SVG; this draws it with four
 * clipped `View`s that rotate, because `react-native-svg` is not a dependency of
 * this app and adding a native module for one ring is not something to do without
 * a device to try it on. The angles come from `ring-geometry.ts` and have tests,
 * because the arithmetic is the whole difficulty here and a picture cannot show a
 * ring that is ten degrees out.
 *
 * **It fills when it appears, over most of a second.** A number that is simply
 * there when the screen opens is a label; one that arrives is the same
 * information with a direction, and the eye follows it round to the figure in the
 * middle.
 *
 * **The number is never rescaled to a hundred to fill a shape.** A book rated
 * three out of five shown as "60%" is a book nobody liked wearing a nicer hat.
 * What is shown is the number the provider gave on the scale the provider uses,
 * with the scale under it; the ring fills to `score / outOf` and the digits are
 * not changed by that.
 */
export function Rating({ score, outOf, size = 72 }: RatingProps) {
  const theme = useTheme();

  const ratio = Math.max(0, Math.min(1, outOf === 0 ? 0 : score / outOf));
  const color = colorFor(ratio, theme.colors);
  const cuartos = cuartosDeProgreso(ratio);

  const progreso = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    /*
      From zero every time, and not from wherever it was left.

      This screen is opened again and again on the same title, and a ring that
      starts where it was left means the animation happens the first time and
      never again. Starting at zero makes the arrival part of the screen every
      time.
    */
    progreso.setValue(0);
    const animacion = Animated.timing(progreso, {
      toValue: 1,
      duration: DURACION,
      easing: Easing.out(Easing.cubic),
      // The only thing that moves is a rotation, and that can go off the JS
      // thread; the colour is read from the score and not from the animation, so
      // it does not need to.
      useNativeDriver: true,
    });
    animacion.start();
    return () => animacion.stop();
  }, [ratio, progreso]);

  const radio = size / 2;
  const anillo: ViewStyle = {
    width: size,
    height: size,
    borderRadius: radio,
    borderWidth: GROSOR,
  };

  /*
    The four quarters, clockwise from the top.

    Each is a box the size of a quadrant with `overflow: hidden` — which is what
    turns a whole ring into a piece of one — holding the full ring pulled back so
    that the quadrant it clips is the one that piece belongs to, and turned by the
    angle the geometry says. The two coloured borders are the ones that meet at
    the end of the quarter: top and right for the first, then right and bottom,
    bottom and left, left and top.
  */
  const cuadrantes = [
    { izquierda: size / 2, arriba: 0, desplazX: -size / 2, desplazY: 0, bordes: ["borderTopColor", "borderRightColor"] },
    { izquierda: size / 2, arriba: size / 2, desplazX: -size / 2, desplazY: -size / 2, bordes: ["borderRightColor", "borderBottomColor"] },
    { izquierda: 0, arriba: size / 2, desplazX: 0, desplazY: -size / 2, bordes: ["borderBottomColor", "borderLeftColor"] },
    { izquierda: 0, arriba: 0, desplazX: 0, desplazY: 0, bordes: ["borderLeftColor", "borderTopColor"] },
  ] as const;

  return (
    <View
      style={[styles.caja, { width: size, height: size }]}
      accessibilityRole="text"
      accessibilityLabel={`${score} de ${outOf}`}
      testID="rating-ring"
    >
      {/* The track: the same ring in the muted colour, under everything. */}
      <View style={[anillo, { borderColor: theme.colors.surfaceMuted }]} />

      {cuartos.map((giro, i) => {
        const q = cuadrantes[i];
        if (!giro || !q || !giro.visible) return null;
        const colores = { borderColor: "transparent" } as ViewStyle;
        for (const borde of q.bordes) {
          (colores as Record<string, string>)[borde] = color;
        }
        return (
          <View
            key={i}
            pointerEvents="none"
            style={[
              styles.cuadrante,
              { width: size / 2, height: size / 2, left: q.izquierda, top: q.arriba, overflow: "hidden" },
            ]}
          >
            <Animated.View
              style={[
                styles.anilloInterior,
                anillo,
                colores,
                {
                  transform: [
                    { translateX: q.desplazX },
                    { translateY: q.desplazY },
                    {
                      rotate: progreso.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, giro.giro],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
        );
      })}

      <View style={styles.centro} pointerEvents="none">
        <AppText variant="heading" style={{ color: theme.colors.text, fontSize: size * 0.26 }}>
          {score.toFixed(1)}
        </AppText>
        <AppText variant="caption" tone="subtle" style={{ fontSize: size * 0.15 }}>
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
  cuadrante: {
    position: "absolute",
  },
  anilloInterior: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  centro: {
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
