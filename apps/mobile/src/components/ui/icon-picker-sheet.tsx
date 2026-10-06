import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { IconColor, IconRef, VectorIconCategory } from "@orbit-hub/contracts";
import {
  ITEM_ICON_COLORS,
  VECTOR_ICON_CATEGORIES,
  VECTOR_ICON_CATEGORY_LABEL,
  vectorGlyph,
} from "@orbit-hub/contracts";

import { useTranslation } from "@/lib/i18n";
import { EMOJI_GROUPS } from "@/lib/icons/emoji-catalog.generated";import {
  RECENT_EMOJIS_KEY,
  parseRecentEmojis,
  withRecentEmoji,
} from "@/lib/icons/recent-emojis";
import { searchEmojis } from "@/lib/icons/search-emoji";
import { keyValueStore } from "@/lib/storage/key-value";
import { searchVectors } from "@/lib/icons/search-vectors";
import { useTheme } from "@/theme";
import { resolveAppIcon } from "@/lib/icons/resolve-icon";

import { AppText } from "./text";
import { Sheet } from "./sheet";
import { TextField } from "./text-field";

/**
 * What tapping a control in the picker changes, and the diff between two icons.
 *
 * Re-exported here so a screen opens one module for the panel and the merge.
 * The function lives in `lib/icons/icon-change`: no test in this repo renders
 * a component, so the testable part lives where it can be asked.
 */
export { iconChange } from "@/lib/icons/icon-change";
export type { IconChange } from "@/lib/icons/icon-change";

export interface IconPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  current?: IconRef | null;
  /** Called with the whole icon somebody chose, or null for "no icon". */
  onSelect: (icon: IconRef | null) => void;
}

/**
 * The icon somebody chose, emojis and line drawings in one place.
 *
 * Two tabs because they are two different catalogues searched two different
 * ways: emojis by what they mean, drawings by the word somebody would type.
 * The style and the colour sit above both, because they apply to whatever is
 * picked next and not to the cell that happens to be looked at.
 *
 * The chosen cell is marked with a border and not with the colour: the colour
 * is what was chosen for the icon, and marking with it spent it.
 */
