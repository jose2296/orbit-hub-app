import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { PanResponder, Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** How far a finger has to travel before a swipe counts as a day. */
const SWIPE_DISTANCE = 48;

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
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("journal.pickDay")}
        onPress={onPickDay}
        style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: theme.spacing.xs }}
      >
        <AppText variant="bodyStrong" numberOfLines={1} style={{ textTransform: "capitalize" }}>
          {title}
        </AppText>
        {isToday ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={onToday}
            hitSlop={6}
          >
            <AppText variant="caption" style={{ color: theme.colors.accentSoftText }}>
              {t("journal.today")}
            </AppText>
          </Pressable>
        )}
      </Pressable>

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
