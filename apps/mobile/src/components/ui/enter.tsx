import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

/**
 * A block that **arrives a beat after the one above it**, and not all at once.
 *
 * The item's detail is a long column: a cover, a score, a tagline, a synopsis, a
 * row of facts, a row of chips, who made it, who is in it, a shelf of covers, a
 * trailer. All of it appeared in the same frame, and a long screen that arrives in
 * one frame reads as a page that was downloaded rather than a title you opened —
 * the eye is given six blocks at once and takes the top one and stops.
 *
 * **Twenty-five milliseconds between siblings.** Enough that the arrival has an
 * order to it and not enough that the last thing on the screen is waiting: eight
 * blocks at twenty-five is a fifth of a second, which is the length of a blink. At
 * a hundred it would be nearly a second and the screen would feel broken; at ten
 * the whole thing is over before the first block has finished moving.
 *
 * **Six points of rise and a fade, and it is the same six the empty state uses.**
 * It is not a slide: nothing here is coming from anywhere, the content is being
 * read top to bottom and the movement only says "this was not here a moment ago".
 *
 * **It runs on the native driver.** Opacity and a transform are the two things it
 * is made of, which is the pair Reanimated can move without asking JavaScript for
 * a frame — so a staggered column costs one line of setup per block and nothing
 * per frame.
 *
 * **The delay, not the order.** The order is written by where the component sits
 * in the tree, and a caller who reorders the markup does not have to renumber
 * anything: `indice * 25` is derived from the position, so a block that moves up
 * also arrives earlier.
 */
export function Enter({
  children,
  indice = 0,
  paso = 25,
  rise = 6,
  style,
}: {
  children: ReactNode;
  /** Where this block sits among its siblings, from zero. */
  indice?: number;
  /** Milliseconds between siblings. */
  paso?: number;
  /**
   * How far below its place it starts, in points.
   *
   * Six is right for a line of text and wrong for a cover. A cover is two hundred
   * points tall and a person reads it as a picture rather than as a paragraph, so
   * six points of movement on something that size is a fifth of a millimetre and
   * what is wanted there is a twelfth of its own height — which is the difference
   * between "the page settled" and "the picture you tapped came closer".
   */
  rise?: number;
  style?: ViewStyle;
}) {
  const entrada = useSharedValue(0);

  useEffect(() => {
    entrada.value = withDelay(
      indice * paso,
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
  }, [entrada, indice, paso]);

  const estilo = useAnimatedStyle(() => ({
    opacity: entrada.value,
    transform: [{ translateY: (1 - entrada.value) * rise }],
  }));

  return <Animated.View style={[styles.contenedor, estilo, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  contenedor: {
    // Nothing here on purpose: the rise and the fade are the whole of it, and a
    // layout style would fight the transform for the same property.
  },
});