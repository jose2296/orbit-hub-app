import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { READING_WIDTH } from "@/lib/layout/width";
import { useTheme } from "@/theme";

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Extra bottom padding, e.g. to clear a sticky footer. */
  bottomInset?: number;
  /**
   * How wide the content is allowed to get.
   *
   * `reading` is a column for sentences and rows. `grid` is wider, for the
   * panel of cards, which loses a card column for every point taken away from
   * it. `full` is the whole page, for the few things that are a picture of
   * something rather than a list of it.
   */
  width?: "reading" | "grid" | "full";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Base screen: safe areas, background colour, an optional scroll container and
 * a maximum width.
 *
 * Every route uses it, which is the only reason the column is the same width on
 * all of them. A phone is 430 points and a laptop is 1400, and a screen that
 * stretches its text edge to edge on the laptop is one nobody reads all the way
 * down: the eye comes back to the left and has to find the line it was on. So
 * the content is a column in the middle and the page around it stays the page's
 * colour.
 *
 * The cap is inside the scroll view and not on the screen, so a page that is
 * taller than the window still scrolls edge to edge and the padding is the
 * same on both sides the whole way down.
 */
export function Screen({
  children,
  scroll = true,
  bottomInset = 0,
  width = "reading",
  style,
  testID,
}: ScreenProps) {
  const theme = useTheme();

  const padding = {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl + bottomInset,
    gap: theme.spacing.lg,
  };

  const column: ViewStyle =
    width === "full"
      ? styles.full
      : {
          width: "100%",
          maxWidth: width === "grid" ? 1000 : READING_WIDTH,
          alignSelf: "center",
        };

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, padding, column]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.flex, padding, column]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.flex, { backgroundColor: theme.colors.background }, style]}
      testID={testID}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  full: {
    width: "100%",
    alignSelf: "center",
  },
});

export type { ReactNode };
