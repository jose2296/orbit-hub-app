import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

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

/**
 * The circle, **with the one prop that does not belong to it taken off**.
 *
 * `strokeDashoffset` is the only thing on this ring that changes, and a plain
 * `Circle` handed an `Animated` value does not read it: it takes the object,
 * writes it to the attribute and the arc is either full or gone. `Animated`
 * unwraps the value and re-renders the element each frame, so the number arrives
 * as a number.
 *
 * That same `Animated` also forces `collapsable={false}` on whatever it wraps, on
 * the way in, so that Android does not flatten the view it is animating. It is a
 * sensible instruction for a native view and meaningless for a `<circle>`: on the
 * web it reached the DOM and React said "Received `false` for a non-boolean
 * attribute `collapsable`" once per frame of the animation. So the prop is dropped
 * on the way through, in one place, instead of the whole thing being given up.
 */
function Circulo(props: ComponentProps<typeof Circle>) {
  const { collapsable: _collapsable, ...resto } = props as ComponentProps<typeof Circle> & {
    collapsable?: boolean;
  };
  return <Circle {...resto} />;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circulo);

/** How thick the line of the ring is. */
const GROSOR = 7;

/**
 * How long it takes to fill.
 *
 * It was 850 ms, and 850 is how long you wait for something that has already
 * finished. An arc that sweeps three quarters of a circle is over in a third of a
 * second by the time the eye has decided to look at it, and 620 ms is the point
 * where it still reads as a sweep rather than as a jump — the last fifth of the arc
 * arrives while the number is nearly there, so the two land together.
 */
const DURACION = 620;

/**
 * The number, **counted up while the arc draws**, and not sitting on its value.
 *
 * The arc has swept from zero since the first version: it starts at zero and times
 * to one, so it draws. What did not move was the number in the middle, which held
 * its final value for the whole of the sweep — so the screen showed a ring filling
 * up to an answer that had been there all along, and the two halves disagreed about
 * when the score arrives.
 *
 * **It counts on the same value the dash is drawn from**, so there is one animation
 * in two places and not two animations that happen to agree.
 *
 * And it is rounded here rather than interpolated as a string, because a string
 * interpolation is not a rounding function: interpolating between `"0.0"` and
 * `"8.3"` parses both, counts between the numbers and prints the result in full,
 * which measured on the web put `1.4345030613272471` in a ring seventy-two points
 * across — sixteen digits of it, for the six hundred milliseconds the count takes.
 * `toFixed(1)` is the whole of the difference between a number counting and a number
 * flickering.
 *
 * The state only changes when the rounded tenth changes, so the count re-renders
 * the text about as many times as it shows a different number, and not once per
 * frame.
 */

/**
 * The score as a **progress circle that fills and changes colour**, with the
 * number in the middle.
 *
 * **It is drawn with SVG, and that is the third time round.** The first was ten
 * marks in a circle, which reads as ten marks. The second was four quadrants of a
 * `View` turned inside a clip, which is wrong twice over: a ring is
 * **rotationally symmetric**, so turning it inside a window that does not move
 * shows exactly the same ring, and the result was four disconnected arcs with the
 * number outside. The third swept two half-windows across it, which drew the arc
 * but left a notch where the two met.
 *
 * Every one of those was an attempt to get a partial arc out of shapes that cannot
 * express one. `strokeDashoffset` expresses it exactly, which is why the old app
 * used it and why this does too.
 *
 * **`react-native-svg` is a new dependency and that is a real cost.** It is the
 * standard drawing library for Expo and it is what every ring in every app is made
 * of, and the alternative was a third hand-rolled approximation of a circle. It is
 * **verified on the web**; on a phone and on Android it is not, because there is no
 * simulator attached to this machine, so it goes on a device before anyone relies
 * on it.
 *
 * **The number is never rescaled to a hundred to fill a shape.** A book rated
 * three out of five shown as "60%" is a book nobody liked wearing a nicer hat. The
 * ring fills to `score / outOf` and the digits are not changed by that.
 *
 * **The colour is the app's, with the old app's thresholds.** They were three hex
 * written in this file, which made it the one place in the app where a colour
 * could not be changed by whoever owns the palette.
 */
