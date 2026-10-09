import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";

import { JournalDayView } from "@/components/journal/journal-day-view";
import { MentionPickerSheet } from "@/components/mentions/mention-picker-sheet";
import type { MentionPick } from "@/components/mentions/mention-picker-sheet";
import { AppText } from "@/components/ui/text";
import { NoteEditor } from "@/components/notes/note-editor";
import { useJournalEntry, useMentionTargets } from "@/hooks/use-journal";
import { lookupIn, writeJournalEntry } from "@/lib/journal/entries";
import { mentionChipFor, renderMentions } from "@/lib/journal/mentions";
import { useTranslation } from "@/lib/i18n";
import { createAutosave } from "@/lib/notes/autosave";
import type { JournalDay } from "@orbit-hub/contracts";
import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

/**
 * One day of the journal: read when it has words in it, open for writing when it
 * does not or when "Editar" was pressed.
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
  /**
   * Whether the day is being written or read.
   *
   * A day with words in it opens reading, and only the press of "Editar" opens the
   * editor. The reason is not a preference: the editor cannot receive a press on a
   * chip at all — the library gives no event for it, and on a phone there is no hook
   * to read it from, unlike the web, where the click is read from the page. A chip
   * that cannot be pressed is a chip that cannot take you anywhere, and taking you
   * somewhere is the only thing a chip is for. An empty day opens writing, because
   * there is nothing to read and the first thing one does with an empty day is write.
   */
  const [escribiendo, setEscribiendo] = useState(false);
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

  const router = useRouter();

  /**
   * Pressing a chip goes to what it points at. The editor takes the press itself, and
   * the library gives no event for a press on a chip inside it, so on the web the
   * click is read from the page. A phone has no such hook in this library.
   */
  useEffect(() => {
    if (Platform.OS !== "web" || targets === null || typeof document === "undefined") return;
    // Where the press started. A press that travelled is a drag, which belongs to the
    // day swipe, and must not also open the chip it began on.
    let start: { x: number; y: number } | null = null;
    const onDown = (event: MouseEvent) => {
      start = { x: event.clientX, y: event.clientY };
    };
    const onClick = (event: MouseEvent) => {
      const moved =
        start === null ? 0 : Math.hypot(event.clientX - start.x, event.clientY - start.y);
      start = null;
      if (moved > 8) return;
      const element = event.target instanceof Element ? event.target : null;
      const chip = element?.closest("mention");
      if (!chip || !chip.closest(".eti-editor")) return;
      const found = targets.get(`${chip.getAttribute("type")}:${chip.getAttribute("id")}`);
      if (found) router.push(found.route as never);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("click", onClick);
    };
  }, [targets, router]);

  const autosave = useMemo(
    () =>
      createAutosave({
        read: async () => {
          // With the editor unmounted —reading the day— there is nothing to read, and
          // answering with an empty document would write an empty one over the day.
          // The body as it was last loaded or written is what a flush has to find when
          // the editor is not on screen.
          return editorRef.current ? editorRef.current.getHTML() : savedRef.current;
        },
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
    // The chip is born looking like it reads: the colour of its space and the icon it
    // has now. Writing only the name and the plain trigger here made every new chip
    // arrive blue and icon-less, and only become what it should be on the next read.
    const chip = mentionChipFor(pick);
    input.setMention(chip.indicator, chip.text, { type: pick.type, id: pick.id });
    autosave.schedule();
  };

  if (initialDocument === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  // Reading: the day as it reads, with its chips drawn and pressable. The chips in the
  // editor are not pressable on a phone, so this is where a chip works.
  const entrada = record;
  if (!escribiendo && entrada !== null && entrada.plainText.trim().length > 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <JournalDayView
          document={entrada.document}
          lookup={lookupIn(targets ?? new Map())}
          targets={targets ?? new Map()}
          onEdit={() => setEscribiendo(true)}
        />
      </View>
    );
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
      {/* Back to reading, where a chip answers a press. Only once there is something
          to go back to: an empty day stays writing, because an empty day has nothing
          to read. */}
      {entrada !== null && entrada.plainText.trim().length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("journal.read")}
          onPress={() => {
            void autosave.flush();
            setEscribiendo(false);
          }}
          style={({ pressed }) => ({
            alignSelf: "center",
            marginBottom: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            height: 36,
            justifyContent: "center",
            borderRadius: theme.radius.pill,
            backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          })}
        >
          <AppText variant="bodyStrong">{t("journal.read")}</AppText>
        </Pressable>
      ) : null}
      <MentionPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(pick) => void onPick(pick)}
      />
    </View>
  );
}
