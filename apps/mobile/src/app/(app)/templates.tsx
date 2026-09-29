import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import {
  canEditTemplate,
  templateSubtitle,
  useNoteTemplates,
} from "@/hooks/use-note-templates";
import { useSession } from "@/hooks/use-session";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The templates, and the way into them.
 *
 * The list mixes the catalogue with whatever the space has, and says which is
 * which, because a recipe you cannot tell from a recipe somebody in your team
 * wrote is one you will overwrite by accident.
 *
 * **Tapping one opens it.** It used to make a note straight away, and that was
 * wrong in a way that only showed up after the fact: the one way to see what was
 * inside a template was to make a note out of it, and there was no way back —
 * the note is a copy and the template is exactly as it was, unchanged. So a
 * template is opened, read, and — if it is yours — changed, and the button that
 * makes the note is on that screen. One extra tap, and in exchange the person
 * knows what they are starting from.
 *
 * The templates are read from the API rather than bundled, so twelve recipes
 * arrive in one request instead of twelve that have to be updated with every
 * build. A device that cannot reach the API says so rather than pretending there
 * is nothing to offer: an empty picker and a picker that failed look the same on
 * a phone, and only one of them is true.
 *
 * This is also the only place templates are offered, and not a row in every list.
 * A row in each of the workspace and folder listings was a second route to the
 * same screen, in a place somebody has to look for it, saying the same word four
 * times on a screen that is mostly lists. It is here instead, and it is reached
 * from the `+`, which is where somebody who wants to start a note from a shape
 * already is.
 */
export default function TemplatesScreen() {
  const { workspaceId, folderId } = useLocalSearchParams<{
    workspaceId: string;
    folderId?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const t = useTranslation();

  const { templates, isLoading, failed } = useNoteTemplates(workspaceId);
  const { user } = useSession();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const onOpen = useCallback(
    (templateId: string) => {
      setOpeningId(templateId);
      router.push({
        pathname: "/templates/[templateId]",
        params: {
          templateId,
          ...(workspaceId ? { workspaceId } : {}),
          ...(folderId ? { folderId } : {}),
        },
      });
    },
    [folderId, router, workspaceId],
  );

  const items = useMemo(
    () =>
      templates.map((template) => ({
        id: template.id,
        title: template.name,
        subtitle: template.description || templateSubtitle(template),
        icon: (template.icon || "document-text-outline") as never,
        // The one thing that has to be readable here: a catalogue entry, a
        // template somebody in your team wrote and a recipe a stranger published
        // are three different things to edit, and a list that did not say so
        // would offer a change that is refused.
        rightLabel: !canEditTemplate(template, user?.id)
          ? template.builtInKey
            ? t("note.template.builtIn")
            : t("note.template.someoneElses")
          : undefined,
        busy: openingId === template.id,
        template,
      })),
    [openingId, templates, t, user?.id],
  );

  if (isLoading) return <View style={{ flex: 1 }} />;

  if (failed) {
    return (
      <Screen width="reading">
        <EmptyState
          icon="cloud-offline-outline"
          title={t("note.templates.failedTitle")}
          description={t("note.templates.failedBody")}
        />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen width="reading">
        <EmptyState
          icon="documents-outline"
          title={t("note.templates.empty")}
          description={t("note.templates.emptyBody")}
        />
      </Screen>
    );
  }

  return (
    <Screen width="reading">
      <View style={{ gap: theme.spacing.xs }}>
        {items.map((item) => (
          <ListRow
            key={item.id}
            title={item.title}
            subtitle={item.subtitle}
            icon={item.icon}
            rightLabel={item.rightLabel}
            chevron={!item.busy}
            disabled={openingId !== null}
            onPress={() => onOpen(item.template.id)}
          />
        ))}
      </View>
    </Screen>
  );
}
