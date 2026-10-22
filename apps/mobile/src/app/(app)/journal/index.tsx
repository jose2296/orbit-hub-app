import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { CalendarSheet } from "@/components/journal/calendar-sheet";
import { JournalDateBar } from "@/components/journal/journal-date-bar";
import { JournalDayPage } from "@/components/journal/journal-day-page";
import { JournalDayPreview } from "@/components/journal/journal-day-preview";
import { useHeaderAction } from "@/components/ui/header-action";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { useJournalDaysWithText } from "@/hooks/use-journal";
import { useSession } from "@/hooks/use-session";
import { addDays, formatDayTitle, todayKey } from "@/lib/journal/days";
import { transferJournalDay } from "@/lib/journal/transfer";
import type { JournalTransferMode } from "@/lib/journal/transfer";
import type { JournalDay } from "@orbit-hub/contracts";
import { useI18n, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** Share of the width a swipe has to cover before it turns the page. */
const TURN_FRACTION = 0.25;
/** A flick this fast turns the page whatever the distance. */
const FLICK_VELOCITY = 700;

/**
 * The journal opens on today, and every other day is a swipe away.
 *
 * The whole page moves with the finger: the day before or after comes in from the
 * side it is on, and a short gesture sets the page back where it was. The day is
 * state and not a route. Turning a page flushes the pending save of the day being
 * left first, so no words are lost to a swipe.
 */
export default function JournalScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const { locale } = useI18n();
  const { user } = useSession();
  const { width } = useWindowDimensions();
  const [day, setDay] = useState(() => todayKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Se esta escribiendo (el editor tiene el foco). Con el teclado abierto un arrastre
  // horizontal es seleccionar texto, no cambiar de dia: el gesto se apaga y quedan las
  // flechas de la barra, que siempre estan.
  const [editing, setEditing] = useState(false);
  // Pasar o copiar este dia a otro: primero se elige que, despues el dia de destino.
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<JournalTransferMode | null>(null);
  const daysWithText = useJournalDaysWithText(user?.id);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const offset = useSharedValue(0);

  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush;
  }, []);

  /** Moves to a day. The page being left saves first, while its editor is still there. */
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

  /**
   * Turns the page after a swipe has been completed. The page is flushed while the
   * editor is still mounted, the new day replaces it, and the offset goes back to
   * rest in the same frame, so the new day is what the finger sees.
   */
  const turn = useCallback(
    (direction: -1 | 1) => {
      const next = addDays(day, direction);
      void flushRef.current?.();
      setDay(next);
      offset.value = 0;
    },
    [day, offset],
  );

  /**
   * The gesture is built once per width and not on every render. This screen renders
   * again each time the cache changes, which is every save; a gesture rebuilt on each
   * of those lost the drag that was in progress, so typing stopped the swipe.
   */
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!editing)
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onUpdate((event) => {
          offset.value = event.translationX;
        })
        .onEnd((event) => {
          const past = Math.abs(event.translationX) > width * TURN_FRACTION;
          const flick = Math.abs(event.velocityX) > FLICK_VELOCITY;
          if (event.translationX < 0 && (past || (flick && event.velocityX < 0))) {
            offset.value = withTiming(-width, { duration: 180 }, (finished) => {
              if (finished) runOnJS(turn)(1);
            });
          } else if (event.translationX > 0 && (past || (flick && event.velocityX > 0))) {
            offset.value = withTiming(width, { duration: 180 }, (finished) => {
              if (finished) runOnJS(turn)(-1);
            });
          } else {
            offset.value = withTiming(0, { duration: 160 });
          }
        }),
    [width, turn, offset, editing],
  );

  const centre = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const before = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value - width }] }));
  const after = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value + width }] }));

  const dayHasText = daysWithText.has(day);

  useHeaderAction(
    () => (
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("journal.transfer.title")}
          onPress={() => setTransferMenuOpen(true)}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="copy-outline" size={22} color={theme.colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("journal.pickDay")}
          onPress={() => setCalendarOpen(true)}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="calendar-outline" size={22} color={theme.colors.text} />
        </Pressable>
      </View>
    ),
    [t, theme.colors.text, theme.spacing.md],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <JournalDateBar
        title={formatDayTitle(day, locale)}
        isToday={day === todayKey()}
        onPrevious={onPrevious}
        onNext={onNext}
        onToday={onToday}
      />

      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1, overflow: "hidden" }}>
          {user ? (
            <>
              <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width }, before]}>
                <JournalDayPreview userId={user.id} day={addDays(day, -1)} />
              </Animated.View>
              <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width }, after]}>
                <JournalDayPreview userId={user.id} day={addDays(day, 1)} />
              </Animated.View>
            </>
          ) : null}
          <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width }, centre]}>
            {user ? (
              <JournalDayPage
                key={day}
                userId={user.id}
                day={day}
                registerFlush={registerFlush}
                onEditingChange={setEditing}
              />
            ) : null}
          </Animated.View>
        </View>
      </GestureDetector>

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

      <Sheet
        visible={transferMenuOpen}
        onClose={() => setTransferMenuOpen(false)}
        title={t("journal.transfer.title")}
      >
        <SheetOptions
          options={[
            {
              key: "copy",
              label: t("journal.transfer.copy"),
              description: dayHasText ? t("journal.transfer.copyHint") : t("journal.transfer.empty"),
              icon: "copy-outline" as const,
              disabled: !dayHasText,
              onPress: () => {
                setTransferMenuOpen(false);
                setTransferMode("copy");
              },
            },
            {
              key: "move",
              label: t("journal.transfer.move"),
              description: dayHasText ? t("journal.transfer.moveHint") : t("journal.transfer.empty"),
              icon: "arrow-redo-outline" as const,
              disabled: !dayHasText,
              onPress: () => {
                setTransferMenuOpen(false);
                setTransferMode("move");
              },
            },
          ]}
        />
      </Sheet>

      {/* El mismo calendario, pidiendo el dia de destino. Lo escrito se guarda antes de
          copiarlo, y despues se abre el dia de destino para ver donde ha quedado. */}
      <CalendarSheet
        visible={transferMode !== null}
        selectedDay={day}
        daysWithText={daysWithText}
        onClose={() => setTransferMode(null)}
        onPick={(picked) => {
          const mode = transferMode;
          setTransferMode(null);
          if (!mode || !user || picked === day) return;
          void (async () => {
            await flushRef.current?.();
            await transferJournalDay(user.id, day as JournalDay, picked as JournalDay, mode);
            await moveTo(picked);
          })();
        }}
      />
    </View>
  );
}
