import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";

import { MentionPickerSheet } from "@/components/mentions/mention-picker-sheet";
import type { MentionPick } from "@/components/mentions/mention-picker-sheet";
import { NoteEditor } from "@/components/notes/note-editor";
import { JournalDayView } from "@/components/journal/journal-day-view";
import { AppText } from "@/components/ui/text";
import { useJournalEntry, useMentionTargets } from "@/hooks/use-journal";
import { lookupIn, writeJournalEntry } from "@/lib/journal/entries";
import { mentionNameFor, renderMentions } from "@/lib/journal/mentions";
import { useTranslation } from "@/lib/i18n";
import { createAutosave } from "@/lib/notes/autosave";
import type { JournalDay } from "@orbit-hub/contracts";
import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

type Mode = "read" | "edit";

/**
 * One day of the journal.
 *
 * A day with words opens as it reads, with its chips pressable. A day without any
 * opens in the editor, and so does a day someone asks to edit. Leaving the editor
 * saves what is pending before the page reads again.
 *
 * Keyed by its day, so moving to another day is a new page. Its pending save is
 * flushed through `registerFlush` before the move, while the editor is still there.
 *
 * Opening a day writes nothing. A save that changes nothing is not a write.
 */
export function JournalDayPage({
  userId,
  day,
  registerFlush,
}: {
  userId: string;
  day: string;
  registerFlush: (flush: (() => Promise<void>) | null) => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const { record, loaded } = useJournalEntry(userId, day);
  const targets = useMentionTargets();
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;

  const [mode, setMode] = useState<Mode | null>(null);
  // Each entry into the editor is a new editor, drawn from what is stored then.
  const [session, setSession] = useState(0);
  const [editorDocument, setEditorDocument] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // The body as it was loaded or last written, to tell a real change from an echo.
  const savedRef = useRef<string>("");
  // Where the picker was asked for. A `@` typed by hand has already started the
  // mention in the editor; the toolbar button has not, and must start it itself.
  const mentionSource = useRef<"toolbar" | "typed">("toolbar");

  // A day with words opens as it reads; an empty one opens for writing.
  useEffect(() => {
    if (mode !== null || !loaded || targets === null) return;
    const hasWords = (record?.plainText ?? "").trim().length > 0;
    setMode(hasWords ? "read" : "edit");
  }, [mode, loaded, record, targets]);

  const autosave = useMemo(
    () =>
      createAutosave({
        read: async () => (editorRef.current ? editorRef.current.getHTML() : ""),
        save: async (document) => {
          if (document === savedRef.current) return;
          if (recordRef.current === null && noteDocumentToPlainText(document).length === 0) {
            savedRef.current = document;
            return;
          }
          await writeJournalEntry(userId, day as JournalDay, document);
          savedRef.current = document;
        },
      }),
    [userId, day],
  );

  useEffect(() => {
    registerFlush(() => autosave.flush().then(() => undefined));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void autosave.flush();
    });
    return () => {
      subscription.remove();
      registerFlush(null);
      void autosave.flush();
    };
  }, [autosave, registerFlush]);

  const lookup = useMemo(() => (targets === null ? null : lookupIn(targets)), [targets]);

  const edit = () => {
    if (lookup === null) return;
    savedRef.current = record?.document ?? "";
    setEditorDocument(
      renderMentions(record?.document ?? "", lookup, {
        mode: "editing",
        unavailableLabel: t("mention.unavailable"),
      }),
    );
    setSession((value) => value + 1);
    setMode("edit");
  };

  const done = async () => {
    await autosave.flush();
    setMode("read");
  };

  const onPick = (pick: MentionPick) => {
    setPickerOpen(false);
    const input = editorRef.current;
    if (!input) return;
    if (mentionSource.current === "toolbar") input.startMention("@");
    input.setMention("@", mentionNameFor(pick.name), { type: pick.type, id: pick.id });
    autosave.schedule();
  };

  if (mode === null || targets === null || lookup === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  if (mode === "read") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <JournalDayView
          document={record?.document ?? ""}
          lookup={lookup}
          targets={targets}
          onEdit={edit}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("journal.done")}
        onPress={() => void done()}
        style={{
          alignSelf: "flex-end",
          marginHorizontal: theme.spacing.lg,
          marginTop: theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
          height: 30,
          borderRadius: theme.radius.pill,
          justifyContent: "center",
          backgroundColor: theme.colors.accent,
        }}
      >
        <AppText variant="bodyStrong" style={{ color: theme.colors.onAccent }}>
          {t("journal.done")}
        </AppText>
      </Pressable>
      <NoteEditor
        key={session}
        editorRef={editorRef}
        defaultValue={editorDocument}
        placeholder={t("journal.placeholder")}
        onChanged={() => autosave.schedule()}
        onMentionRequest={(source) => {
          mentionSource.current = source;
          setPickerOpen(true);
        }}
      />
      <MentionPickerSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={onPick} />
    </View>
  );
}
