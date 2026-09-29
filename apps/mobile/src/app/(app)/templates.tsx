import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { templateSubtitle, titleForTemplate, useNoteTemplates } from "@/hooks/use-note-templates";
import { useTranslation } from "@/lib/i18n";
import { createNoteAction } from "@/lib/notes/actions";
import { useTheme } from "@/theme";

/**
 * The templates, and making a note out of one.
 *
 * The list mixes the catalogue with whatever the space has, and says which is
 * which, because a recipe you cannot tell from a recipe somebody in your team
 * wrote is one you will overwrite by accident.
 *
 * Applying one writes the note **locally**, like everything else this app
 * creates, and the template only supplies the document. It was a server call
 * first, and the consequence was a note screen showing an empty page: the note
 * existed on the server and the editor reads from the cache, which had never
 * heard of it. A note this app creates is in the cache from the moment it is
 * named, and it reaches the server when the queue drains.
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
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const onUse = useCallback(
    async (template: (typeof templates)[number]) => {
      if (!workspaceId || applyingId) return;
      setApplyingId(template.id);
      try {
        const noteId = await createNoteAction({
          workspaceId,
          folderId: folderId ?? null,
          title: titleForTemplate(template),
          document: template.document,
        });
        router.replace({
          pathname: "/note/[noteId]",
          params: { noteId },
        });
      } catch {
        Alert.alert(t("note.templates.failedTitle"), t("note.templates.failedBody"));
      } finally {
        setApplyingId(null);
      }
    },
    [applyingId, folderId, router, t, workspaceId],
  );

  const items = useMemo(
    () =>
      templates.map((template) => ({
        id: template.id,
        title: template.name,
        subtitle: template.description || templateSubtitle(template),
        icon: (template.icon || "document-text-outline") as never,
        // The one thing that has to be readable here: a catalogue entry and a
        // template somebody in your team wrote are not the same thing to edit.
        rightLabel:
          template.builtInKey === null ? t("note.templateScopeWorkspace") : undefined,
        busy: applyingId === template.id,
        template,
      })),
    [applyingId, templates, t],
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
            disabled={applyingId !== null}
            onPress={() => void onUse(item.template)}
          />
        ))}
      </View>
    </Screen>
  );
}
