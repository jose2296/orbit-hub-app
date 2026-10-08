import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, View } from "react-native";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";

import { MentionPickerSheet } from "@/components/mentions/mention-picker-sheet";
import type { MentionPick } from "@/components/mentions/mention-picker-sheet";
import { NoteEditor } from "@/components/notes/note-editor";
import { AppText } from "@/components/ui/text";
import { useJournalEntry, useMentionTargets } from "@/hooks/use-journal";
import { lookupIn, writeJournalEntry } from "@/lib/journal/entries";
import {
  mentionNameFor,
  mentionsIn,
  renderMentions,
} from "@/lib/journal/mentions";
import type { MentionTarget } from "@/lib/journal/mentions";
import { useTranslation } from "@/lib/i18n";
import { createAutosave } from "@/lib/notes/autosave";
import type { JournalDay } from "@orbit-hub/contracts";
import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

/**
 * One day of the journal, as an editor.
 *
 * The page is keyed by its day, so moving to another day is a new page and the
 * editor of the old one is gone. Its pending save is flushed through
 * `registerFlush` before the move, while the editor is still on screen to be read.
 *
 * Opening a day writes nothing. Only typing schedules a save, and a save of an
 * empty day with no entry yet is skipped, so swiping through a month does not
 * leave a month of empty rows behind.
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
  const router = useRouter();
  const { record, loaded } = useJournalEntry(userId, day);
  const targets = useMentionTargets();
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;

  const [initialDocument, setInitialDocument] = useState<string | null>(null);
  // The body as it was loaded or last written, to tell a real change from an echo.
  const savedRef = useRef<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Where the picker was asked for. A `@` typed by hand has already started the
  // mention in the editor; the toolbar button has not, and must start it itself.
  const mentionSource = useRef<"toolbar" | "typed">("toolbar");

  // The text is drawn once, when the entry and the names it links to are both in
  // the cache. After that the editor owns the text and the cache does not reset it.
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
          // The editor reports a change when it is given its text, as well as when
          // somebody types. A save that changes nothing is not a write: without this
          // every day a person looked at would be saved on the way out.
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

  const onPick = (pick: MentionPick) => {
    setPickerOpen(false);
    const input = editorRef.current;
    if (!input) return;
    if (mentionSource.current === "toolbar") input.startMention("@");
    input.setMention("@", mentionNameFor(pick.name), { type: pick.type, id: pick.id });
    autosave.schedule();
  };

  const links = useMemo(() => {
    if (targets === null || !record) return [];
    const found: Array<{ key: string; target: MentionTarget }> = [];
    for (const mention of mentionsIn(record.document)) {
      const target = targets.get(`${mention.type}:${mention.id}`);
      if (target) found.push({ key: `${mention.type}:${mention.id}`, target });
    }
    return found;
  }, [record, targets]);

  if (initialDocument === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {links.length > 0 ? (
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
            gap: theme.spacing.xs,
          }}
        >
          <AppText variant="caption" tone="subtle">
            {t("journal.links")}
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: theme.spacing.xs }}>
              {links.map(({ key, target }) => (
                <Pressable
                  key={key}
                  accessibilityRole="link"
                  accessibilityLabel={`${t("journal.openLink")}: ${target.name}`}
                  onPress={() => router.push(target.route as never)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: theme.spacing.sm,
                    height: 32,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.accentSoft,
                  }}
                >
                  <Ionicons name="at" size={14} color={theme.colors.accentSoftText} />
                  <AppText variant="caption" style={{ color: theme.colors.accentSoftText }}>
                    {target.name}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

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
        onPick={onPick}
      />
    </View>
  );
}
