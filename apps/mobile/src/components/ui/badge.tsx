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
  },
});
