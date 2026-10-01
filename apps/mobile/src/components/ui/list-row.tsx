import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";

import { useTheme } from "@/theme";

import type { IconName } from "./button";
import { useLongPressText } from "@/hooks/use-long-press-text";

import { AppText } from "./text";

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
}: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { gap: theme.spacing.md }, style]}>
      <View style={styles.flex}>
        <AppText variant="heading">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <AppText variant="callout" tone="accent">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ListRowProps {
  /**
   * What goes before the title.
   *
   * The colour of the space a row belongs to goes here, so a list of spaces is
   * told apart by something other than its name.
   */
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  icon?: IconName;
  onPress?: () => void;
  rightLabel?: string;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/** Settings/list row used across the app so touch targets stay consistent. */
export function ListRow({
  title,
  subtitle,
  icon,
  leading,
  onPress,
  rightLabel,
  chevron = false,
  destructive = false,
  disabled = false,
  style,
}: ListRowProps) {
  const theme = useTheme();

  /*
    The whole name on a long press, **added to this row's own press**.

    The row is the thing that opens the note, so a `Pressable` around the name
    would take the gesture from it on a phone and the row would stop opening — a
    bug the web cannot show, because a click there bubbles and both fire. See
    `useLongPressText`.
  */
  const nombre = useLongPressText(title);

  const content = (
    <>
      {leading ?? null}
      {icon ? (
        <View
          style={[
            styles.icon,
            {
              backgroundColor: destructive
                ? theme.colors.dangerSoft
                : theme.colors.accentSoft,
              borderRadius: theme.radius.sm,
            },
          ]}
        >
          <Ionicons
            name={icon}
            size={18}
            color={
              destructive ? theme.colors.danger : theme.colors.accentSoftText
            }
          />
        </View>
      ) : null}
      <View style={styles.flex}>
        <AppText variant="bodyStrong" tone={destructive ? "danger" : "default"}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {rightLabel ? (
        <AppText variant="callout" tone="muted">
          {rightLabel}
        </AppText>
      ) : null}
      {chevron ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textSubtle}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[
          styles.row,
          { gap: theme.spacing.md, paddingVertical: theme.spacing.md },
          style,
        ]}
      >
        {content}
        {nombre.sheet}
      </View>
    );
  }

  return (
    <>
      <Pressable
        onLongPress={nombre.onLongPress}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          {
            gap: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
          },
          style,
        ]}
      >
        {content}
      </Pressable>
      {nombre.sheet}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
  icon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
});