export function IconPickerSheet({ visible, onClose, current, onSelect }: IconPickerSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [tab, setTab] = useState<"emoji" | "vector">("emoji");
  const [emojiQuery, setEmojiQuery] = useState("");
  const [emojiQueryDebounced, setEmojiQueryDebounced] = useState("");
  const [emojiGroup, setEmojiGroup] = useState<string | null>(null);
  const [vectorQuery, setVectorQuery] = useState("");
  const [vectorGroup, setVectorGroup] = useState<VectorIconCategory | null>(null);
  const [drawing, setDrawing] = useState<"outline" | "fill">(
    current?.type === "vector" ? current.style : "outline",
  );
  const [tint, setTint] = useState<IconColor>(current?.color ?? "auto");
  const [recents, setRecents] = useState<string[]>(() =>
    parseRecentEmojis(keyValueStore.getJson(RECENT_EMOJIS_KEY)),
  );

  useEffect(() => {
    const timer = setTimeout(() => setEmojiQueryDebounced(emojiQuery), 250);
    return () => clearTimeout(timer);
  }, [emojiQuery]);

  const emojis = useMemo(
    () => searchEmojis(emojiQueryDebounced, { group: emojiGroup ?? undefined, limit: 240 }),
    [emojiQueryDebounced, emojiGroup],
  );

  const vectors = useMemo(
    () => searchVectors(vectorQuery, { category: vectorGroup, limit: 240 }),
    [vectorQuery, vectorGroup],
  );

  const pickEmoji = (value: string) => {
    const next = withRecentEmoji(recents, value);
    setRecents(next);
    keyValueStore.set(RECENT_EMOJIS_KEY, JSON.stringify(next));
    onSelect({ type: "emoji", value, color: tint });
  };

  const pickVector = (key: string) => {
    onSelect({ type: "vector", value: key, library: "ionicons", style: drawing, color: tint });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("icons.title")} scrollable>
      <View style={{ gap: theme.spacing.md }}>
        <View style={[styles.row, { gap: theme.spacing.xs }]}>
          {(["emoji", "vector"] as const).map((option) => {
            const active = tab === option;
            return (
              <Pressable
                key={option}
                testID={`icon-tab-${option}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(option)}
                style={({ pressed }) => [
                  styles.tab,
                  {
                    borderRadius: theme.radius.pill,
                    backgroundColor: active ? theme.colors.accent : theme.colors.surfaceMuted,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  style={{ color: active ? theme.colors.onAccent : theme.colors.textMuted }}
                >
                  {t(option === "emoji" ? "icons.tabEmoji" : "icons.tabVector")}
                </AppText>
              </Pressable>
            );
          })}
        </View>

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
                  accessibilityLabel={t(option === "outline" ? "icons.style.outline" : "icons.style.fill")}
                  onPress={() => setDrawing(option)}
                  style={({ pressed }) => [
                    styles.pill,
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: active ? theme.colors.accent : theme.colors.surfaceMuted,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    style={{ color: active ? theme.colors.onAccent : theme.colors.textMuted }}
                  >
                    {t(option === "outline" ? "icons.style.outline" : "icons.style.fill")}
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
            {(["auto", ...ITEM_ICON_COLORS] as const).map((option) => {
              const active = tint === option;
              return (
                <Pressable
                  key={option}
                  testID={`icon-color-${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTint(option)}
                  style={({ pressed }) => [
                    styles.swatch,
                    {
                      backgroundColor: theme.colors.icon[option],
                      borderColor: active ? theme.colors.text : "transparent",
                      borderWidth: active ? 3 : 0,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>

        {tab === "emoji" ? (
          <View style={{ gap: theme.spacing.sm }}>
            <TextField
              testID="emoji-search"
              label={t("icons.search")}
              value={emojiQuery}
              onChangeText={setEmojiQuery}
              placeholder={t("icons.searchPlaceholder")}
              returnKeyType="search"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.row, { gap: theme.spacing.xs, paddingVertical: 2 }]}
            >
              {recents.length > 0 && (
                <GroupChip
                  label={t("icons.recent")}
                  active={emojiGroup === null && emojiQueryDebounced === ""}
                  onPress={() => {
                    setEmojiGroup(null);
                    setEmojiQuery("");
                  }}
                />
              )}
              {EMOJI_GROUPS.map((group) => (
                <GroupChip
                  key={group}
                  label={group}
                  active={emojiGroup === group}
                  onPress={() => setEmojiGroup(emojiGroup === group ? null : group)}
                />
              ))}
            </ScrollView>
            {emojis.length === 0 ? (
              <AppText variant="body" tone="muted" style={{ paddingVertical: theme.spacing.lg }}>
                {t("icons.noneFound", { query: emojiQueryDebounced })}
              </AppText>
            ) : (
              <FlatList
                data={emojis}
                keyExtractor={(entry) => entry.emoji}
                numColumns={8}
                scrollEnabled={false}
                renderItem={({ item: entry }) => {
                  const selected = current?.type === "emoji" && current.value === entry.emoji;
                  return (
                    <Pressable
                      testID={`emoji-cell-${entry.emoji}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={entry.name}
                      onPress={() => pickEmoji(entry.emoji)}
                      style={({ pressed }) => [
                        styles.cell,
                        {
                          backgroundColor: theme.colors.surfaceMuted,
                          borderRadius: theme.radius.md,
                          borderColor: selected ? theme.colors.text : "transparent",
                          borderWidth: selected ? 2 : 0,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <AppText style={{ fontSize: 26 }}>{entry.emoji}</AppText>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <TextField
              testID="icon-search"
              label={t("icons.search")}
              value={vectorQuery}
              onChangeText={setVectorQuery}
              placeholder={t("icons.searchPlaceholder")}
              returnKeyType="search"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.row, { gap: theme.spacing.xs, paddingVertical: 2 }]}
            >
              <GroupChip
                label={t("icons.groupAll")}
                active={vectorGroup === null}
                onPress={() => setVectorGroup(null)}
              />
              {VECTOR_ICON_CATEGORIES.map((category) => (
                <GroupChip
                  key={category}
                  label={VECTOR_ICON_CATEGORY_LABEL[category]}
                  active={vectorGroup === category}
                  onPress={() => setVectorGroup(vectorGroup === category ? null : category)}
                />
              ))}
            </ScrollView>
            {vectors.length === 0 ? (
              <AppText variant="body" tone="muted" style={{ paddingVertical: theme.spacing.lg }}>
                {t("icons.noneFound", { query: vectorQuery })}
              </AppText>
            ) : (
              <FlatList
                data={vectors}
                keyExtractor={(key) => key}
                numColumns={4}
                scrollEnabled={false}
                renderItem={({ item: key }) => {
                  const glyph = vectorGlyph(key, drawing);
                  const selected = current?.type === "vector" && current.value === key;
                  const resolved = resolveAppIcon(
                    { type: "vector", value: key, library: "ionicons", style: drawing, color: tint },
                    theme.scheme,
                  );
                  return (
                    <Pressable
                      testID={`icon-cell-${key}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => pickVector(key)}
                      style={({ pressed }) => [
                        styles.vectorCell,
                        {
                          backgroundColor: theme.colors.surfaceMuted,
                          borderRadius: theme.radius.md,
                          borderColor: selected ? theme.colors.text : "transparent",
                          borderWidth: selected ? 2 : 0,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      {glyph && resolved?.kind === "vector" ? (
                        <Ionicons name={glyph as keyof typeof Ionicons.glyphMap} size={24} color={resolved.color} />
                      ) : null}
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        )}

        {current ? (
          <Pressable
            testID="icon-cell-none"
            accessibilityRole="button"
            onPress={() => onSelect(null)}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, paddingVertical: theme.spacing.sm }]}
          >
            <AppText variant="body" tone="muted">
              {t("icons.none")}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}

function GroupChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          borderRadius: theme.radius.pill,
          backgroundColor: active ? theme.colors.accent : theme.colors.surfaceMuted,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <AppText variant="caption" style={{ color: active ? theme.colors.onAccent : theme.colors.textMuted }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  pill: { paddingHorizontal: 14, paddingVertical: 8 },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  cell: { flex: 1, aspectRatio: 1, justifyContent: "center", alignItems: "center", margin: 3 },
  vectorCell: { flex: 1, aspectRatio: 1, justifyContent: "center", alignItems: "center", margin: 4 },
});
