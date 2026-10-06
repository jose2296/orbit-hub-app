import Ionicons from "@expo/vector-icons/Ionicons";
import type { IconRef } from "@orbit-hub/contracts";
import { Text } from "react-native";

import { useTheme } from "@/theme/theme-provider";
import { resolveAppIcon } from "@/lib/icons/resolve-icon";

interface AppIconProps {
  icon?: IconRef | null;
  size?: number;
  /** The colour of whatever the icon is on, used when the icon's own is `auto`. */
  inheritColor?: string;
  /** What to draw when there is no icon. A space without one draws `folder-outline`. */
  fallback?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}

/**
 * Any icon, drawn the same on all three targets.
 *
 * An emoji is text: the operating system draws it on every platform, which is
 * what makes "the system emojis" a free feature and not a library. A vector is
 * the glyph the catalogue names. What this build cannot draw is no icon — and
 * `Ionicons` asked for a glyph it does not have renders an empty `Text` and
 * says nothing, so the name is asked for here first.
 */
export function AppIcon({ icon, size = 20, inheritColor, fallback, testID }: AppIconProps) {
  const theme = useTheme();
  const resolved = resolveAppIcon(icon, theme.scheme, inheritColor);

  if (!resolved) {
    return fallback ? (
      <Ionicons name={fallback} size={size} color={theme.colors.textSubtle} testID={testID} />
    ) : null;
  }

  if (resolved.kind === "emoji") {
    return (
      <Text style={{ fontSize: size, color: resolved.color }} testID={testID}>
        {resolved.text}
      </Text>
    );
  }

  if (!(resolved.glyph in Ionicons.glyphMap)) {
    return fallback ? (
      <Ionicons name={fallback} size={size} color={resolved.color} testID={testID} />
    ) : null;
  }

  return <Ionicons name={resolved.glyph as keyof typeof Ionicons.glyphMap} size={size} color={resolved.color} testID={testID} />;
}
