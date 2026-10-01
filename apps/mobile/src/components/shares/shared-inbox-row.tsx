import { Ionicons } from "@expo/vector-icons";
import type { Share } from "@orbit-hub/contracts";
import { Pressable, StyleSheet, View } from "react-native";

import { useA11yHint } from "@/components/ui/a11y-hint";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * One thing shared with this person that is not filed yet.
 *
 * Its own module, and not a function inside the drawer, for one reason: **the email
 * needs a page to point at.** That mail links to `/shared`, and `/shared` had no route,
 * so the button in "Jose te ha compartido una carpeta" landed on *Page could not be
 * found* — on the screen of the person who was just told they had been given
 * something. The inbox lived inside the drawer, which is a panel and not an address.
 *
 * So the row is here, and both the drawer and the screen draw it. Two renderers of the
 * same row is what the drawer already risked; one component is what stops it.
 */
export function SharedInboxRow({
  share,
  onPress,
}: {
  share: Share;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  const pista = useA11yHint(t("place.chooseSpaceHint"));

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("drawer.sharedWithMe")}: ${share.title}`}
        {...pista.props}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          {
            borderRadius: theme.radius.md,
            backgroundColor: pressed
              ? theme.colors.surfaceMuted
              : "transparent",
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 7,
          },
        ]}
      >
        <Ionicons name="people-outline" size={15} color={theme.colors.accent} />
        <View style={{ flex: 1 }}>
          <AppText variant="callout" numberOfLines={1}>
            {share.title}
          </AppText>
          <AppText variant="caption" tone="subtle" numberOfLines={1}>
            {share.ownerName ?? ""}
          </AppText>
        </View>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={theme.colors.textSubtle}
        />
      </Pressable>
      {pista.node}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});