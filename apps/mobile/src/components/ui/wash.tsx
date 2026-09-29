import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import type { ViewStyle } from "react-native";

import { spacePaint } from "@/lib/workspace/color";
import type { WashVariant } from "@/lib/workspace/wash";
import { anguloDiagonal } from "@/lib/workspace/wash";

/**
 * A space's wash: the gradient its colour makes, as a background.
 *
 * The same wash everywhere a space appears, which is the whole point. A dot in
 * the menu, a band at the top of its screen and a card on the panel are the same
 * colours, so a space is recognisable before its name is read.
 *
 * The flat colour goes *under* the gradient rather than the gradient being
 * opaque on its own. A gradient that fades in leaves a white frame on the first
 * paint, and on a dark theme that white frame is a flash in the corner of a card
 * that is supposed to be the colour of a space.
 *
 * **Three shapes, and one of them is not a gradient at all.** `diagonal` and
 * `vertical` are two directions for the same two stops. `split` is a hard edge
 * between two flat halves, so it is drawn as two halves and not as a gradient:
 * a `LinearGradient` between the two is precisely the soft thing it is not.
 */
export function SpaceWash({
  colorKey,
  colorToKey,
  wash,
  style,
  children,
  radius,
}: {
  /** The space whose colour this is. */
  colorKey: string | null | undefined;
  /** The colour it ends in, or `null` when nobody has chosen one. */
  colorToKey?: string | null;
  /** Which of the two ways it is painted. */
  wash?: WashVariant;
  style?: ViewStyle | ViewStyle[];
  children?: ReactNode;
  /** Rounds the wash and clips what is inside it. */
  radius?: number;
}) {
  const paint = spacePaint(colorKey, wash, colorToKey);
  const clipped = radius === undefined ? null : { borderRadius: radius };

  // The box, measured, for the angle. A diagonal that is 45° in every box is
  // horizontal in a band three times wider than it is tall, which is where a space
  // is mostly seen.
  const [caja, setCaja] = useState({ width: 0, height: 0 });
  const angulo = anguloDiagonal(caja.width, caja.height);

  return (
    <View
      onLayout={(e) =>
        setCaja({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })
      }
      style={[
        styles.root,
        clipped,
        { backgroundColor: paint.color },
        style,
      ]}
    >
      <LinearGradient
        colors={paint.stops}
        start={{ x: 0, y: 0 }}
        // Vertical is top to bottom whatever the box is. Diagonal is the angle a
        // corner-to-corner line actually makes, and it is computed rather than
        // fixed for the reason in `anguloDiagonal`.
        end={
          paint.shape === "vertical"
            ? { x: 0, y: 1 }
            : {
                // The unit vector the angle describes, so the two platforms get the
                // same picture: a fixed 45 and "corner to corner" are not the same
                // thing in a box that is not square.
                x: Math.cos((angulo * Math.PI) / 180),
                y: Math.sin((angulo * Math.PI) / 180),
              }
        }
        style={[StyleSheet.absoluteFill, clipped]}
      />
      {children}
    </View>
  );
}

/**
 * The small version: a circle of a space's colour for a row in the menu.
 *
 * Its own component because there are a lot of them and the wash is the only
 * thing they draw, and a menu that renders a gradient view per workspace pays
 * for it in exactly the place that has to open fastest.
 */
export function SpaceDot({
  colorKey,
  colorToKey,
  wash,
  size = 12,
}: {
  colorKey: string | null | undefined;
  /**
   * The space's wash, so the dot is a small copy of the space rather than the
   * default of whatever this screen was written against.
   *
   * Both menus have to say it, and they are two components. Without this prop the
   * narrow drawer and the wide one would show the same space in two different
   * styles, which is the one thing the wash is for.
   */
  wash?: WashVariant;
  /**
   * The colour it ends in, so the dot is a small copy of the space rather than
   * the default of whatever this screen was written against.
   *
   * Both menus have to say it, and they are two components. Without this prop the
   * narrow drawer and the wide one would show the same space in two different
   * colours, which is the one thing the wash is for.
   */
  colorToKey?: string | null;
  size?: number;
}) {
  return (
    <SpaceWash
      colorKey={colorKey}
      colorToKey={colorToKey}
      wash={wash}
      radius={size / 2}
      style={{ width: size, height: size }}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
  },
});
