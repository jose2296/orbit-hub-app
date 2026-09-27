import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { ItemIcon, ItemIconCategory, ListItem } from "@orbit-hub/contracts";
import { ITEM_ICON_CATEGORIES } from "@orbit-hub/contracts";

import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import {
  ICON_COLOR_KEYS,
  ICON_COLOR_LABEL,
  ICON_GROUP_LABEL,
  glyphOf,
  iconColor,
  iconLabel,
  isItemIcon,
  searchIcons,
} from "@/lib/lists/item-icons";
import type { Ionicon } from "@/lib/lists/item-glyphs";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";

/** The two ways of drawing an icon, and what they are called. */
const ICON_STYLE_LABEL: Record<"outline" | "fill", TranslationKey> = {
  outline: "icons.style.outline",
  fill: "icons.style.fill",
};

/**
 * What a tap on this panel changes.
 *
 * Every field is optional on purpose. Tapping a colour is not tapping an icon
 * with a colour, and sending the icon along anyway meant writing back whatever
 * the panel thought the row had — so choosing a colour right after choosing an
 * icon took the icon away. Here a colour sends only a colour, and a drawing
 * sends only a drawing, and the icon changes when an icon is tapped.
 */
export interface IconChange {
  icon?: ListItem["icon"];
  iconStyle?: ListItem["iconStyle"];
  iconColor?: ListItem["iconColor"];
}

export interface IconPickerPanelProps {
  value: ListItem["icon"];
  style?: ListItem["iconStyle"];
  color?: ListItem["iconColor"];
  /** Called with just what changed. */
  onPick: (change: IconChange) => void;
}

/**
 * The icons of a row, with a search, groups, a colour and two ways of drawing.
 *
 * A hundred and thirty drawings in one grid is a wall, and a wall is a list you
 * scroll past instead of read. So: a search that finds the thing you are
 * describing, ten groups for when you are browsing, and a colour and a filled or
 * outlined drawing for when the twelve rows in a list all look the same.
 *
 * The search ignores accents and matches on the beginning of the words, because
 * that is what somebody does when they have forgotten the word: "pasti" finds
 * "pastilla". It is scored and not just filtered, so "pan" comes before
 * "pantalón" instead of the list being a wall of nearly-right answers.
 *
 * The colour is one of the ten the app offers, not a picker: an icon is a small
 * shape on a busy list and two reds at eighteen points look like one red.
 */
