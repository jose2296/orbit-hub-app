import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { ListItem } from "@orbit-hub/contracts";

import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";

export interface DoneTrayProps {
  /** The rows already done, in the order the list keeps them. */
  items: ListItem[];
  onToggle: (item: ListItem) => void;
  onOpen: (item: ListItem) => void;
  /** How high it sits: the create button is at the bottom right. */
  bottomInset: number;
}

/**
 * The done rows, in a tray that lives at the bottom of the list.
 *
 * It is here because of what it is for. A shopping list grows: the milk you
 * bought three weeks ago is in it, and the next time you want to buy milk the
 * row is *there*, done, at the very bottom of two hundred pending things, and
 * the only way to un-tick it is to scroll past all of them. On a phone that is
 * thirty swipes to find out you already had it.
 *
 * So the done rows are not only at the end: there is a tray that says how many
 * there are, it is always within reach of the thumb, and opening it lists them
 * there, with their checkboxes, without moving the list at all. Un-ticking one
 * sends it back to the pending section and it disappears from the tray, because
 * that is what just happened to it.
 *
 * It counts rather than hides: an empty tray is a bar over the list, and a bar
 * that says "0 completados" is worse than no bar.
 */
export function DoneTray({ items, onToggle, onOpen, bottomInset }: DoneTrayProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const shown = open ? items : [];

  return (
    <View
      testID="done-tray"
      style={[
        styles.wrap,
        {
          bottom: bottomInset,
          left: theme.spacing.lg,
          right: theme.spacing.lg,
          borderRadius: theme.radius.lg,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      {open ? (
        <ScrollView
          style={styles.list}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {shown.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              accessibilityHint={t("doneTray.undoHint")}
              onPress={() => onOpen(item)}
              style={({ pressed }) => [
                styles.row,
                {
                  gap: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Checkbox
                checked
                onToggle={() => onToggle(item)}
                label=""
              />
              <AppText variant="body" tone="subtle" numberOfLines={1} style={styles.flex}>
                {item.title}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <Pressable
        testID="done-tray-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("doneTray.title", { count: items.length })}
        accessibilityHint={t("doneTray.hint")}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [
          styles.bar,
          {
            gap: theme.spacing.sm,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            borderTopWidth: open ? StyleSheet.hairlineWidth : 0,
            borderTopColor: theme.colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-up"}
          size={16}
          color={theme.colors.textMuted}
        />
        <AppText variant="caption" tone="muted" style={styles.flex}>
          {t("doneTray.title", { count: items.length })}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  list: {
    maxHeight: 190,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
});
