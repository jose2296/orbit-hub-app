import { Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { AppText } from "@/components/ui/text";
import { useTheme } from "@/theme";

export interface ChipProps {
  label: string;
  /** On or off. Off is the default: a filter that is on is the exception. */
  selected?: boolean;
  /** How many rows this would leave. A chip that hides everything is a mistake. */
  count?: number;
  onPress: () => void;
  testID?: string;
}

/**
 * A value you can switch on and off, **drawn as a chip and not as a row**.
 *
 * This exists because a decade and a label were being drawn as rows. A row is
 * 358 points wide with eighteen of padding on each side and a divider line under
 * it, which is the right shape for "the thing you are about to do" and the wrong
 * shape for "one of forty values you might want". Thirty-eight rows of film years
 * is a list, not a filter, and the answer to "the nineties" is somewhere in the
 * middle of it with no way to see that it is there.
 *
 * **A chip wraps instead of scrolling.** A horizontal scroller hides values behind
 * an edge, and a filter whose values you cannot see is a filter you do not use;
 * a wrapped block of chips is taller and shows everything at once, which is the
 * trade a filter wants to make.
 *
 * **The count is on the chip and not behind it.** Choosing a decade that leaves
 * two rows out of forty and choosing one that leaves none are both one tap away,
 * and the tap that empties the list is the one people regret. The number turns
 * the chip from a guess into a decision.
 */
export function Chip({ label, selected = false, count, onPress, testID }: ChipProps) {
  const theme = useTheme();

  /*
    The press, **the same three percent the buttons use**.

    A chip is a small target that gets hit in a hurry, in a row with nine others,
    and answering a press with nothing at all is how a row of chips feels like a
    row of labels. Scaling the content and not the chip keeps the layout from
    jumping, and not bouncing is the point: a chip that overshoots looks like a
    toy, and this is a control somebody taps twenty times looking for one value.
  */
  const escala = useSharedValue(1);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      onPress={onPress}
      onPressIn={() => {
        escala.value = withSpring(0.94, { damping: 22, stiffness: 400, mass: 0.4 });
      }}
      onPressOut={() => {
        escala.value = withSpring(1, { damping: 18, stiffness: 300, mass: 0.4 });
      }}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
          gap: theme.spacing.xs,
          backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceMuted,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          // Pressed is a little flatter, not a different colour: on a chip the
          // selected state is the only state that means anything, and a second
          // colour for "you are touching this" competes with it.
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Animated.View style={[styles.texto, { gap: theme.spacing.xs }, estilo]}>
        <AppText
          variant="caption"
          style={{ color: selected ? theme.colors.onAccent : theme.colors.text }}
          numberOfLines={1}
        >
          {label}
        </AppText>
        {count === undefined ? null : (
          <AppText
            variant="caption"
            tone="subtle"
            style={{ color: selected ? theme.colors.onAccent : theme.colors.textSubtle }}
          >
            {count}
          </AppText>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** The part that moves. */
  texto: {
    flexDirection: "row",
    alignItems: "center",
  },
});
