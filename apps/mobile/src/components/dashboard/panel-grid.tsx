import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { DashboardWidget } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { AppText } from "@/components/ui/text";
import { pluralKey, useTranslation } from "@/lib/i18n";
import {
  PANEL_COLUMNS,
  cardSize,
  moveCard,
  panelCards,
  resizeCard,
} from "@/lib/dashboard/grid";
import { cardColors } from "@/lib/workspace/color";
import { useTheme } from "@/theme";

/** How many cells wide and tall a card can be. */
/**
 * How many rows the empty panel draws.
 *
 * Two, because the panel is a column of a phone and a band of a laptop, and one
 * row says nothing about either. Two rows of ghosts already show the shape
 * without turning a panel nobody has filled into a poster.
 */
const EMPTY_ROWS = 2;

/**
 * How wide an empty cell is drawn, in the fine grid of twelve columns.
 *
 * The panel is placed in a grid of twelve columns so a card can be one wide, two,
 * three or half, and that grid is for placing, not for looking at. Drawn as it
 * is, an empty panel is twenty-four slivers of 26 px: a spreadsheet, and nothing
 * like the panel you are about to fill. A card of three columns is a third of the
 * width, which is what a card actually is.
 */
const EMPTY_CELL_COLUMNS = 3;
const EMPTY_CELLS = 4;

const SIZES = [
  { w: 3, h: 1 },
  { w: 4, h: 1 },
  { w: 4, h: 2 },
  { w: 6, h: 2 },
  { w: 6, h: 3 },
  { w: 12, h: 2 },
] as const;

export interface PanelGridProps {
  layout: DashboardWidget[];
  /** Which space each card belongs to, so it can be painted with its colour. */
  colorOfWidget: (widget: DashboardWidget) => string;
  /** The name of that space, for the card while the panel is being arranged. */
  whereOfWidget: (widget: DashboardWidget) => string;
  /** What each card says, and where it goes when it is tapped. */
  describe: (widget: DashboardWidget) => {
    title: string;
    subtitle: string;
    emoji: string | null;
    href: string | null;
  };
  /** The changes while the panel is being arranged, and the save at the end. */
  onChange: (next: DashboardWidget[]) => void;
  onSave: () => void;
  saving?: boolean;
  /** How many lists are not on the panel yet, for the add card. */
  availableCount: number;
  /** Opens the list of things that can be added. */
  onOpenEditor: () => void;
  /** Goes where a card says when it is tapped. */
  onOpen: (href: string) => void;
}

/**
 * The panel: a grid of cards that the person arranges themselves.
 *
 * The cards are the size of a number of grid cells and the order they are in is
 * the arrangement; where each one sits is worked out from those two things and
 * not stored, because the same panel is looked at on a phone and on a laptop and
 * a position in pixels is only true on the screen it was set on.
 *
 * Arranging is a mode, the way it is in the old app: a pencil in the corner
 * turns it on, and a Guardar button that was not there before turns it off and
 * writes. Outside the mode the cards are just cards and a tap goes where the
 * card says, because a panel you cannot tap your way through is a poster.
 */
