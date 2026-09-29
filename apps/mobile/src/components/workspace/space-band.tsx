import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

import { SpaceWash } from "@/components/ui/wash";
import { VELO, type WashVariant } from "@/lib/workspace/wash";
import { useTheme } from "@/theme";

/**
 * How far the wash reaches **below** the header before it is gone.
 *
 * **Enough that the gradient is there to be seen, and not so much that a list is
 * read against a colour.** 100 points is about a header and a half: the wash is
 * still visibly a band rather than a tint, and it is gone well before the fourth
 * row of anything.
 */
const SOBRO = 100;

/** What the band needs to know about the space. */
export interface SpaceBandProps {
  color?: string | null;
  colorTo?: string | null;
  wash?: WashVariant | null;
}

/**
 * The lower half of a space's wash: the part below the header.
 *
 * **The other half is the header's.** A screen in a space has its colour in two
 * places and nowhere else: the bar, which is 56 points on every screen, and this,
 * which starts where the bar ends and reaches 100 points further before it is
 * gone. One wash in two pieces, and the only place they meet is a straight line
 * with the same colour on both sides of it.
 *
 * **The header does not fade; this does, and only this.** When the bar faded
 * inside itself and this started again at full strength, the two left a step of
 * saturation right where the eye is already looking for a change of screen — and a
 * step reads as a mistake even when nobody can name it. So the bar paints the
 * colour whole and cuts it at its edge, and there is exactly one fade in the app.
 *
 * **It adds nothing to the height of anything.** The band is painted *behind* the
 * content, absolutely positioned at the top of the screen with a height of its
 * own, and the screen's first row starts where it started before the band existed.
 * That is why the bar can be 56 on the panel, on a list and outside a space
 * alike: measured, 56 in all three.
 */
export function SpaceBand({ color, colorTo, wash }: SpaceBandProps) {
  const theme = useTheme();

  return (
    <View pointerEvents="none" style={styles.banda}>
      <SpaceWash
        colorKey={color}
        // The second colour too, for the reason it always travels: a wash painted
        // with only the first is a different pair from the one the picker showed,
        // and the cards on the panel would not match this.
        colorToKey={colorTo}
        wash={wash ?? undefined}
        style={styles.lavado}
      />

      {/*
        The veil, and it is the **same** one the header uses. Not for taste: the
        two halves touch, and two places that each mute their own amount put a step
        exactly on the line between them.
      */}
      <View
        style={[styles.velo, { backgroundColor: theme.colors.background, opacity: VELO }]}
      />

      <LinearGradient
        colors={["transparent", theme.colors.background]}
        locations={[0.18, 1]}
        style={styles.desvanecido}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banda: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // A height of its own and no `bottom`: this box does **not** grow with the
    // content, which is what lets the bar above it stay the height it is.
    height: SOBRO,
    overflow: "hidden",
  },
  lavado: {
    flex: 1,
  },
  velo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  desvanecido: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // It fades across nearly the whole band: the colour has to still be there
    // where the content starts — otherwise this is a frame, not a gradient — and
    // it has to be gone by the bottom, or the bottom is a cut.
    height: "82%",
  },
});