export function IconPickerPanel({
  value,
  style = "outline",
  color = "neutral",
  onPick,
}: IconPickerPanelProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ItemIconCategory | null>(null);
  const [drawing, setDrawing] = useState<ListItem["iconStyle"]>(style);
  const [tint, setTint] = useState<ListItem["iconColor"]>(color);

  const found = useMemo(
    () => searchIcons(query, { category: group }),
    [query, group],
  );

  const choose = (icon: ItemIcon) => onPick({ icon, iconStyle: drawing, iconColor: tint });

  return (
    <View style={{ gap: theme.spacing.md }}>
      <TextField
        testID="icon-search"
        label={t("icons.search")}
        value={query}
        onChangeText={setQuery}
        placeholder={t("icons.searchPlaceholder")}
        returnKeyType="search"
      />

      {/* How it is drawn, and in what colour: two lines of controls above the
          grid, because they apply to whatever you pick next and not to the icon
          you happened to be looking at. */}
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="caption" tone="subtle">
          {t("icons.drawing")}
        </AppText>
        <View style={[styles.row, { gap: theme.spacing.xs }]}>
          {(["outline", "fill"] as const).map((option) => {
            const active = drawing === option;
            return (
              <Pressable
                key={option}
                testID={`icon-style-${option}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(ICON_STYLE_LABEL[option])}
                onPress={() => {
                  setDrawing(option);
                  onPick({ iconStyle: option });
                }}
                style={({ pressed }) => [
                  styles.pill,
                  {
                    borderRadius: theme.radius.pill,
                    backgroundColor: active
                      ? theme.colors.accent
                      : theme.colors.surfaceMuted,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  style={{
                    color: active ? theme.colors.onAccent : theme.colors.textMuted,
                  }}
                >
                  {t(ICON_STYLE_LABEL[option])}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="caption" tone="subtle">
          {t("icons.color")}
        </AppText>
        <View style={[styles.row, { gap: theme.spacing.xs, flexWrap: "wrap" }]}>
          {ICON_COLOR_KEYS.map((option) => {
            const active = tint === option;
            return (
              <Pressable
                key={option}
                testID={`icon-color-${option}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(ICON_COLOR_LABEL[option])}
                onPress={() => {
                  setTint(option);
                  onPick({ iconColor: option });
                }}
                style={({ pressed }) => [
                  styles.swatch,
                  {
                    backgroundColor: iconColor(option),
                    borderColor: active
                      ? theme.colors.text
                      : "transparent",
                    borderWidth: active ? 3 : 0,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* The groups, and the first one open. A picker that starts closed is a
          picker you have to guess your way into. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, { gap: theme.spacing.xs, paddingVertical: 2 }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: group === null }}
          accessibilityLabel={t("icons.groupAll")}
          onPress={() => setGroup(null)}
          style={({ pressed }) => [
            styles.pill,
            {
              borderRadius: theme.radius.pill,
              backgroundColor:
                group === null ? theme.colors.accent : theme.colors.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <AppText
            variant="caption"
            style={{
              color: group === null ? theme.colors.onAccent : theme.colors.textMuted,
            }}
          >
            {t("icons.groupAll")}
          </AppText>
        </Pressable>
        {ITEM_ICON_CATEGORIES.map((category) => {
          const active = group === category;
          return (
            <Pressable
              key={category}
              testID={`icon-group-${category}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(ICON_GROUP_LABEL[category])}
              onPress={() => setGroup(active ? null : category)}
              style={({ pressed }) => [
                styles.pill,
                {
                  borderRadius: theme.radius.pill,
                  backgroundColor: active
                    ? theme.colors.accent
                    : theme.colors.surfaceMuted,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <AppText
                variant="caption"
                style={{
                  color: active ? theme.colors.onAccent : theme.colors.textMuted,
                }}
              >
                {t(ICON_GROUP_LABEL[category])}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {found.length === 0 ? (
        <AppText variant="body" tone="muted" style={{ paddingVertical: theme.spacing.lg }}>
          {t("icons.noneFound", { query })}
        </AppText>
      ) : (
        <View style={[styles.grid, { gap: theme.spacing.sm }]}>
          <IconCell
            glyph="close-circle-outline"
            label={t("icons.none")}
            selected={value === null}
            onPress={() => onPick({ icon: null })}
          />
          {found.map((icon) => (
            <IconCell
              key={icon}
              icon={icon}
              style={drawing}
              color={tint}
              label={iconLabel(icon)}
              selected={value === icon}
              onPress={() => choose(icon)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function IconCell({
  icon,
  style = "outline",
  color = "neutral",
  glyph: rawGlyph,
  label,
  selected,
  onPress,
}: {
  icon?: ItemIcon;
  style?: ListItem["iconStyle"];
  color?: ListItem["iconColor"];
  glyph?: Ionicon;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const glyph = icon ? (glyphOf(icon, style) as never) : rawGlyph;

  return (
    <Pressable
      testID={rawGlyph ? "icon-cell-none" : `icon-cell-${icon}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.iconCell, { opacity: pressed ? 0.7 : 1 }]}
    >
      {/* The selection is a border and not a different colour for the drawing.
          The colour is what you chose for this icon, and painting over it lost
          it: the grid said "red" and you could no longer tell which red, or
          which icon was the red one. A border leaves the drawing as it is and
          still says which one is chosen. */}
      <View
        style={[
          styles.iconBox,
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: theme.radius.md,
            // El borde ocupa su sitio siempre: si solo lo tiene el elegido, la
            // rejilla da un salto al elegir y el dibujo se mueve bajo el dedo.
            borderWidth: 2,
            borderColor: selected ? theme.colors.accent : "transparent",
          },
        ]}
      >
        <Ionicons name={glyph} size={22} color={iconColor(color)} />
      </View>
      <AppText variant="caption" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * The glyph of a row's icon, in the row's colour and its way of being drawn.
 *
 * Nothing when the row has no icon: an empty space where a picture should be is
 * the place the "add" sits, and drawing something there would be a lie about
 * what the row is.
 */
export function ItemIcon({
  icon,
  style = "outline",
  color = "neutral",
  size = 18,
}: {
  icon: ListItem["icon"];
  style?: ListItem["iconStyle"];
  color?: ListItem["iconColor"];
  size?: number;
}) {
  if (!isItemIcon(icon)) return null;
  return (
    <Ionicons
      name={glyphOf(icon, style) as never}
      size={size}
      color={iconColor(color)}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
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
  pill: {
    paddingHorizontal: 12,
    height: 30,
    justifyContent: "center",
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
});
