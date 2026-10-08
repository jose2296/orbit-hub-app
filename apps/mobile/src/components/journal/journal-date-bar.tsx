import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { PanResponder, Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** How far a finger has to travel before a swipe counts as a day. */
const SWIPE_DISTANCE = 48;

function isHorizontal(gesture: { dx: number; dy: number }): boolean {
  return Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
}

/**
 * The top of the journal: which day this is, and how to go to another.
 *
 * Swiping is on this bar and not on the page underneath it. A horizontal drag on
 * the text is how a person selects a word, and a diary that turned the page while
 * they were choosing one would be the bug everyone notices first. The arrows and
 * the calendar do the same job from the same bar.
 */
export function JournalDateBar({
  title,
  isToday,
  onPrevious,
  onNext,
  onPickDay,
  onToday,
}: {
  title: string;
  isToday: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPickDay: () => void;
  onToday: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  const swipe = useMemo(
    () =>
      PanResponder.create({
        // The capture phase is what lets a drag that starts on an arrow or on the
        // calendar button still turn the page: the button would otherwise keep the
        // touch, the way a list keeps a scroll from its rows.
        onMoveShouldSetPanResponderCapture: (_, gesture) => isHorizontal(gesture),
        onMoveShouldSetPanResponder: (_, gesture) => isHorizontal(gesture),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx <= -SWIPE_DISTANCE) onNext();
          else if (gesture.dx >= SWIPE_DISTANCE) onPrevious();
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [onNext, onPrevious],
  );

  return (
    <View
      {...swipe.panHandlers}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.background,
      }}
    >
      <NavButton icon="chevron-back" label={t("journal.previousDay")} onPress={onPrevious} />

      {/*
        The title and the "today" link are siblings. A button inside a button is not
        valid markup on the web, and the browser draws the inner one as a second
        control that the outer one swallows.
      */}
      <View style={{ flex: 1, alignItems: "center", paddingVertical: theme.spacing.xs }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("journal.pickDay")}
          onPress={onPickDay}
        >
          <AppText variant="bodyStrong" numberOfLines={1} style={{ textTransform: "capitalize" }}>
            {title}
          </AppText>
        </Pressable>
        {isToday ? null : (
          <Pressable accessibilityRole="button" onPress={onToday} hitSlop={6}>
            <AppText variant="caption" style={{ color: theme.colors.accentSoftText }}>
              {t("journal.today")}
            </AppText>
          </Pressable>
        )}
      </View>

      <NavButton icon="calendar-outline" label={t("journal.pickDay")} onPress={onPickDay} />
      <NavButton icon="chevron-forward" label={t("journal.nextDay")} onPress={onNext} />
    </View>
  );
}

function NavButton({
  icon,
  label,
  onPress,
}: {
  icon: "chevron-back" | "chevron-forward" | "calendar-outline";
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