export function PanelGrid({
  layout,
  colorOfWidget,
  whereOfWidget,
  describe,
  onChange,
  onSave,
  saving = false,
  availableCount,
  onOpenEditor,
  onOpen,
}: PanelGridProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layout);
  const [selected, setSelected] = useState<string | null>(null);

  // Arranging starts from what is saved, so leaving without saving throws the
  // experiment away instead of leaving a panel nobody meant to change.
  useEffect(() => {
    if (!editing) setDraft(layout);
  }, [layout, editing]);

  const { cards, hidden } = useMemo(() => panelCards(draft), [draft]);
  const selectedCard = selected
    ? (draft.find((widget) => widget.id === selected) ?? null)
    : null;
  const indexOf = (id: string) => draft.findIndex((widget) => widget.id === id);
  const gap = theme.spacing.sm;
  const [width, setWidth] = useState(0);
  const cellWidth =
    width > 0 ? (width - gap * (PANEL_COLUMNS - 1)) / PANEL_COLUMNS : 0;
  // A cell is a little taller than it is wide, which is what makes a card a
  // block of a sensible shape on a phone and a wide band on a laptop. Taller
  // than that and a card of four rows is a column of empty colour.
  const cellHeight = Math.max(64, Math.round(cellWidth * 1.1));

  const apply = useCallback(
    (next: DashboardWidget[]) => {
      setDraft(next);
      onChange(next);
    },
    [onChange],
  );

  const sizeOf = useCallback(
    (id: string) =>
      cardSize(
        draft.find((widget) => widget.id === id) ?? ({} as DashboardWidget),
      ),
    [draft],
  );

  const pistaEdit = useA11yHint(t("dashboard.editLayoutHint"));
  const pistaAdd = useA11yHint(t("dashboard.addCardHint"));

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <View style={styles.flex}>
          <AppText variant="callout" tone="muted">
            {editing ? t("dashboard.editingHint") : t("dashboard.subtitle")}
          </AppText>
        </View>

        {editing ? (
          <Button
            label={t("dashboard.saveLayout")}
            icon="checkmark"
            size="sm"
            fullWidth={false}
            loading={saving}
            onPress={() => {
              setEditing(false);
              setSelected(null);
              onSave();
            }}
          />
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.editLayout")}
              {...pistaEdit.props}
              onPress={() => setEditing(true)}
              style={({ pressed }) => [
                styles.iconButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons
                name="create-outline"
                size={18}
                color={theme.colors.text}
              />
            </Pressable>
            {pistaEdit.node}
          </>
        )}
      </View>

      {/* El panel se dibuja siempre, y vacio se dibuja con su forma. Antes, sin
          tarjetas, no habia nada: un aviso de que estaba vacio y ya. Pero lo que
          se va a anadir es una rejilla, y una rejilla que solo se ve cuando ya
          tiene algo dentro no explica nada —ni como queda, ni cuanto cabe, ni
          por donde se empieza a poner. La casilla fantasia dice las tres cosas
          sin una palabra. */}
      {cards.length === 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <View
            testID="panel-empty-grid"
            accessibilityLabel={t("dashboard.empty")}
            style={[
              styles.grid,
              {
                // Las casillas son absolutas, asi que el contenedor no crece con
                // ellas: sin esta altura, la leyenda de abajo se monta encima de
                // la primera fila.
                height: EMPTY_ROWS * (cellHeight + gap) - gap,
              },
            ]}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          >
            {Array.from({ length: EMPTY_CELLS }).map((_, index) => (
              <View
                key={`fantasia-${index}`}
                style={[
                  styles.cell,
                  {
                    left:
                      (index % 2) *
                      (EMPTY_CELL_COLUMNS * cellWidth +
                        (EMPTY_CELL_COLUMNS - 1) * gap),
                    top: Math.floor(index / 2) * (cellHeight + gap),
                    width:
                      EMPTY_CELL_COLUMNS * cellWidth +
                      (EMPTY_CELL_COLUMNS - 1) * gap,
                    height: cellHeight,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}

      {cards.length > 0 ? (
        <View
          style={styles.grid}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          {cards.map((card) => {
            const widget = draft.find((row) => row.id === card.id);
            if (!widget) return null;
            const info = describe(widget);
            const colors = cardColors(colorOfWidget(widget));
            const isSelected = selected === widget.id;

            return (
              <View
                key={widget.id}
                style={[
                  styles.cell,
                  {
                    left: card.x * (cellWidth + gap),
                    top: card.y * (cellHeight + gap),
                    width: card.w * cellWidth + (card.w - 1) * gap,
                    height: card.h * cellHeight + (card.h - 1) * gap,
                  },
                ]}
              >
                <PanelCard
                  title={info.title}
                  subtitle={info.subtitle}
                  emoji={info.emoji}
                  colors={colors}
                  where={whereOfWidget(widget)}
                  editing={editing}
                  selected={isSelected}
                  compact={card.h < 2}
                  onPress={() => {
                    if (editing) setSelected(isSelected ? null : widget.id);
                    else if (info.href) onOpen(info.href);
                  }}
                />
              </View>
            );
          })}
        </View>
      ) : null}

      {editing && selectedCard ? (
        <Card variant="muted" style={{ gap: theme.spacing.sm }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {describe(selectedCard).title}
          </AppText>

          <View style={{ gap: theme.spacing.xxs }}>
            <AppText variant="caption" tone="subtle">
              {t("dashboard.sizeLabel")}
            </AppText>
            <View
              style={[styles.row, { gap: theme.spacing.xs, flexWrap: "wrap" }]}
            >
              {SIZES.map((size) => {
                const current = sizeOf(selectedCard.id);
                const active = current.w === size.w && current.h === size.h;
                return (
                  <Pressable
                    key={`${size.w}x${size.h}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("dashboard.setSize", {
                      w: size.w,
                      h: size.h,
                    })}
                    accessibilityState={{ selected: active }}
                    onPress={() =>
                      apply(resizeCard(draft, selectedCard.id, size))
                    }
                    style={({ pressed }) => [
                      styles.sizePill,
                      {
                        backgroundColor: active
                          ? theme.colors.accent
                          : theme.colors.surface,
                        borderColor: theme.colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <AppText
                      variant="caption"
                      style={{
                        color: active
                          ? theme.colors.onAccent
                          : theme.colors.text,
                      }}
                    >
                      {size.w}×{size.h}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Button
              label={t("dashboard.moveEarlier")}
              icon="arrow-back"
              size="sm"
              variant="secondary"
              fullWidth={false}
              onPress={() =>
                apply(
                  moveCard(
                    draft,
                    selectedCard.id,
                    indexOf(selectedCard.id) - 1,
                  ),
                )
              }
            />
            <Button
              label={t("dashboard.moveLater")}
              icon="arrow-forward"
              size="sm"
              variant="secondary"
              fullWidth={false}
              onPress={() =>
                apply(
                  moveCard(
                    draft,
                    selectedCard.id,
                    indexOf(selectedCard.id) + 1,
                  ),
                )
              }
            />
            <View style={styles.flex} />
            <Button
              label={t("common.done")}
              size="sm"
              onPress={() => setSelected(null)}
            />
          </View>
        </Card>
      ) : null}

      {availableCount > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("dashboard.addCard")}
            {...pistaAdd.props}
            onPress={onOpenEditor}
            style={({ pressed }) => [
              styles.addCard,
              {
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surfaceMuted,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="add" size={20} color={theme.colors.textMuted} />
            <AppText variant="bodyStrong" tone="muted">
              {t("dashboard.addCard")}
            </AppText>
            <AppText variant="caption" tone="subtle">
              {t(pluralKey("dashboard.cardsAvailable", availableCount), {
                count: availableCount,
              })}
            </AppText>
          </Pressable>
          {pistaAdd.node}
        </>
      ) : null}

      {hidden.length > 0 ? (
        <AppText variant="caption" tone="subtle">
          {t("dashboard.tooBig", { count: hidden.length })}
        </AppText>
      ) : null}
    </View>
  );
}

function PanelCard({
  title,
  subtitle,
  emoji,
  colors,
  where,
  editing,
  selected,
  compact,
  onPress,
}: {
  title: string;
  subtitle: string;
  emoji: string | null;
  colors: {
    background: string;
    foreground: string;
    border: string;
    muted: string;
  };
  /** Which space it is in, shown while the panel is being arranged. */
  where: string;
  editing: boolean;
  selected: boolean;
  /** A card of one row has room for the name and nothing else. */
  compact: boolean;
  onPress: () => void;
}) {
  // The hint is the space while the panel is being arranged and the subtitle
  // otherwise, and the node is a sibling rather than a wrapper: the `Pressable`
  // is the root of this component and it is `flex: 1` inside an absolutely
  // positioned cell, which a `View` around it would take away.
  const pista = useA11yHint(editing ? where : subtitle);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        {...pista.props}
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.background,
            borderColor: selected ? colors.foreground : colors.border,
            borderWidth: selected ? 3 : 1,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {/* The emoji when the list has one, nothing when it does not: the card is
            already painted with the colour of the space, so a dot of that same
            colour beside the name would say nothing at all. A card of one row has
            not even room for the emoji. */}
        {emoji && !compact ? <AppText variant="title">{emoji}</AppText> : null}

        <AppText
          variant="bodyStrong"
          numberOfLines={compact ? 1 : 3}
          style={{ color: colors.foreground, flexShrink: 1 }}
        >
          {title}
        </AppText>

        {/* A card of one row has room for the name and nothing else, and a second
            line in it is a line cut in half. */}
        {compact ? null : (
          <>
            <View style={styles.spacer} />
            <AppText
              variant="caption"
              style={{ color: colors.muted }}
              numberOfLines={1}
            >
              {editing ? where : subtitle}
            </AppText>
          </>
        )}
      </Pressable>
      {pista.node}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    position: "relative",
    width: "100%",
  },
  cell: {
    position: "absolute",
  },
  card: {
    flex: 1,
    gap: 4,
    padding: 10,
    borderRadius: 12,
  },
  spacer: {
    flex: 1,
    minHeight: 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
  },
  addCard: {
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
  },
  sizePill: {
    minWidth: 40,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
