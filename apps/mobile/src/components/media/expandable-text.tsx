import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface ExpandableTextProps {
  text: string;
  /** How many lines to show before it is cut. */
  lines?: number;
  variant?: "body" | "callout";
  tone?: "muted" | "subtle";
}

/**
 * A long text that starts short and opens.
 *
 * A film's synopsis can be four paragraphs, and the old app showed eight lines
 * and a button. That is the right answer and this is it: cut it, and put a
 * button that says what it does. A detail screen where the synopsis pushes the
 * score, the cast and everything else off the bottom is a detail screen about
 * the synopsis.
 *
 * The button is only there when there is something hidden. A synopsis of two
 * lines does not get a "read more" that does nothing.
 */
export function ExpandableText({
  text,
  lines = 6,
  variant = "body",
  tone = "muted",
}: ExpandableTextProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [open, setOpen] = useState(false);

  // Counted here and not in the layout: a clamped text does not report its own
  // height until after the first paint, and a button that appears a moment later
  // is a layout that jumps under the thumb.
  const characters = text.length;
  const estimatedLines = Math.ceil(characters / 58);
  const canOpen = estimatedLines > lines;

  return (
    <View style={{ gap: theme.spacing.xxs }}>
      <AppText
        variant={variant}
        tone={tone}
        numberOfLines={open ? undefined : lines}
      >
        {text}
      </AppText>

      {canOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? t("common.less") : t("common.more")}
          onPress={() => setOpen((value) => !value)}
          style={styles.button}
        >
          <AppText variant="caption" tone="accent">
            {open ? t("common.less") : t("common.more")}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
});
