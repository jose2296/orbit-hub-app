import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { EnrichedText } from "react-native-enriched-html";
import type { OnMentionPressEvent } from "react-native-enriched-html";

import { useNoteHtmlStyle } from "@/components/notes/note-editor";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { renderMentions } from "@/lib/journal/mentions";
import type { MentionLookup, MentionTarget } from "@/lib/journal/mentions";
import { useTheme } from "@/theme";

/**
 * A day as it reads: the text, with its chips drawn and pressable.
 *
 * The editor cannot take a press on a chip, so a day with words in it opens here
 * and the editor is one tap away. Pressing a chip goes straight to what it points
 * at, which is the one thing a chip is for.
 */
export function JournalDayView({
  document,
  lookup,
  targets,
  onEdit,
}: {
  document: string;
  lookup: MentionLookup;
  targets: Map<string, MentionTarget>;
  /** Left out for a day that is only shown, as the neighbour of the one being read. */
  onEdit?: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { htmlStyle, bodyStyle } = useNoteHtmlStyle();

  const html = useMemo(
    () =>
      renderMentions(document, lookup, {
        mode: "reading",
        unavailableLabel: t("mention.unavailable"),
      }),
    [document, lookup, t],
  );

  const onMentionPress = (event: OnMentionPressEvent) => {
    const target = targets.get(`${event.attributes["type"]}:${event.attributes["id"]}`);
    if (target) router.push(target.route as never);
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
    >
      <EnrichedText htmlStyle={htmlStyle} style={bodyStyle} onMentionPress={onMentionPress}>
        {html}
      </EnrichedText>
      {onEdit ? (
      <View style={{ alignItems: "flex-start" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("journal.edit")}
          onPress={onEdit}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.spacing.md,
            height: 36,
            borderRadius: theme.radius.pill,
            backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          })}
        >
          <AppText variant="bodyStrong">{t("journal.edit")}</AppText>
        </Pressable>
      </View>
      ) : null}
    </ScrollView>
  );
}
