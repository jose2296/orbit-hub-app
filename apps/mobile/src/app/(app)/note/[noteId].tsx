import type { EnrichedTextInputInstance } from "react-native-enriched-html";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, View } from "react-native";

import { NoteAttachments } from "@/components/notes/note-attachments";
import { NoteEditor, useNoteHtmlStyle } from "@/components/notes/note-editor";
import { ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT } from "@orbit-hub/contracts";
import { pickAnyFile, pickImage } from "@/lib/notes/file-picker";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useNote } from "@/hooks/use-notes";
import { useTranslation } from "@/lib/i18n";
import { deleteNoteAction, saveNoteAction } from "@/lib/notes/actions";
import { AUTOSAVE_DELAY_MS, createAutosave } from "@/lib/notes/autosave";
import { useTheme } from "@/theme";

type Status = "idle" | "saving" | "saved" | "failed" | "invalid";

/**
 * One note, and almost nothing else.
 *
 * The screen is the editor, a title, and one line saying whether the writing is
 * safe. The timing lives in `lib/notes/autosave.ts` and the writing in
 * `lib/notes/actions.ts`, so what is left here is only what cannot be tested
 * without a device: mounting the editor and leaving at the right moment.
 */
export default function NoteScreen() {
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const t = useTranslation();
  const htmlStyle = useNoteHtmlStyle();

  const id = noteId ?? null;
  const { note, isLoading } = useNote(id);
  const { isOnline } = useNetworkStatus();

  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const titleRef = useRef(title);
  titleRef.current = title;

  const autosave = useMemo(
    () =>
      createAutosave({
        // `getHTML` and not `onChangeHtml`: the library parses HTML on every
        // keystroke if you let it, and says so in its own documentation. This
        // runs once, when the writing has stopped.
        read: async () => (editorRef.current ? editorRef.current.getHTML() : ""),
        save: async (document) => {
          // Through the ref, not the value: this object is built once per note
          // and the title changes on every keystroke, so closing over the value
          // would save the title the note had when it was opened.
          await saveNoteAction(id as string, {
            document,
            title: titleRef.current.trim(),
          });
        },
        delayMs: AUTOSAVE_DELAY_MS,
        onSaved: (result) => {
          setStatus(
            result.saved ? "saved" : result.reason === "invalid" ? "invalid" : "failed",
          );
        },
      }),
    [id],
  );

  useEffect(() => {
    if (note && note.title.length > 0) setTitle(note.title);
    // On the note's identity only: after this the field belongs to the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // Leaving the screen must not leave a save behind. The back button, the
  // browser bar, a swipe and a call all arrive here.
  useEffect(() => {
    const flush = (): void => {
      void autosave.flush();
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      subscription.remove();
      void autosave.flush();
    };
  }, [autosave]);

  const onDelete = useCallback(() => {
    Alert.alert(t("note.deleteConfirm"), t("note.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("note.delete"),
        style: "destructive",
        onPress: () => {
          autosave.cancel();
          void deleteNoteAction(id as string).then(() => router.back());
        },
      },
    ]);
  }, [autosave, id, router, t]);

  if (isLoading) return <View style={{ flex: 1 }} />;

  if (!note) {
    return (
      <View style={{ flex: 1, padding: theme.spacing.lg }}>
        <AppText tone="muted">{t("note.untitled")}</AppText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <TextField
        value={title}
        onChangeText={(value) => {
          setTitle(value);
          setStatus("saving");
          autosave.schedule();
        }}
        placeholder={t("note.titlePlaceholder")}
        autoCapitalize="sentences"
        onSubmitEditing={() => void autosave.flush()}
      />
      <NoteEditor
        editorRef={editorRef}
        defaultValue={note.document}
        placeholder={t("note.bodyPlaceholder")}
        htmlStyle={htmlStyle}
        onChanged={() => {
          setStatus("saving");
          autosave.schedule();
        }}
      />
      <NoteAttachments
        noteId={id as string}
        maxBytes={ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT}
        onPickImage={pickImage}
        onPickFile={pickAnyFile}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xs,
          gap: theme.spacing.md,
        }}
      >
        <AppText
          variant="caption"
          tone={status === "failed" || status === "invalid" ? "danger" : "muted"}
        >
          {statusLabel(status, isOnline, t)}
        </AppText>
        <AppText
          variant="caption"
          tone="muted"
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={t("note.delete")}
        >
          {t("note.delete")}
        </AppText>
      </View>
    </View>
  );
}

/**
 * What the line at the bottom says.
 *
 * "Saved" and "Saved on this device" are different words on purpose. A note that
 * is only on the phone has not been saved to anything yet, and a person who finds
 * out after handing the phone in was never told.
 */
function statusLabel(
  status: Status,
  isOnline: boolean,
  t: ReturnType<typeof useTranslation>,
): string {
  switch (status) {
    case "saving":
      return t("note.saving");
    case "saved":
      return isOnline ? t("note.saved") : t("note.savedOffline");
    case "invalid":
      return t("note.notEditable");
    case "failed":
      return t("note.saveFailed");
    default:
      return "";
  }
}
