import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The top of the journal: which day this is, and how to step to the next one.
 *
 * Swiping is not here. It is on the whole page, so a drag anywhere turns the day,
 * and this bar only names the day and offers the arrows.
 */
export function JournalDateBar({
  title,
  isToday,
  onPrevious,
  onNext,
  onToday,
}: {
  title: string;
  isToday: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <View
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
      <View style={{ flex: 1, alignItems: "center", paddingVertical: theme.spacing.xs }}>
        <AppText variant="bodyStrong" numberOfLines={1} style={{ textTransform: "capitalize" }}>
          {title}
        </AppText>
        {isToday ? null : (
          <Pressable accessibilityRole="button" onPress={onToday} hitSlop={6}>
            <AppText variant="caption" style={{ color: theme.colors.accentSoftText }}>
              {t("journal.today")}
            </AppText>
          </Pressable>
        )}
      </View>
      <NavButton icon="chevron-forward" label={t("journal.nextDay")} onPress={onNext} />
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
