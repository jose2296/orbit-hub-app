import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AppText } from "./text";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Short line under the title, for context. */
  subtitle?: string;
  children: ReactNode;
  /** Renders the content in a scroll view, for a long list of options. */
  scrollable?: boolean;
  /** Caps the height on a tall screen so a long list does not run off it. */
  maxHeightRatio?: number;
}

/**
 * A panel of options that rises from the bottom on a phone and sits in the
 * middle of the screen on a wide one.
 *
 * Options are the recurring shape of this app: creating a thing, the menu of a
 * list, the filters of a view, the sort order. On a phone they belong in a
 * panel that slides up from the bottom edge, where the thumb already is, and on
 * a wide screen a panel glued to the bottom of a 1200px column is a strip
 * nobody reads, so it becomes a dialog in the middle. One component with two
 * shapes, because the difference is a style and not a different screen.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  scrollable = true,
  maxHeightRatio = 0.85,
}: SheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const wide = isWide();

  const Body = scrollable ? ScrollView : View;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={wide ? "fade" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, wide ? styles.rootWide : styles.rootNarrow]}>
        {/* The tap outside closes, which is the only way out on a wide screen
            where there is no edge to drag from. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        />

        <View
          style={[
            wide ? styles.panelWide : styles.panelNarrow,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
              paddingBottom: wide
                ? theme.spacing.lg
                : insets.bottom + theme.spacing.lg,
            },
          ]}
        >
          <View style={styles.grabberArea}>
            {wide ? null : (
              <View
                style={[
                  styles.grabber,
                  { backgroundColor: theme.colors.borderStrong },
                ]}
              />
            )}
            {title ? (
              <View style={{ gap: 2 }}>
                <AppText variant="heading" numberOfLines={1}>
                  {title}
                </AppText>
                {subtitle ? (
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              hitSlop={10}
              onPress={onClose}
              style={({ pressed }) => [
                styles.close,
                {
                  backgroundColor: theme.colors.surfaceMuted,
                  borderRadius: theme.radius.pill,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="close" size={16} color={theme.colors.text} />
            </Pressable>
          </View>

          <Body
            {...(scrollable
              ? {
                  contentContainerStyle: { paddingTop: theme.spacing.sm },
                  showsVerticalScrollIndicator: false,
                  keyboardShouldPersistTaps: "handled" as const,
                }
              : { style: { paddingTop: theme.spacing.sm } })}
          >
            {children}
          </Body>
        </View>
      </View>
    </Modal>
  );
}

export interface SheetOption {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  description?: string;
  tone?: "default" | "danger" | "accent";
  disabled?: boolean;
  onPress: () => void;
}

/**
 * The menu of a thing: what you can do with a list, a folder or a space.
 *
 * Destructive options are last and red, so the one that cannot be undone is not
 * the one under the thumb at the top of the panel.
 */
export function SheetOptions({ options }: { options: SheetOption[] }) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {options.map((option, index) => {
        const danger = option.tone === "danger";
        const accent = option.tone === "accent";
        const color = danger
          ? theme.colors.danger
          : accent
            ? theme.colors.accent
            : theme.colors.text;

        return (
          <View key={option.key}>
            {index > 0 ? (
              <View
                style={[
                  styles.separator,
                  { backgroundColor: theme.colors.border },
                ]}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityHint={option.description}
              disabled={option.disabled}
              onPress={option.onPress}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: pressed
                    ? theme.colors.surfaceMuted
                    : "transparent",
                  opacity: option.disabled ? 0.4 : 1,
                },
              ]}
            >
              {option.icon ? (
                <Ionicons name={option.icon} size={18} color={color} />
              ) : null}
              <View style={[styles.optionText, { gap: 2 }]}>
                <AppText variant="body" style={{ color }}>
                  {option.label}
                </AppText>
                {option.description ? (
                  <AppText variant="caption" tone="subtle" numberOfLines={2}>
                    {option.description}
                  </AppText>
                ) : null}
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** A wide screen is one where a bottom panel is a strip, not a panel. */
export function isWide(): boolean {
  if (Platform.OS !== "web") return false;
  return (globalThis as { innerWidth?: number }).innerWidth
    ? (globalThis as { innerWidth: number }).innerWidth >= 900
    : false;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  rootNarrow: {},
  rootWide: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  panelNarrow: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  panelWide: {
    width: 460,
    maxWidth: "100%",
    borderRadius: 18,
    borderWidth: 1,
    paddingTop: 14,
    // `boxShadow` and not the `shadow*` family: React Native Web dropped those
    // props and warns on every render, and the new architecture takes the CSS
    // form on native too, so one property covers the three targets.
    boxShadow: "0px 12px 30px rgba(0, 0, 0, 0.35)",
    elevation: 12,
  },
  grabberArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  close: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  optionText: {
    flex: 1,
  },
  separator: {
    height: 1,
    marginLeft: 48,
  },
});
