import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider, useTheme } from "@/theme";

/**
 * The configuration screens are their own React root, so they bring the app's theme and language
 * with them and look like the sheets inside the app instead of a separate widget style.
 */
export function ConfigFrame({
  title,
  onClose,
  onSkip,
  skipLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  children: ReactNode;
}) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Frame
          title={title}
          onClose={onClose}
          onSkip={onSkip}
          skipLabel={skipLabel}
        >
          {children}
        </Frame>
      </I18nProvider>
    </ThemeProvider>
  );
}

function Frame({
  title,
  onClose,
  onSkip,
  skipLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.surface, paddingTop: 48, paddingBottom: 32 }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
        }}
      >
        <AppText variant="title" style={{ flex: 1 }}>
          {title}
        </AppText>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={12}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.surfaceMuted,
          }}
        >
          <Ionicons name="close" size={20} color={theme.colors.text} />
        </Pressable>
      </View>
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.lg }}>
        {children}
      </View>
      {onSkip ? (
        <Pressable
          onPress={onSkip}
          style={{ padding: theme.spacing.lg, alignItems: "center" }}
        >
          <AppText variant="body" style={{ color: theme.colors.accent }}>
            {skipLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
