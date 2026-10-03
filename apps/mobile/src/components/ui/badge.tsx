import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";

import { useTheme } from "@/theme";

import type { IconName } from "./button";
import { AppText } from "./text";

export type BadgeTone =
  "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  /**
   * `compact` is the same badge with less of it around the words.
   *
   * It exists for the places where the badge is **not the headline** of the row:
   * a list of tasks carries its urgency on its own line under the title, where a
   * badge at the size of a badge in a header is a badge shouting over the thing
   * it is describing. Same colours, same pill, same words — less padding and a
   * smaller glyph.
   *
   * `regular` is the default on purpose: the sixteen other call sites are the ones
   * a badge is the headline of, and a default they all have to opt out of is a
   * default that gets opted out of wrongly.
   */
  size?: "regular" | "compact";
  style?: ViewStyle;
  /**
   * What a screen reader says instead of the bare label.
   *
   * Not optional in spirit: a badge that holds a count reads as "2", and "2" is not a
   * sentence. A badge on a notifications row has to carry what it counts, so a caller
   * that has one passes it — and `testID` comes with it because a count nobody can
   * find is a count nobody can verify.
   */
  accessibilityLabel?: string;
  testID?: string;
}

export function Badge({
  label,
  tone = "neutral",
  icon,
  size = "regular",
  style,
  accessibilityLabel,
  testID,
}: BadgeProps) {
  const theme = useTheme();

  const tones: Record<BadgeTone, { background: string; text: string }> = {
    neutral: {
      background: theme.colors.surfaceMuted,
      text: theme.colors.textMuted,
    },
    accent: {
      background: theme.colors.accentSoft,
      text: theme.colors.accentSoftText,
    },
    success: {
      background: theme.colors.successSoft,
      text: theme.colors.success,
    },
    warning: {
      background: theme.colors.warningSoft,
      text: theme.colors.warning,
    },
    danger: { background: theme.colors.dangerSoft, text: theme.colors.danger },
    info: { background: theme.colors.infoSoft, text: theme.colors.info },
  };

  const palette = tones[tone];
  const compacto = size === "compact";

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: palette.background,
          borderRadius: theme.radius.pill,
          paddingHorizontal: compacto ? theme.spacing.sm : theme.spacing.md,
          paddingVertical: compacto ? theme.spacing.xxs : theme.spacing.xs,
          gap: theme.spacing.xs,
        },
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={compacto ? 10 : 12}
          color={palette.text}
        />
      ) : null}
      <AppText variant="caption" style={{ color: palette.text }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    /**
     * And it does not shrink, **because a pill that gets narrow is not a pill.**
     *
     * Measured on an Android release build, in the urgency badge of a task row: the
     * badge got 53 points wide and 145 tall, because "High" was ten points wide and
     * wrapped to one letter per line, and the row was four times as tall as its
     * content. The text was readable and the shape was not, which is the worst of
     * both: it looked like a mistake and it still took the room.
     *
     * `flexShrink: 0` and not a `minWidth`: the label is the shortest thing on the
     * line and it is what the whole badge is for, so the thing that yields is the
     * one next to it — which is what `styles.metaTags` in the row already does.
     */
    flexShrink: 0,
  },
});
