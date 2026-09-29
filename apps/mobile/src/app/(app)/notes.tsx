import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { useNotes } from "@/hooks/use-notes";
import { useTranslation } from "@/lib/i18n";
import { notePreview } from "@/lib/notes/note-record";
import { useTheme } from "@/theme";

/**
 * The notes in a space, or in a folder of one.
 *
 * Reads from the cache and nothing else, so it is exactly as useful on a train as
 * on a desk. The preview is the body with the title cut off the front, because a
 * note whose first block is its own heading would otherwise show the same two
 * words twice and look like a bug to whoever is reading it.
 */
export default function NotesListScreen() {
  const { workspaceId, folderId } = useLocalSearchParams<{
    workspaceId: string;
    folderId?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const t = useTranslation();

  const { notes, isLoading } = useNotes({
    workspaceId,
    // `undefined` means "no opinion about the folder" and `null` means "in no
    // folder". Collapsing the two would hide every note that is not filed, which
    // on the first day is nearly all of them.
    ...(folderId === undefined ? {} : { folderId: folderId || null }),
  });

  const items = useMemo(
    () =>
      notes.map((note) => ({
        id: note.id,
        title: note.title.length > 0 ? note.title : t("note.untitled"),
        subtitle: notePreview(note),
        icon: note.favorite ? ("star" as const) : ("document-text-outline" as const),
        // Read-only state rather than an action: tapping a label that cannot be
        // tapped is worse than not showing it.
        rightLabel: note.attachmentCount > 0 ? String(note.attachmentCount) : undefined,
      })),
    [notes, t],
  );

  if (isLoading) return <View style={{ flex: 1 }} />;

  return (
    <Screen width="reading">
      {items.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title={t("notes.empty.title")}
          description={t("notes.empty.body")}
        />
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {items.map((item) => (
            <ListRow
              key={item.id}
              title={item.title}
              subtitle={item.subtitle.length > 0 ? item.subtitle : undefined}
              icon={item.icon}
              rightLabel={item.rightLabel}
              chevron
              onPress={() =>
                router.push({ pathname: "/note/[noteId]", params: { noteId: item.id } })
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
