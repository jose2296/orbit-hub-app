import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { AddMenu, useAddMenu, type AddMenuOption } from "@/components/ui/add-menu";
import { useHeaderAction } from "@/components/ui/header-action";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { WhereNoteSheet } from "@/components/notes/where-note-sheet";
import { useNotes } from "@/hooks/use-notes";
import { useTranslation } from "@/lib/i18n";
import { createNoteAction } from "@/lib/notes/actions";
import {
  needsPlacement,
  notePlacement,
  type NotePlacementContext,
  type PickedPlace,
} from "@/lib/notes/placement";
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
    workspaceId?: string;
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

  /**
   * The rule is in `lib/notes/placement` and not here, because it is a decision
   * about a note and not about a screen — and because this file is where it was
   * got wrong, on a `workspaceId` that the route had typed as `string` and
   * handed over as `undefined`.
   */
  const context = useMemo<NotePlacementContext>(
    () => ({ workspaceId, folderId }),
    [folderId, workspaceId],
  );
  const [asking, setAsking] = useState(false);

  const create = useCallback(
    async (picked?: PickedPlace | null) => {
      const place = notePlacement(context, picked);
      // Nothing to file it in. `WhereNoteSheet` has already said so and offers no
      // button; this is the guard for a screen reached with neither.
      if (!place) return;

      const noteId = await createNoteAction({
        workspaceId: place.workspaceId,
        folderId: place.folderId,
        title: t("note.untitled"),
        document: "",
      });
      setAsking(false);
      router.replace({ pathname: "/note/[noteId]", params: { noteId } });
    },
    [context, router, t],
  );

  /**
   * The two ways to start a note, and the rule that picks between them.
   *
   * It was one — a plus that went straight to a blank note — which was right
   * while it was one, and the moment there is a second thing to start from, the
   * same button has to choose. `useAddMenu` is that rule: one option does the
   * thing, two open a menu. So the button does not move, does not change shape,
   * and does not gain a twin somewhere else.
   */
  const opciones = useMemo<AddMenuOption[]>(
    () => [
      {
        key: "blank",
        label: t("notes.startBlank"),
        description: t("notes.startBlankHint"),
        icon: "document-outline",
        onPress: () => (needsPlacement(context) ? setAsking(true) : void create()),
      },
      {
        key: "template",
        label: t("note.templates"),
        description: t("note.templatesHint"),
        icon: "documents-outline",
        // The templates screen creates the note and takes its place, so there is
        // nothing to come back to and the stack is not grown by it.
        onPress: () =>
          router.push({
            pathname: "/(app)/templates",
            params: {
              ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
              ...(context.folderId === undefined ? {} : { folderId: context.folderId }),
            },
          }),
      },
    ],
    [context, create, router, t],
  );
  const { directo, abrir, cerrar, abierto, menu } = useAddMenu(opciones);

  const headerAction = useCallback(
      () => (
        <Pressable
          testID="notes-create"
          accessibilityRole="button"
          accessibilityLabel={t("notes.create")}
          hitSlop={8}
          onPress={directo ?? abrir}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="add" size={26} color={theme.colors.text} />
        </Pressable>
      ),
    [abrir, directo, t, theme.colors.text],
  );
  useHeaderAction(headerAction, [headerAction]);

  const items = useMemo(
    () =>
      notes.map((note) => ({
        id: note.id,
        title: note.title.length > 0 ? note.title : t("note.untitled"),
        subtitle: notePreview(note),
        icon: "document-text-outline" as const,
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

      <AddMenu
        visible={abierto}
        onClose={cerrar}
        title={t("create.title")}
        options={menu ?? []}
      />

      {/*
        Only when the screen was reached without a space, which is the way the
        menu reaches it. Inside a space the note has somewhere to go and asking
        would be a question with one answer, already given by the address bar.
      */}
      <WhereNoteSheet
        visible={asking}
        onClose={() => setAsking(false)}
        onPick={(place) => void create(place)}
      />
    </Screen>
  );
}
