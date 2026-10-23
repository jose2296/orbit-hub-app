import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView } from "react-native";
import { EnrichedText } from "react-native-enriched-html";
import type { OnLinkPressEvent, OnMentionPressEvent } from "react-native-enriched-html";

import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useNoteHtmlStyle } from "@/components/notes/note-editor";
import { AppText } from "@/components/ui/text";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { renderMentions } from "@/lib/journal/mentions";
import { PRESS_SETTLE_MS, shouldEnterEdit } from "@/lib/journal/press";
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
  placeholder,
}: {
  document: string;
  /** Lo que se dice en un dia vacio, que es tambien donde se toca para empezar a escribir. */
  placeholder?: string;
  lookup: MentionLookup;
  targets: Map<string, MentionTarget>;
  /** Left out for a day that is only shown, as the neighbour of the one being read. */
  onEdit?: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { htmlStyle, bodyStyle } = useNoteHtmlStyle();

  const vacio = noteDocumentToPlainText(document).trim().length === 0;
  const html = useMemo(
    () =>
      renderMentions(document, lookup, {
        mode: "reading",
        unavailableLabel: t("mention.unavailable"),
      }),
    [document, lookup, t],
  );

  // Cuando un enlace avisó por ultima vez. El texto va dentro de un contenedor pulsable
  // (un toque escribe), y ese toque tambien se dispara al pulsar un enlace: sin esta marca,
  // tocar un enlace abria el editor en vez de abrir lo que enlaza.
  const lastLinkPressAt = useRef(0);
  // Tocar un chip no navega a ciegas: pregunta que hacer, como cualquier enlace en un editor
  // (abrir lo que enlaza, o editar el texto donde esta). Navegar de golpe sacaba al usuario de
  // la pagina cuando solo queria corregir una palabra al lado.
  const [chipMenu, setChipMenu] = useState<{ title: string; route: string | null } | null>(null);
  const onMentionPress = (event: OnMentionPressEvent) => {
    lastLinkPressAt.current = Date.now();
    const target = targets.get(`${event.attributes["type"]}:${event.attributes["id"]}`);
    setChipMenu({ title: event.text, route: target ? target.route : null });
  };
  const onLinkPress = (event: OnLinkPressEvent) => {
    lastLinkPressAt.current = Date.now();
    void Linking.openURL(event.url);
  };
  // Espera un instante y pregunta: el aviso del enlace puede llegar antes o despues del toque
  // del contenedor, y decidir en el acto elegiria mal la mitad de las veces.
  const onTextPress = () => {
    if (!onEdit) return;
    setTimeout(() => {
      if (shouldEnterEdit(lastLinkPressAt.current, Date.now())) onEdit();
    }, PRESS_SETTLE_MS);
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
        onPress={onTextPress}
      >
        {vacio ? (
          <AppText variant="body" tone="muted">
            {placeholder ?? ""}
          </AppText>
        ) : (
          <EnrichedText
            htmlStyle={htmlStyle}
            style={bodyStyle}
            onMentionPress={onMentionPress}
            onLinkPress={onLinkPress}
          >
            {html}
          </EnrichedText>
        )}
      </Pressable>
      {/* El resto de la pagina, para que tocar debajo del texto tambien escriba. */}
      {onEdit ? <Pressable style={{ flexGrow: 1, minHeight: 160 }} onPress={onEdit} /> : null}
      <Sheet
        visible={chipMenu !== null}
        onClose={() => setChipMenu(null)}
        title={chipMenu?.title ?? ""}
      >
        <SheetOptions
          options={[
            {
              key: "open",
              label: t("journal.chip.open"),
              description: chipMenu?.route === null ? t("mention.unavailable") : undefined,
              icon: "open-outline" as const,
              disabled: chipMenu?.route === null,
              onPress: () => {
                const route = chipMenu?.route;
                setChipMenu(null);
                if (route) router.push(route as never);
              },
            },
            ...(onEdit
              ? [
                  {
                    key: "edit",
                    label: t("journal.chip.edit"),
                    icon: "create-outline" as const,
                    onPress: () => {
                      setChipMenu(null);
                      onEdit();
                    },
                  },
                ]
              : []),
          ]}
        />
      </Sheet>
    </ScrollView>
  );
}
