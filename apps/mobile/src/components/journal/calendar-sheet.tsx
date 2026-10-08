import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { formatMonthTitle, monthGrid, monthOfDay, todayKey, weekdayLabel } from "@/lib/journal/days";
import { useI18n, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * A month to pick a day from.
 *
 * Every day is selectable, the future as well as the past: a diary is also where
 * a plan for next week goes. A dot marks a day that already has words in it.
 */
export function CalendarSheet({
  visible,
  selectedDay,
  daysWithText,
  onPick,
  onClose,
}: {
  visible: boolean;
  selectedDay: string;
  daysWithText: Set<string>;
  onPick: (day: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const { locale } = useI18n();

  // The month on screen is its own state: moving through months must not move
  // the day the journal is showing.
  const [shown, setShown] = useState(() => monthOfDay(selectedDay));
  const weeks = useMemo(() => monthGrid(shown.year, shown.monthIndex), [shown]);
  const today = todayKey();

  const moveMonth = (delta: number) => {
    setShown((current) => {
      const index = current.year * 12 + current.monthIndex + delta;
      return { year: Math.floor(index / 12), monthIndex: index % 12 };
    });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("journal.pickDay")}>
      <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <MonthButton
            icon="chevron-back"
            label={t("journal.previousMonth")}
            onPress={() => moveMonth(-1)}
          />
          <AppText variant="bodyStrong" style={{ textTransform: "capitalize" }}>
            {formatMonthTitle(shown.year, shown.monthIndex, locale)}
          </AppText>
          <MonthButton
            icon="chevron-forward"
            label={t("journal.nextMonth")}
            onPress={() => moveMonth(1)}
          />
        </View>

        <View style={{ flexDirection: "row" }}>
          {Array.from({ length: 7 }, (_, index) => (
            <View key={index} style={{ flex: 1, alignItems: "center" }}>
              <AppText variant="caption" tone="subtle">
                {weekdayLabel(index, locale)}
              </AppText>
            </View>
          ))}
        </View>

        {weeks.map((week, row) => (
          <View key={row} style={{ flexDirection: "row" }}>
            {week.map((day, column) => {
              if (day === null) {
                return <View key={column} style={{ flex: 1, height: 44 }} />;
              }
              const selected = day === selectedDay;
              const isToday = day === today;
              const hasText = daysWithText.has(day);
              const dayNumber = Number(day.slice(8, 10));
              return (
                <Pressable
                  key={column}
                  accessibilityRole="button"
                  accessibilityLabel={day}
                  accessibilityState={{ selected }}
                  onPress={() => onPick(day)}
                  style={{
                    flex: 1,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: theme.radius.sm,
                    backgroundColor: selected ? theme.colors.accent : "transparent",
                    borderWidth: isToday && !selected ? 1 : 0,
                    borderColor: theme.colors.borderStrong,
                  }}
                >
                  <AppText
                    variant="body"
                    style={{
                      color: selected
                        ? theme.colors.onAccent
                        : theme.colors.text,
                    }}
                  >
                    {dayNumber}
                  </AppText>
                  {hasText ? (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 4,
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: selected ? theme.colors.onAccent : theme.colors.accent,
                      }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function MonthButton({
  icon,
  label,
  onPress,
}: {
  icon: "chevron-back" | "chevron-forward";
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 40,
        height: 40,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: theme.radius.sm,
      }}
    >
      <Ionicons name={icon} size={20} color={theme.colors.textMuted} />
    </Pressable>
  );
}