export function Rating({ score, outOf, size = 72 }: RatingProps) {
  const theme = useTheme();

  const ratio = Math.max(0, Math.min(1, outOf === 0 ? 0 : score / outOf));
  const color = colorFor(ratio, theme.colors);

  const trazo = GROSOR / 2;
  const radio = size / 2 - trazo;
  const circunferencia = 2 * Math.PI * radio;

  const relleno = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    /*
      From zero every time, and not from wherever it was left.
     *
      This screen is opened again and again on the same title, and a ring that
      starts where it was left means the animation happens the first time and never
      again. Starting at zero makes the arrival part of the screen every time.
    */
    relleno.setValue(0);
    const animacion = Animated.timing(relleno, {
      toValue: 1,
      duration: DURACION,
      easing: Easing.out(Easing.cubic),
      // `strokeDashoffset` is a property of the drawing and not a transform, so this
      // one cannot go off the JS thread. It is a single number on a short line and
      // it finishes in 850ms, so the cost is the frame it happens on and not a
      // dropped frame.
      useNativeDriver: false,
    });
    animacion.start();
    return () => animacion.stop();
  }, [ratio, relleno]);

  /**
   * The dash, **clockwise from twelve, the way a progress ring has always gone**.
   *
   * The dash is one circumference long and the gap after it is the same length, so
   * what shows is the part of the dash that lands on the circle. A circle's path
   * starts at three o'clock and goes clockwise, and the group below turns the start
   * up to twelve, so the path is a clock face: position zero is the top and
   * increasing positions go to the right, to the bottom, to the left and home.
   *
   * **The offset goes negative, and that is what makes it fill from the top.** An
   * offset of `o` shows the stretch of the path between `o` and the end of the
   * circle, so a negative one pulls the dash *backwards*: the arc grows from twelve
   * towards three, then six, then nine, and its tip comes back up to close at
   * twelve on the left. A positive one draws the other half of the face and the
   * ring fills anticlockwise, which is the same length and the wrong direction.
   *
   * The far end is `−circunferencia × (1 − ratio)`, and this is the part that was
   * broken twice. It was `[-circunferencia, 0]` with no `ratio` in it, so the ring
   * **always** closed: measured on the web, the 8.3 of The Matrix was sitting at
   * `stroke-dashoffset="0"`. Five out of ten has to stop at six o'clock and a third
   * of the ring has to be missing, and the number in the middle being right does
   * not make the drawing right.
   */
  const despintado = relleno.interpolate({
    inputRange: [0, 1],
    outputRange: [-circunferencia, -circunferencia * (1 - ratio)],
  });

  /**
   * The score, counting from zero on the same value the arc is drawn from.
   *
   * **One decimal the whole way, and not the number of the score.** `8.35` is
   * rounded to `8.3` or `8.4` by the provider before it ever reaches here, and a
   * counter that arrived at `8.35` would have to print a different number of
   * decimals at some point in the middle of the count, so it would jump from `8.3`
   * to `8.35` at the end. Ending on the same string the static version printed is
   * what makes the animation invisible once it is over: the last frame is exactly
   * the frame that used to be there.
   *
   * The state starts on the real score and not on zero, so a screen where the
   * animation never runs — or runs before anybody can read it — shows the answer
   * instead of a ring counting to nothing.
   *
   * **It listens to the same `Animated.Value` the arc is drawn from**, rather than
   * running a second animation or reading the DOM: one number, one clock, and the
   * two halves of the ring cannot disagree about how far along they are.
   */
  const [numero, setNumero] = useState(score.toFixed(1));
  useEffect(() => {
    const id = relleno.addListener(({ value }) => {
      const texto = (value * score).toFixed(1);
      // Returned unchanged when the tenth has not moved, so a frame that lands
      // between two tenths costs no render at all.
      setNumero((antes) => (antes === texto ? antes : texto));
    });
    return () => relleno.removeListener(id);
  }, [relleno, score]);

  return (
    <View
      style={[styles.caja, { width: size, height: size }]}
      accessibilityRole="text"
      accessibilityLabel={`${score} de ${outOf}`}
      testID="rating-ring"
    >
      <Svg width={size} height={size}>
        {/* The track. */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radio}
          stroke={theme.colors.surfaceMuted}
          strokeWidth={GROSOR}
          fill="none"
        />
        {/*
          The fill, and **it starts at twelve o'clock and goes clockwise**, which is
          what a clock does. A dash starts at three o'clock by default, which makes
          the arc look like it is missing its first quarter, so the group is turned
          a quarter turn anticlockwise about the middle.

          **A `transform` string and not `rotation`/`origin`.** Those two are
          `react-native-svg`'s own way of saying it, and on the web they reach the
          DOM as attributes called `rotation` and `origin`, which are not SVG
          attributes: the console filled with "Invalid DOM property" and the turn
          did not happen. A `transform` is a real SVG attribute, so it is the form
          that means the same thing on all three targets.
        */}
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radio}
            stroke={color}
            strokeWidth={GROSOR}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circunferencia} ${circunferencia}`}
            strokeDashoffset={despintado as unknown as number}
          />
        </G>
      </Svg>

      <View style={styles.centro} pointerEvents="none">
        {/*
          The counting number, and an `AppText` again — it is state now, not an
          animated child, so the component that carries the typography can be the one
          that was already there.
        */}
        <AppText variant="heading" style={{ color: theme.colors.text, fontSize: size * 0.26 }}>
          {numero}
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
 * The thresholds stay because they are a judgement about a score and not a brand
 * decision; the colours were three hex written in this file, and now they come from
 * the palette.
 */
function colorFor(
  ratio: number,
  colors: { success: string; warning: string; danger: string },
): string {
  if (ratio >= 0.75) return colors.success;
  if (ratio >= 0.5) return colors.warning;
  return colors.danger;
}
