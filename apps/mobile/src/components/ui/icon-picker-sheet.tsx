import { Ionicons } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import type { ListRenderItemInfo, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import type { IconColor, IconLibrary, IconRef, VectorIconCategory } from "@orbit-hub/contracts";
import {
  ITEM_ICON_COLORS,
  VECTOR_ICON_CATEGORY_LABEL,
  vectorGlyph,
} from "@orbit-hub/contracts";

import { useI18n, useTranslation } from "@/lib/i18n";
import { EMOJI_GROUP_LABELS, emojiGroupLabel } from "@/lib/icons/emoji-group-labels";
import {
  buildIconGrid,
  categoryAtOffset,
  firstRowWhere,
  initialTab,
  layoutOfRow,
  totalHeight,
} from "@/lib/icons/icon-grid";
import type { GridCell, GridRow } from "@/lib/icons/icon-grid";
import {
  RECENT_EMOJIS_KEY,
  parseRecentEmojis,
  withRecentEmoji,
} from "@/lib/icons/recent-emojis";
import { keyValueStore } from "@/lib/storage/key-value";
import { useTheme } from "@/theme";

import { AppText } from "./text";
import { Sheet } from "./sheet";
import { TextField } from "./text-field";

/**
 * What tapping a control in the picker changes, and the diff between two icons.
 *
 * Re-exported here so a screen opens one module for the panel and the merge. The
 * function lives in `lib/icons/icon-change`: no test in this repo renders a
 * component, so the testable part lives where it can be asked.
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

/** Columns for both grids, so a vector cell is the size of an emoji cell. */
const COLUMNS = 8;
/** The gap between cells, which sits outside the cell so cells stay square. */
const GAP = 4;
/** A category title row's height. Part of the scroll arithmetic, not a guess. */
const TITLE_HEIGHT = 30;

/**
 * Where the cell lands inside its slot.
 *
 * Eight columns on a 430pt phone is a 49pt cell. Below that the emoji stops being
 * readable, so the count drops instead of the cell shrinking: a grid of cells too
 * small to tell apart is a grid you cannot choose from.
 */
function columnsFor(width: number): number {
  if (width <= 0) return COLUMNS;
  const porTamano = Math.floor((width + GAP) / (44 + GAP));
  return Math.max(4, Math.min(COLUMNS, porTamano));
}

/**
 * The picker without its sheet around it, for panels that already are one.
 *
 * The item editor opens its icon page inside its own sheet: a sheet on top of
 * a sheet is two backdrops over one screen.
 */
export function IconPickerPanel({
  current,
  onSelect,
}: Pick<IconPickerSheetProps, "current" | "onSelect">) {
  return <IconPickerBody current={current} onSelect={onSelect} />;
}

export function IconPickerSheet({ visible, onClose, current, onSelect }: IconPickerSheetProps) {
  const t = useTranslation();
  return (
    // Not scrollable: the grid scrolls itself, and a panel that scrolls too means
    // two scroll views fighting over the same gesture.
    <Sheet visible={visible} onClose={onClose} title={t("icons.title")} scrollable={false}>
      <IconPickerBody current={current} onSelect={onSelect} />
    </Sheet>
  );
}

function IconPickerBody({
  current,
  onSelect,
}: Pick<IconPickerSheetProps, "current" | "onSelect">) {
  const theme = useTheme();
  const t = useTranslation();
  const { locale } = useI18n();
  const { height } = useWindowDimensions();

  // On the tab the chosen icon is on, not always emojis: see `initialTab`.
  const [tab, setTab] = useState<"emoji" | "vector">(() => initialTab(current));
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [drawing, setDrawing] = useState<"outline" | "fill">(
    current?.type === "vector" ? current.style : "outline",
  );
  const [tint, setTint] = useState<IconColor>(current?.color ?? "auto");
  const [recents, setRecents] = useState<string[]>(() =>
    parseRecentEmojis(keyValueStore.getJson(RECENT_EMOJIS_KEY)),
  );
  const [listWidth, setListWidth] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const lista = useRef<FlatList<GridRow>>(null);
  /*
    The category bar follows the list: when the lit category changes because the
    grid scrolled under it, the bar scrolls itself so the lit chip is on screen.
    Without this, deep in "Viajes y lugares" the bar still shows the start and
    the lit chip is somewhere off-screen to the right, saying nothing.
  */
  const barra = useRef<ScrollView>(null);
  const chipX = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const columns = columnsFor(listWidth);
  const cell = Math.max(24, Math.floor((listWidth - GAP * (columns + 1)) / columns));
  const rowHeight = cell + GAP;

  const pickEmoji = useCallback(
    (value: string) => {
      const siguiente = withRecentEmoji(recents, value);
      setRecents(siguiente);
      keyValueStore.set(RECENT_EMOJIS_KEY, JSON.stringify(siguiente));
      // `auto` and nothing else: an emoji is drawn by the operating system with
      // the colours it decides, and there is no picker that could change that.
      onSelect({ type: "emoji", value, color: "auto" });
    },
    [onSelect, recents],
  );

  const pickVector = useCallback(
    (key: string, library: IconLibrary) => {
      onSelect({ type: "vector", value: key, library, style: drawing, color: tint });
    },
    [drawing, onSelect, tint],
  );

  /* Titles only while browsing: nineteen results do not need nine headings. */
  const conTitulos = debounced.trim().length === 0;
  const grid = useMemo(
    () =>
      buildIconGrid(
        {
          kind: tab,
          query: debounced,
          columns,
          locale,
          onPickEmoji: pickEmoji,
          onPickVector: pickVector,
        },
        conTitulos ? "on" : "off",
      ),
    [columns, conTitulos, debounced, locale, pickEmoji, pickVector, tab],
  );

  /*
    What the grid calls the chosen icon, which is **not** what the row stored.
    A cell's id is always the outline glyph, and a row can hold any of the words
    that draw it — `azucar`, `sal` and `pimienta` all live on the cell
    `contenedor`. So the row's key is resolved to the cell's id before anything
    looks for it; without that, an icon somebody chose shows up unmarked and the
    panel opens at the top instead of on it.
  */
  const elegidoId =
    current?.type === "emoji"
      ? current.value
      : current?.type === "vector"
        ? `${current.library ?? "ionicons"}:${vectorGlyph(current.value, "outline", current.library ?? "ionicons")}`
        : null;

  const elegidaRow = useMemo(
    () => (elegidoId === null ? null : firstRowWhere(grid.rows, (c) => c.id === elegidoId)),
    [elegidoId, grid.rows],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const categoria = categoryAtOffset(
        grid.rows,
        event.nativeEvent.contentOffset.y,
        rowHeight,
        TITLE_HEIGHT,
      );
      // Only when it changes: `onScroll` fires per frame and a state update per
      // frame re-renders the list behind it.
      setActiveCategory((actual) => (actual === categoria ? actual : categoria));
    },
    [grid.rows, rowHeight],
  );

  const irA = useCallback(
    (category: string) => {
      const section = grid.sections.find((entry) => entry.category === category);
      if (!section) return;
      const { offset } = layoutOfRow(grid.rows, section.firstRow, rowHeight, TITLE_HEIGHT);
      lista.current?.scrollToOffset({ offset, animated: true });
      setActiveCategory(category);
    },
    [grid.rows, grid.sections, rowHeight],
  );

  /*
    The bar scrolls to the lit chip, and only when the lit chip changes. `onScroll`
    fires per frame, so doing it there would fight the finger dragging the bar
    itself; doing it here runs once per category. Scrolling the bar never loops
    back: it is a different scroll view and nothing reads its offset.
  */
  useEffect(() => {
    if (!activeCategory) return;
    const x = chipX.current[activeCategory];
    if (x === undefined) return;
    barra.current?.scrollTo({ x: Math.max(0, x - 12), animated: true });
  }, [activeCategory]);

  /*
    Where the list opens: on the icon that is already chosen, or at the top.
    *
    * Opening at the top when somebody comes back to change one thing means finding
    * it among 1914 again. `scrollToIndex` is exact because every row's height is
    * known before it is rendered. With nothing chosen, or chosen in the other tab,
    * it starts at the top.
    */
  useEffect(() => {
    if (elegidaRow !== null && elegidaRow > 0) {
      lista.current?.scrollToIndex({ index: elegidaRow, animated: false, viewPosition: 0.15 });
      const fila = grid.rows[elegidaRow];
      if (fila) setActiveCategory(fila.category);
      return;
    }
    lista.current?.scrollToOffset({ offset: 0, animated: false });
    setActiveCategory(grid.sections[0]?.category ?? null);
  }, [elegidaRow, grid.rows, grid.sections, tab]);

  /**
   * Every row's height, known before anything is rendered.
   *
   * This is the whole scroll. With `numColumns` the web measured the rows as they
   * mounted, so the content height only ever described what was on screen: the bar
   * lied, the end of the list was unreachable, and the list grew while you read
   * it. Chunking the rows here makes the total height arithmetic.
   */
  const getItemLayout = useCallback(
    (_data: ArrayLike<GridRow> | null | undefined, index: number) => ({
      ...layoutOfRow(grid.rows, index, rowHeight, TITLE_HEIGHT),
      index,
    }),
    [grid.rows, rowHeight],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GridRow>) => {
      if (item.type === "header") {
        return (
          <View
            testID={`icon-title-${item.category}`}
            style={[styles.titleRow, { height: TITLE_HEIGHT }]}
          >
            <AppText variant="caption" tone="muted">
              {categoryLabel(item.category)}
            </AppText>
          </View>
        );
      }

      return (
        <View style={[styles.cellRow, { height: rowHeight, paddingHorizontal: GAP / 2 }]}>
          {item.cells.map((celda) => (
            <Cell
              key={celda.id}
              cell={celda}
              size={cell}
              drawing={drawing}
              tint={tint}
              elegido={celda.id === elegidoId}
            />
          ))}
        </View>
      );
    },
    [cell, drawing, elegidoId, rowHeight, tint],
  );

  const vacio = grid.cells.length === 0;
  const alto = Math.max(
    140,
    Math.min(totalHeight(grid.rows, rowHeight, TITLE_HEIGHT), Math.round(height * 0.46)),
  );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {/* Tabs. Emojis first, because that is what somebody comes for. */}
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

      {/* Only on vectors. A system emoji is painted by the operating system in the
          colours it picks, so a colour row above them is a promise nothing can keep,
          and "filled or outline" is a question about a line drawing. */}
      {tab === "vector" ? (
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("icons.drawing")}
            </AppText>
            <View style={[styles.row, { gap: theme.spacing.xs }]}>
              {(["outline", "fill"] as const).map((option) => (
                <Chip
                  key={option}
                  testID={`icon-style-${option}`}
                  label={t(option === "outline" ? "icons.style.outline" : "icons.style.fill")}
                  active={drawing === option}
                  onPress={() => setDrawing(option)}
                />
              ))}
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
                    accessibilityLabel={t(`icons.colors.${option}`)}
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
        </View>
      ) : null}

      <TextField
        testID={tab === "emoji" ? "emoji-search" : "icon-search"}
        label={t("icons.search")}
        value={query}
        onChangeText={setQuery}
        placeholder={t("icons.searchPlaceholder")}
        returnKeyType="search"
      />

      {/* Recents: a shortcut, above the bar and outside the grid. */}
      {tab === "emoji" && recents.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.row, { gap: theme.spacing.xs }]}
        >
          {recents.map((emoji) => (
            <Pressable
              key={emoji}
              testID={`emoji-recent-${emoji}`}
              accessibilityRole="button"
              accessibilityLabel={emoji}
              onPress={() => pickEmoji(emoji)}
              style={({ pressed }) => [
                styles.cell,
                {
                  width: cell,
                  height: cell,
                  margin: 0,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceMuted,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <AppText style={{ fontSize: Math.round(cell * 0.58) }}>{emoji}</AppText>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* The category bar. It navigates, it does not filter: everything is already
          in the list below, and the lit one says which stretch is on screen. */}
      {grid.sections.length > 0 ? (
        <ScrollView
          ref={barra}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.row, { gap: theme.spacing.xs }]}
        >
          {grid.sections.map((section) => (
            <Chip
              key={section.category}
              testID={`icon-group-${section.category}`}
              label={categoryLabel(section.category)}
              active={activeCategory === section.category}
              onPress={() => irA(section.category)}
              onLayoutX={(x) => {
                chipX.current[section.category] = x;
              }}
            />
          ))}
        </ScrollView>
      ) : null}

      {vacio ? (
        <AppText variant="body" tone="muted" style={{ paddingVertical: theme.spacing.lg }}>
          {t("icons.noneFound", { query: debounced })}
        </AppText>
      ) : (
        <View onLayout={(event) => setListWidth(event.nativeEvent.layout.width)} style={{ height: alto }}>
          <FlatList
            ref={lista}
            testID={`icon-grid-${tab}`}
            data={grid.rows}
            key={`${tab}-${columns}`}
            keyExtractor={(row, index) =>
              row.type === "header" ? `t:${row.category}` : `c:${row.category}:${index}`
            }
            getItemLayout={getItemLayout}
            renderItem={renderItem}
            onScroll={onScroll}
            scrollEventThrottle={32}
            showsVerticalScrollIndicator
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={11}
          />
        </View>
      )}

      {current ? (
        <Pressable
          testID="icon-cell-none"
          accessibilityRole="button"
          onPress={() => onSelect(null)}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <AppText variant="body" tone="muted">
            {t("icons.none")}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Cell({
  cell,
  size,
  drawing,
  tint,
  elegido,
}: {
  cell: GridCell;
  size: number;
  drawing: "outline" | "fill";
  tint: IconColor;
  /** Whether this cell is the icon the row already carries. */
  elegido: boolean;
}) {
  const theme = useTheme();
  if (cell.placeholder) return <View style={{ width: size, height: size }} />;

  const esVector = cell.category in VECTOR_ICON_CATEGORY_LABEL;
  return (
    <Pressable
      testID={`${esVector ? "icon-cell" : "emoji-cell"}-${cell.value}`}
      accessibilityRole="button"
      accessibilityState={{ selected: elegido }}
      accessibilityLabel={cell.label}
      disabled={!cell.onPick}
      onPress={cell.onPick}
      style={({ pressed }) => [
        styles.cell,
        {
          width: size,
          height: size,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceMuted,
          // A border and not the colour: the colour is what was chosen for the
          // icon, and marking with it spends it.
          borderColor: elegido ? theme.colors.text : "transparent",
          borderWidth: elegido ? 2 : 0,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {esVector ? (
        <VectorCellGlyph cell={cell} drawing={drawing} size={size} tint={tint} />
      ) : (
        <AppText style={{ fontSize: Math.round(size * 0.58) }}>{cell.id}</AppText>
      )}
    </Pressable>
  );
}

/**
 * The drawing of one grid cell, in the font it comes from.
 *
 * Ionicons and MaterialCommunityIcons are two different components over two
 * different fonts: asking one for the other's glyph draws nothing and says
 * nothing. The cell knows which one it is, because the grid built it from a
 * drawing that knows.
 */
function VectorCellGlyph({
  cell,
  drawing,
  size,
  tint,
}: {
  cell: GridCell;
  drawing: "outline" | "fill";
  size: number;
  tint: IconColor;
}) {
  // No testID here: the Pressable around it already carries `icon-cell-<key>`,
  // and two elements answering the same testID makes every harness tap the
  // first one — which is the 24px glyph instead of the 49px cell.
  const theme = useTheme();
  if (!cell.library || cell.library === "ionicons") {
    return (
      <Ionicons
        name={vectorGlyph(cell.value!, drawing, "ionicons") as keyof typeof Ionicons.glyphMap}
        size={Math.round(size * 0.56)}
        color={theme.colors.icon[tint]}
      />
    );
  }
  return (
    <MaterialCommunityIcons
      name={vectorGlyph(cell.value!, drawing, "material") as keyof typeof MaterialCommunityIcons.glyphMap}
      size={Math.round(size * 0.56)}
      color={theme.colors.icon[tint]}
    />
  );
}

/**
 * The name of a category, in the language of the app.
 *
 * The two sets come from different places and neither one is the dictionary. The
 * vector categories are the contract's own and it labels all eleven — a `Record`
 * over the union, so a new one without a name is a compile error. The emoji groups
 * are Unicode's, in English, and carry a Spanish name beside them.
 */
function categoryLabel(category: string): string {
  if (category in VECTOR_ICON_CATEGORY_LABEL) {
    return VECTOR_ICON_CATEGORY_LABEL[category as VectorIconCategory];
  }
  if (category in EMOJI_GROUP_LABELS) return emojiGroupLabel(category);
  return category;
}

function Chip({
  label,
  active,
  onPress,
  testID,
  onLayoutX,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  /** Where the chip sits inside the bar, so the bar can scroll to it. */
  onLayoutX?: (x: number) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onLayout={(event) => onLayoutX?.(event.nativeEvent.layout.x)}
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
      <AppText
        variant="caption"
        style={{ color: active ? theme.colors.onAccent : theme.colors.textMuted }}
      >
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
  cell: { justifyContent: "center", alignItems: "center", overflow: "hidden" },
  cellRow: { flexDirection: "row" },
  titleRow: { justifyContent: "flex-end", paddingBottom: 6 },
});
