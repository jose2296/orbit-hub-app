import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { useTranslation } from "@/lib/i18n";
import {
  WORKSPACE_COLORS,
  cardColors,
  isWorkspaceColor,
} from "@/lib/workspace/color";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";

export interface WorkspaceColorPickerProps {
  /** The colour the space has now, or `null` for a space with none. */
  value: string | null | undefined;
  onPick: (color: string) => void;
  /** Asks first when the space already has this colour, on the space screen. */
  compact?: boolean;
}

/**
 * The colour of a space, out of eight.
 *
 * Eight and not a free colour picker: a person choosing a colour for a space is
 * choosing the background of the cards that space makes, so it has to be one
 * whose text can be read. A hex field on a phone is a field nobody fills in.
 *
 * Each swatch draws its own name in the colour that reads on it, so the choice
 * is made on what it looks like and not on what the label says.
 */
export function WorkspaceColorPicker({
  value,
  onPick,
  compact = false,
}: WorkspaceColorPickerProps) {
  const theme = useTheme();
  const t = useTranslation();
  const current = isWorkspaceColor(value) ? value : null;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {!compact ? (
        <AppText variant="caption" tone="subtle">
          {t("workspaces.colorLabel")}
        </AppText>
      ) : null}

      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {WORKSPACE_COLORS.map((color) => {
          const selected = color.key === current;
          const { background, foreground } = cardColors(color.hex);

          return (
            <Pressable
              key={color.key}
              accessibilityRole="button"
              accessibilityLabel={t(`workspaces.color.${color.key}` as never)}
              accessibilityState={{ selected }}
              onPress={() => onPick(color.key)}
              style={({ pressed }) => [
                styles.swatch,
                {
                  backgroundColor: background,
                  borderColor: selected ? foreground : "transparent",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {selected ? (
                <Ionicons name="checkmark" size={16} color={foreground} />
              ) : (
                <AppText
                  variant="caption"
                  style={{ color: foreground, fontSize: 10 }}
                >
                  {color.key.slice(0, 2)}
                </AppText>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
