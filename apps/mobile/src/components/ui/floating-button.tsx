import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { isWide } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The floating button, in the corner the thumb reaches.
 *
 * There is one of these in the app and there is only ever going to be one, in the
 * same corner of every screen, because that is what makes it a place rather than
 * a button. A screen that puts its action somewhere else makes you look for it,
 * and a screen that puts a second one in a different corner makes you check
 * whether they do different things.
 *
 * It lives in `ui` and not next to the thing that happens to use it most: on the
 * folders screen it creates a list, on the panel it adds a card, and importing it
 * from `folders` would be the panel depending on folders to say "plus".
 */
export function FloatingButton({
  onPress,
  /**
   * What the button does, for anything that cannot see it.
   *
   * Defaults to the one the app has always used. Every screen that shows a plus
   * is creating something, and a screen reader that hears "add" on three screens
   * in a row has been told nothing about which one.
   */
  label,
}: {
  onPress: () => void;
  label?: string;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const wide = isWide();
  const size = wide ? 52 : 58;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? t("create.title")}
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
