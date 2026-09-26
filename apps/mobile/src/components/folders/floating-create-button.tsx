import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { isWide } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The one button that creates things, in the corner the thumb reaches.
 *
 * It is always the same three things, because the list of what can be created
 * does not change with the screen: a list of one of the five kinds, a folder
 * and, once notes exist, a note. Being in the same corner of every screen is
 * what makes it a place rather than a button.
 */
export function FloatingCreateButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const t = useTranslation();
  const wide = isWide();
  const size = wide ? 52 : 58;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("create.title")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.accent,
          // The CSS form of a shadow, for the same reason as the panel: the
          // `shadow*` props are gone from React Native Web and warn on every
          // render.
          boxShadow: theme.shadow.floating.boxShadow,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons
        name="add"
        size={wide ? 24 : 28}
        color={theme.colors.onAccent}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    alignItems: "center",
    justifyContent: "center",
    elevation: 9,
  },
});
