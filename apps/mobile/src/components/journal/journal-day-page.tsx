import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";

import { MentionPickerSheet } from "@/components/mentions/mention-picker-sheet";
import type { MentionPick } from "@/components/mentions/mention-picker-sheet";
import { NoteEditor } from "@/components/notes/note-editor";
import { useJournalEntry, useMentionTargets } from "@/hooks/use-journal";
import { lookupIn, writeJournalEntry } from "@/lib/journal/entries";
import { mentionNameFor, renderMentions } from "@/lib/journal/mentions";
import { useTranslation } from "@/lib/i18n";
import { createAutosave } from "@/lib/notes/autosave";
import type { JournalDay } from "@orbit-hub/contracts";
import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

/**
 * One day of the journal, always open for writing.
 *
 * Keyed by its day, so moving to another day is a new page. Its pending save is
 * flushed through `registerFlush` before the move, while the editor is still there.
 *
 * Opening a day writes nothing: a save that changes nothing is not a write, and an
 * empty day with no entry is not created by looking at it.
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

  // The text is drawn once, when the entry and the names it links to are both in
  // the cache. After that the editor owns the text and the cache does not reset it.
  const [initialDocument, setInitialDocument] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The body as it was loaded or last written, to tell a real change from an echo.
  const savedRef = useRef<string>("");
  // Where the picker was asked for. A `@` typed by hand has already started the
  // mention in the editor; the toolbar button has not, and must start it itself.
  const mentionSource = useRef<"toolbar" | "typed">("toolbar");

  useEffect(() => {
    if (initialDocument !== null || !loaded || targets === null) return;
    savedRef.current = record?.document ?? "";
    setInitialDocument(
      renderMentions(record?.document ?? "", lookupIn(targets), {
        mode: "editing",
        unavailableLabel: t("mention.unavailable"),
      }),
    );
  }, [initialDocument, loaded, record, targets, t]);

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

  /**
   * Puts the chosen thing in the note and gives the cursor back to the editor, so
   * the person carries on writing where they were. The picker has already closed.
   */
  const onPick = async (pick: MentionPick) => {
    setPickerOpen(false);
    const input = editorRef.current;
    if (!input) return;
    // A trigger only opens at the start of a word, so the `@` goes after a space when
    // the text does not already end in one.
    const text = noteDocumentToPlainText(await input.getHTML());
    const needsSpace = text.length > 0 && !/\s$/.test(text);
    input.focus();
    if (mentionSource.current === "toolbar") input.startMention(needsSpace ? " @" : "@");
    input.setMention("@", mentionNameFor(pick.name), { type: pick.type, id: pick.id });
    autosave.schedule();
  };

  if (initialDocument === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <NoteEditor
        editorRef={editorRef}
        defaultValue={initialDocument}
        placeholder={t("journal.placeholder")}
        onChanged={() => autosave.schedule()}
        onMentionRequest={(source) => {
          mentionSource.current = source;
          setPickerOpen(true);
        }}
      />
      <MentionPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(pick) => void onPick(pick)}
      />
    </View>
  );
}
