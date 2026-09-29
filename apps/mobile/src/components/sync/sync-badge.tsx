import { StyleSheet, View } from "react-native";

import { useSyncAttention } from "@/hooks/use-sync-attention";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The dot on the menu button that says the sync centre has something for you.
 *
 * It is a dot and not a count. A count is a number that has to be kept correct
 * while it changes, and a badge that says "3" is read as three things to do
 * rather than as three things that are already handled — the sync centre is where
 * you find out what they are, and the badge's only job is to make you go.
 *
 * The accent colour and not a red: red on this button would be a second thing
 * competing for the same signal, and the app has one accent that already means
 * "this is the action". Only a conflict is red, and that is a different button
 * entirely.
 */
export function SyncBadge({ size = 10 }: { size?: number }) {
  const theme = useTheme();
  const t = useTranslation();
  const attention = useSyncAttention();

  if (!attention.needed) return null;

  return (
    <View
      testID="sync-badge"
      // The label is on the badge and not on the button, because the button is
      // "open the menu" and a screen reader announcing "open the menu, 3
      // conflicts" every time is a lie about what the button does.
      accessibilityLabel={
        attention.count > 0
          ? t("sync.badgeNeedsYouWithCount", { count: attention.count })
          : t("sync.badgeNeedsYou")
      }
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.accent,
          borderColor: theme.colors.background,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    // A ring in the background colour, so the dot reads as sitting *on* the
    // button rather than as part of it.
    borderWidth: 2,
  },
});
