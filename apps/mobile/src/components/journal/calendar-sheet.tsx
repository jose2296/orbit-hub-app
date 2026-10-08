import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { formatMonthTitle, monthGrid, monthOfDay, todayKey, weekdayLabel } from "@/lib/journal/days";
import { useI18n, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** What the sheet shows: the days of a month, the months of a year, or the years. */
type CalendarView = "days" | "months" | "years";

/** How many years one page of the year picker shows. */
const YEARS_PER_PAGE = 12;

/**
 * A day to pick from.
 *
 * The month and the year are two buttons in the header, each opening its own list,
 * so any year is reachable directly. Swiping across the days turns the month, the
 * way a calendar on a phone does. Every day is selectable, the future as well as the
 * past. A dot marks a day with words in it; today is ringed and bold.
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
  const todayParts = monthOfDay(today);

  // Every opening starts on the month of the day that is selected now, on the days.
  const [shown, setShown] = useState(() => monthOfDay(selectedDay));
  const [view, setView] = useState<CalendarView>("days");
  const [yearPage, setYearPage] = useState(() => monthOfDay(selectedDay).year);
  useEffect(() => {
    if (visible) {
      setShown(monthOfDay(selectedDay));
      setView("days");
      setYearPage(monthOfDay(selectedDay).year);
    }
  }, [visible, selectedDay]);


  const stepMonth = useCallback((delta: number) => {
    setShown((current) => {
      const index = current.year * 12 + current.monthIndex + delta;
      return { year: Math.floor(index / 12), monthIndex: index % 12 };
    });
  }, []);

  // The days swipe like the journal itself: the month before or after comes in with the
  // finger, and a short drag springs back. Built once per width.
  const { width: screenWidth } = useWindowDimensions();
  const gridWidth = Math.max(0, screenWidth - theme.spacing.lg * 2 - 16);
  const offset = useSharedValue(0);
  const turn = useCallback(
    (direction: -1 | 1) => {
      stepMonth(direction);
      offset.value = 0;
    },
    [stepMonth, offset],
  );
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 14])
        .failOffsetY([-14, 14])
        .onUpdate((event) => {
          offset.value = event.translationX;
        })
        .onEnd((event) => {
          const past = Math.abs(event.translationX) > gridWidth * 0.25;
          const flick = Math.abs(event.velocityX) > 700;
          if (event.translationX < 0 && (past || (flick && event.velocityX < 0))) {
            offset.value = withTiming(-gridWidth, { duration: 180 }, (finished) => {
              if (finished) runOnJS(turn)(1);
            });
          } else if (event.translationX > 0 && (past || (flick && event.velocityX > 0))) {
            offset.value = withTiming(gridWidth, { duration: 180 }, (finished) => {
              if (finished) runOnJS(turn)(-1);
            });
          } else {
            offset.value = withTiming(0, { duration: 160 });
          }
        }),
    [gridWidth, turn, offset],
  );
  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value - gridWidth }] }));
  const previous = monthAround(shown, -1);
  const next = monthAround(shown, 1);

  const back = () => {
    if (view === "days") stepMonth(-1);
    else if (view === "months") setShown((current) => ({ ...current, year: current.year - 1 }));
    else setYearPage((current) => current - YEARS_PER_PAGE);
  };
  const forward = () => {
    if (view === "days") stepMonth(1);
    else if (view === "months") setShown((current) => ({ ...current, year: current.year + 1 }));
    else setYearPage((current) => current + YEARS_PER_PAGE);
  };

  const gridProps = { selectedDay, today, daysWithText, onPick };

  const title = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.xs }}>
      {view === "years" ? (
        <AppText variant="bodyStrong">
          {`${yearPage} – ${yearPage + YEARS_PER_PAGE - 1}`}
        </AppText>
      ) : (
        <>
          {view === "days" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("journal.pickMonth")}
              onPress={() => setView("months")}
              hitSlop={6}
              style={headerPill(theme)}
            >
              <AppText variant="bodyStrong" style={{ textTransform: "capitalize" }}>
                {formatMonthTitle(shown.year, shown.monthIndex, locale).split(" ")[0]}
              </AppText>
              <Ionicons name="chevron-down" size={13} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("journal.pickYear")}
            onPress={() => {
              setYearPage(shown.year - (shown.year % YEARS_PER_PAGE));
              setView("years");
            }}
            hitSlop={6}
            style={headerPill(theme)}
          >
            <AppText variant="bodyStrong">{String(shown.year)}</AppText>
            <Ionicons name="chevron-down" size={13} color={theme.colors.textMuted} />
          </Pressable>
        </>
      )}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={t("journal.pickDay")}>
      <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <NavButton
            icon="chevron-back"
            label={view === "years" ? t("journal.previousYears") : t("journal.previousYear")}
            onPress={back}
          />
          {title}
          <NavButton
            icon="chevron-forward"
            label={view === "years" ? t("journal.nextYears") : t("journal.nextYear")}
            onPress={forward}
          />
        </View>

        {view === "days" ? (
          <GestureDetector gesture={swipe}>
            <View style={{ width: gridWidth, overflow: "hidden" }}>
              <View style={{ flexDirection: "row", marginBottom: theme.spacing.md }}>
                {Array.from({ length: 7 }, (_, index) => (
                  <View key={index} style={{ flex: 1, alignItems: "center" }}>
                    <AppText variant="caption" tone="subtle">
                      {weekdayLabel(index, locale)}
                    </AppText>
                  </View>
                ))}
              </View>
              <Animated.View style={[{ flexDirection: "row", width: gridWidth * 3 }, strip]}>
                <MonthGrid width={gridWidth} month={previous} {...gridProps} />
                <MonthGrid width={gridWidth} month={shown} {...gridProps} />
                <MonthGrid width={gridWidth} month={next} {...gridProps} />
              </Animated.View>
            </View>
          </GestureDetector>
        ) : null}

        {view === "months" ? (
          <GridOf
            count={12}
            label={(index) => formatMonthTitle(shown.year, index, locale)}
            short={(index) => formatMonthTitle(shown.year, index, locale).split(" ")[0] ?? ""}
            selected={(index) => index === shown.monthIndex && shown.year === monthOfDay(selectedDay).year}
            current={(index) => index === todayParts.monthIndex && shown.year === todayParts.year}
            onPress={(index) => {
              setShown({ year: shown.year, monthIndex: index });
              setView("days");
            }}
          />
        ) : null}

        {view === "years" ? (
          <GridOf
            count={YEARS_PER_PAGE}
            label={(index) => String(yearPage + index)}
            short={(index) => String(yearPage + index)}
            selected={(index) => yearPage + index === shown.year}
            current={(index) => yearPage + index === todayParts.year}
            onPress={(index) => {
              setShown((current) => ({ ...current, year: yearPage + index }));
              setView("months");
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

/** The month a number of months away from `month`. */
function monthAround(month: { year: number; monthIndex: number }, delta: number) {
  const index = month.year * 12 + month.monthIndex + delta;
  return { year: Math.floor(index / 12), monthIndex: index % 12 };
}

/** One month of days, drawn as a page of the calendar's day strip. */
function MonthGrid({
  width,
  month,
  selectedDay,
  today,
  daysWithText,
  onPick,
}: {
  width: number;
  month: { year: number; monthIndex: number };
  selectedDay: string;
  today: string;
  daysWithText: Set<string>;
  onPick: (day: string) => void;
}) {
  const theme = useTheme();
  const weeks = useMemo(() => monthGrid(month.year, month.monthIndex), [month.year, month.monthIndex]);
  return (
    <View style={{ width, gap: theme.spacing.md }}>
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
    </View>
  );
}

function headerPill(theme: ReturnType<typeof useTheme>) {
  return {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    height: 36,
    borderRadius: theme.radius.sm,
  };
}

/** A grid of months or years: the cell for the current one is ringed, the chosen one filled. */
function GridOf({
  count,
  label,
  short,
  selected,
  current,
  onPress,
}: {
  count: number;
  label: (index: number) => string;
  short: (index: number) => string;
  selected: (index: number) => boolean;
  current: (index: number) => boolean;
  onPress: (index: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {Array.from({ length: count }, (_, index) => {
        const chosen = selected(index);
        const now = current(index);
        return (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={label(index)}
            accessibilityState={{ selected: chosen }}
            onPress={() => onPress(index)}
            style={{
              width: "33.33%",
              height: 58,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: theme.radius.sm,
              backgroundColor: chosen ? theme.colors.accent : "transparent",
              borderWidth: now && !chosen ? 2 : 0,
              borderColor: theme.colors.accent,
            }}
          >
            <AppText
              variant={now || chosen ? "bodyStrong" : "body"}
              style={{ color: chosen ? theme.colors.onAccent : theme.colors.text, textTransform: "capitalize" }}
            >
              {short(index)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
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
