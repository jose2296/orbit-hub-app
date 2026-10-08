import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { formatMonthTitle, monthGrid, monthOfDay, todayKey, weekdayLabel } from "@/lib/journal/days";
import { useI18n, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** Which view the sheet shows: the days of a month, or the months of a year. */
type CalendarView = "days" | "months";

/**
 * A day to pick from.
 *
 * The month title is a button: it opens the months of the year, and the year can be
 * stepped from there, which is how a day a long way off is reached without tapping
 * through every month. Every day is selectable, the future as well as the past. A
 * dot marks a day that already has words in it, and today is ringed and bold.
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
  const today = todayKey();

  // The month and the mode are the sheet's own, and start from the selected day
  // every time it opens, so a month left open last time is not the one shown now.
  const [shown, setShown] = useState(() => monthOfDay(selectedDay));
  const [mode, setMode] = useState<CalendarView>("days");
  useEffect(() => {
    if (visible) {
      setShown(monthOfDay(selectedDay));
      setMode("days");
    }
  }, [visible, selectedDay]);

  const weeks = useMemo(() => monthGrid(shown.year, shown.monthIndex), [shown]);

  const moveMonth = (delta: number) => {
    setShown((current) => {
      const index = current.year * 12 + current.monthIndex + delta;
      return { year: Math.floor(index / 12), monthIndex: index % 12 };
    });
  };
  const moveYear = (delta: number) => {
    setShown((current) => ({ ...current, year: current.year + delta }));
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("journal.pickDay")}>
      <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <NavButton
            icon="chevron-back"
            label={mode === "days" ? t("journal.previousMonth") : t("journal.previousYear")}
            onPress={() => (mode === "days" ? moveMonth(-1) : moveYear(-1))}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mode === "days" ? t("journal.pickYear") : t("journal.pickMonth")}
            onPress={() => setMode((current) => (current === "days" ? "months" : "days"))}
            hitSlop={6}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: theme.spacing.sm,
              height: 36,
              borderRadius: theme.radius.sm,
              backgroundColor: pressed ? theme.colors.surfaceSunken : "transparent",
            })}
          >
            <AppText variant="bodyStrong" style={{ textTransform: "capitalize" }}>
              {mode === "days"
                ? formatMonthTitle(shown.year, shown.monthIndex, locale)
                : String(shown.year)}
            </AppText>
            <Ionicons name="chevron-down" size={14} color={theme.colors.textMuted} />
          </Pressable>
          <NavButton
            icon="chevron-forward"
            label={mode === "days" ? t("journal.nextMonth") : t("journal.nextYear")}
            onPress={() => (mode === "days" ? moveMonth(1) : moveYear(1))}
          />
        </View>

        {mode === "days" ? (
          <>
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
                  if (day === null) return <View key={column} style={{ flex: 1, height: 44 }} />;
                  const selected = day === selectedDay;
                  const isToday = day === today;
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
                        borderWidth: isToday ? 2 : 0,
                        borderColor: isToday && !selected ? theme.colors.accent : "transparent",
                      }}
                    >
                      <AppText
                        variant={isToday || selected ? "bodyStrong" : "body"}
                        style={{ color: selected ? theme.colors.onAccent : theme.colors.text }}
                      >
                        {Number(day.slice(8, 10))}
                      </AppText>
                      {daysWithText.has(day) ? (
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
          </>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {Array.from({ length: 12 }, (_, monthIndex) => {
              const current = monthIndex === shown.monthIndex;
              const isThisMonth =
                monthOfDay(today).year === shown.year && monthOfDay(today).monthIndex === monthIndex;
              return (
                <Pressable
                  key={monthIndex}
                  accessibilityRole="button"
                  accessibilityLabel={formatMonthTitle(shown.year, monthIndex, locale)}
                  accessibilityState={{ selected: current }}
                  onPress={() => {
                    setShown({ year: shown.year, monthIndex });
                    setMode("days");
                  }}
                  style={{
                    width: "33.33%",
                    height: 56,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: theme.radius.sm,
                    backgroundColor: current ? theme.colors.accent : "transparent",
                    borderWidth: isThisMonth && !current ? 2 : 0,
                    borderColor: theme.colors.accent,
                  }}
                >
                  <AppText
                    variant={isThisMonth || current ? "bodyStrong" : "body"}
                    style={{ color: current ? theme.colors.onAccent : theme.colors.text, textTransform: "capitalize" }}
                  >
                    {formatMonthTitle(shown.year, monthIndex, locale).split(" ")[0]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </Sheet>
  );
}

function NavButton({
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
      style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.sm }}
    >
      <Ionicons name={icon} size={20} color={theme.colors.textMuted} />
    </Pressable>
  );
}
