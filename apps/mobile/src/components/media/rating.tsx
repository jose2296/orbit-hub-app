import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface RatingProps {
  /** The number the provider gave, on the scale it chose. */
  score: number;
  /** Which scale, because a book rated 3 out of 5 is not 3 out of 10. */
  outOf: number;
  /** How big the whole thing is, in points. */
  size?: number;
}

/** How many marks the ring has. Ten is one per point on a ten point scale. */
const MARKS = 10;

/**
 * The score as a ring of marks, with the number in the middle.
 *
 * The old app drew a circle that filled up, in green, amber or red. Filling a
 * circle needs a drawing library, and `react-native-svg` is a whole native
 * dependency for one circle — so this is ten marks around a circle instead, with
 * as many of them coloured as the score is worth. It reads the same at a glance,
 * it says *how* good as well as *that* it is good, and it looks the same on the
 * three targets without a native module behind it.
 *
 * The number is never rescaled to a hundred to fill a shape. A book rated three
 * out of five shown as "60%" is a book nobody liked wearing a nicer hat; what is
 * shown is the number the provider gave on the scale the provider uses, with the
 * scale next to it.
 */
export function Rating({ score, outOf, size = 72 }: RatingProps) {
  const theme = useTheme();
  const t = useTranslation();

  const ratio = Math.max(0, Math.min(1, score / outOf));
  const filled = Math.round(ratio * MARKS);
  const color = colorFor(ratio);
  // Round marks and not dashes: a dash is a different shape depending on where
  // it lands on the circle, and ten of them in a row read as a ring that is
  // slightly not round. Ten dots are ten of the same thing.
  const mark = Math.max(5, Math.round(size * 0.15));
  const ring = size - mark * 2;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={t("rating.says", {
        score: score.toFixed(1),
        outOf,
        percent: Math.round(ratio * 100),
      })}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {Array.from({ length: MARKS }, (_, index) => {
        // From the top, clockwise. `translate` moves the mark out to the ring
        // and the rotation puts it at its place on the circle.
        const angle = (index * 360) / MARKS;
        return (
          <View
            key={index}
            style={[
              styles.mark,
              {
                width: mark,
                height: mark,
                borderRadius: mark / 2,
                backgroundColor:
                  index < filled ? color : theme.colors.surfaceMuted,
                transform: [
                  { rotate: `${angle}deg` },
                  { translateY: -ring / 2 - mark / 2 },
                ],
              },
            ]}
          />
        );
      })}

      <View style={styles.label}>
        <AppText
          variant="heading"
          style={{
            color,
            fontSize: Math.round(size * 0.3),
            lineHeight: Math.round(size * 0.34),
          }}
        >
          {score.toFixed(1)}
        </AppText>
        <AppText
          variant="caption"
          tone="subtle"
          style={{
            fontSize: Math.round(size * 0.15),
            lineHeight: Math.round(size * 0.2),
          }}
        >
          /{outOf}
        </AppText>
      </View>
    </View>
  );
}

/**
 * Green, amber or red, by how much of the scale is filled.
 *
 * On the *ratio* and not on the number, so a five point book and a ten point
 * film land on the same colour at the same quality. A 3.0/5 and a 6.0/10 are
 * the same judgement and have to look the same.
 */
function colorFor(ratio: number): string {
  if (ratio >= 0.75) return "#22C55E";
  if (ratio >= 0.5) return "#EAB308";
  return "#EF4444";
}

const styles = StyleSheet.create({
  mark: {
    position: "absolute",
  },
  label: {
    alignItems: "center",
    justifyContent: "center",
  },
});
