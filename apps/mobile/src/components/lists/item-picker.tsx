import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import {
  ITEM_GLYPHS,
  ITEM_ICON_GROUPS,
  isItemIcon,
} from "@/lib/lists/item-presentation";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";

export interface FiltersSheetProps {
  open: boolean;
  onClose: () => void;
  tags: { tag: string; count: number }[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  completed: "all" | "pending" | "done";
  onCompleted: (value: "all" | "pending" | "done") => void;
  text: string;
  onText: (value: string) => void;
  activeCount: number;
  onReset: () => void;
}

/**
 * What a list is showing: the labels, what is left to do, and a search.
 *
 * A panel rather than a row of chips above the list, because a shopping list
 * has a dozen labels and the chips would take more room than the items. It
 * opens with everything showing, because a filter that hides things the moment
 * it appears is one nobody trusts.
 */
export function FiltersSheet({
  open,
  onClose,
  tags,
  selectedTags,
  onToggleTag,
  completed,
  onCompleted,
  text,
  onText,
  activeCount,
  onReset,
}: FiltersSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Sheet
      visible={open}
      onClose={onClose}
      title={t("filters.title")}
      subtitle={
        activeCount > 0
          ? t("filters.active", { count: activeCount })
          : t("filters.none")
      }
    >
      <View
        style={{ gap: theme.spacing.lg, paddingHorizontal: theme.spacing.lg }}
      >
        <TextField
          label={t("filters.searchLabel")}
          value={text}
          onChangeText={onText}
          placeholder={t("filters.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="caption" tone="subtle">
            {t("filters.what")}
          </AppText>
          <View style={{ gap: theme.spacing.xs }}>
            {(["all", "pending", "done"] as const).map((value) => (
              <View
                key={value}
                style={[
                  styles.checkRow,
                  {
                    backgroundColor: theme.colors.surfaceMuted,
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Checkbox
                  checked={completed === value}
                  onToggle={() => onCompleted(value)}
                  label={t(`filters.show.${value}`)}
                />
              </View>
            ))}
          </View>
        </View>

        {tags.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="subtle">
              {t("filters.labels")}
            </AppText>
            <View style={[styles.labels, { gap: theme.spacing.sm }]}>
              {tags.map(({ tag, count }) => (
                <Button
                  key={tag}
                  label={`${tag} · ${count}`}
                  size="sm"
                  variant={selectedTags.includes(tag) ? "primary" : "secondary"}
                  fullWidth={false}
                  onPress={() => onToggleTag(tag)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <Button
          label={t("filters.reset")}
          variant="ghost"
          icon="refresh"
          disabled={activeCount === 0}
          onPress={onReset}
        />
      </View>
    </Sheet>
  );
}

export interface IconPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** The icon the row has now, or `null`. */
  value: string | null;
  onPick: (icon: string | null) => void;
}

/**
 * The icon of a row, out of the ones the app draws.
 *
 * Grouped, because thirty icons in one grid is a wall, and with nothing to
 * choose at the top: a row with no icon is a perfectly good row and the picture
 * is a help, not a requirement.
 */
export function IconPickerSheet({
  open,
  onClose,
  value,
  onPick,
}: IconPickerSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  const choose = (icon: string | null) => {
    onPick(icon);
    onClose();
  };

  return (
    <Sheet visible={open} onClose={onClose} title={t("icons.title")}>
      <View
        style={{ gap: theme.spacing.lg, paddingHorizontal: theme.spacing.lg }}
      >
        <IconCell
          glyph="close-circle-outline"
          label={t("icons.none")}
          selected={value === null}
          onPress={() => choose(null)}
        />

        {ITEM_ICON_GROUPS.map((group) => (
          <View key={group.key} style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="subtle">
              {t(group.key as TranslationKey)}
            </AppText>
            <View style={[styles.grid, { gap: theme.spacing.sm }]}>
              {group.icons.map((icon) => (
                <IconCell
                  key={icon}
                  glyph={ITEM_GLYPHS[icon].glyph}
                  label={t(ITEM_GLYPHS[icon].labelKey)}
                  selected={value === icon}
                  onPress={() => choose(icon)}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function IconCell({
  glyph,
  label,
  selected,
  onPress,
}: {
  glyph: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.iconCell, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View
        style={[
          styles.iconBox,
          {
            backgroundColor: selected
              ? theme.colors.accent
              : theme.colors.surfaceMuted,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        <Ionicons
          name={glyph}
          size={20}
          color={selected ? theme.colors.onAccent : theme.colors.textMuted}
        />
      </View>
      <AppText variant="caption" tone="subtle" numberOfLines={1} align="center">
        {label}
      </AppText>
    </Pressable>
  );
}

/** The glyph of a row's icon, or nothing when it has none. */
export function ItemIcon({
  icon,
  size = 18,
}: {
  icon: string | null;
  size?: number;
}) {
  const theme = useTheme();
  if (!isItemIcon(icon)) return null;
  return (
    <Ionicons
      name={ITEM_GLYPHS[icon].glyph}
      size={size}
      color={theme.colors.textMuted}
    />
  );
}

const styles = StyleSheet.create({
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  iconCell: {
    width: 74,
    gap: 4,
  },
  iconBox: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
