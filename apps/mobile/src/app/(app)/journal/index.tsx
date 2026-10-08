import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { CalendarSheet } from "@/components/journal/calendar-sheet";
import { JournalDateBar } from "@/components/journal/journal-date-bar";
import { JournalDayPage } from "@/components/journal/journal-day-page";
import { useJournalDaysWithText } from "@/hooks/use-journal";
import { addDays, formatDayTitle, todayKey } from "@/lib/journal/days";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/hooks/use-session";
import { useTheme } from "@/theme";

/**
 * The journal opens on today, and every other day is a step away from it.
 *
 * The day is state, not a route: the journal is one place, and a link to a day
 * is a thing nobody has asked for yet. Changing the day flushes the pending save
 * of the page being left first, so no words are lost to a swipe.
 */
export default function JournalScreen() {
  const theme = useTheme();
  const { locale } = useI18n();
  const { user } = useSession();
  const [day, setDay] = useState(() => todayKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const daysWithText = useJournalDaysWithText(user?.id);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush;
  }, []);

  const moveTo = useCallback(
    async (next: string) => {
      if (next === day) return;
      await flushRef.current?.();
      setDay(next);
    },
    [day],
  );

  const onPrevious = useCallback(() => void moveTo(addDays(day, -1)), [day, moveTo]);
  const onNext = useCallback(() => void moveTo(addDays(day, 1)), [day, moveTo]);
  const onToday = useCallback(() => void moveTo(todayKey()), [moveTo]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <JournalDateBar
        title={formatDayTitle(day, locale)}
        isToday={day === todayKey()}
        onPrevious={onPrevious}
        onNext={onNext}
        onToday={onToday}
        onPickDay={() => setCalendarOpen(true)}
      />

      {user ? (
        <JournalDayPage
          key={day}
          userId={user.id}
          day={day}
          registerFlush={registerFlush}
        />
      ) : null}

      <CalendarSheet
        visible={calendarOpen}
        selectedDay={day}
        daysWithText={daysWithText}
        onClose={() => setCalendarOpen(false)}
        onPick={(picked) => {
          setCalendarOpen(false);
          void moveTo(picked);
        }}
      />
    </View>
  );
}
