import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView } from "react-native";
import { EnrichedText } from "react-native-enriched-html";
import type { OnMentionPressEvent } from "react-native-enriched-html";

import { useNoteHtmlStyle } from "@/components/notes/note-editor";
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
        flexGrow: 1,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
    >
      {/* Un toque en el texto abre el editor con el cursor dentro; uno en un enlace (chip) va
          a lo que enlaza, porque la libreria lo resuelve antes de que el toque suba hasta aqui. */}
      <Pressable
        accessibilityRole={onEdit ? "button" : undefined}
        accessibilityLabel={onEdit ? t("journal.edit") : undefined}
        disabled={!onEdit}
        onPress={onEdit}
      >
        <EnrichedText htmlStyle={htmlStyle} style={bodyStyle} onMentionPress={onMentionPress}>
          {html}
        </EnrichedText>
      </Pressable>
      {/* El resto de la pagina, para que tocar debajo del texto tambien escriba. */}
      {onEdit ? <Pressable style={{ flexGrow: 1, minHeight: 160 }} onPress={onEdit} /> : null}
    </ScrollView>
  );
}
