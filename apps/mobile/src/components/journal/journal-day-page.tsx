import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";

import { MentionPickerSheet } from "@/components/mentions/mention-picker-sheet";
import type { MentionPick } from "@/components/mentions/mention-picker-sheet";
import { NoteEditor } from "@/components/notes/note-editor";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { useJournalEntry, useMentionTargets } from "@/hooks/use-journal";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useTranslation } from "@/lib/i18n";
import { chipMatches, removeChip, replaceChip } from "@/lib/journal/chip-edit";
import type { ChipMatch } from "@/lib/journal/chip-edit";
import { lookupIn, writeJournalEntry } from "@/lib/journal/entries";
import { mentionChipFor, renderMentions } from "@/lib/journal/mentions";
import { createAutosave } from "@/lib/notes/autosave";
import { isTyping } from "@/lib/typing-state";
import type { JournalDay } from "@orbit-hub/contracts";
import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

/** Lo que tarda una hoja en desmontarse tras cerrarse (330 ms) y un poco mas. */
const SHEET_EXIT_MS = 400;

/** El chip sobre el que se abrio el menu: lo justo para encontrarlo otra vez en el documento. */
interface ChipTocado {
  type: string;
  id: string;
  text: string;
}

/**
 * One day of the journal, **in a single mode**: it is the editor, always, and there is nothing
 * to switch.
 *
 * A mention (chip) is a link and the editor has no press event for it, so touching one is
 * detected from where the cursor lands (`NoteEditor.onMentionTap`; on the web, from the click)
 * and it opens a small menu: open what it points at, change it for something else, or take the
 * link off and keep the name as text. Writing next to a chip does not open anything: only a
 * cursor *inside* it counts.
 *
 * Keyed by its day, so moving to another day is a new page. Its pending save is flushed through
 * `registerFlush` before the move, while the editor is still there.
 *
 * Opening a day writes nothing: a save that changes nothing is not a write, and an empty day
 * with no entry is not created by looking at it.
 */
export function JournalDayPage({
  userId,
  day,
  registerFlush,
  onEditingChange,
}: {
  userId: string;
  day: string;
  registerFlush: (flush: (() => Promise<void>) | null) => void;
  /** Se esta escribiendo (el editor tiene el foco): el gesto de cambiar de dia se apaga. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { record, loaded } = useJournalEntry(userId, day);
  const targets = useMentionTargets();
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;

  // The text is drawn once, when the entry and the names it links to are both in the cache.
  // After that the editor owns the text and the cache does not reset it.
  const [initialDocument, setInitialDocument] = useState<string | null>(null);
  // The body as it was loaded or last written, to tell a real change from an echo.
  const savedRef = useRef<string>("");

  // The picker serves two things: putting a new chip in, and changing the target of one that
  // is already there.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTarget = useRef<ChipTocado | null>(null);
  // Where the picker was asked for. A `@` typed by hand has already started the mention in the
  // editor; the toolbar button has not, and must start it itself.
  const mentionSource = useRef<"toolbar" | "typed">("toolbar");

  const [chipMenu, setChipMenu] = useState<ChipTocado | null>(null);

  // Foco del editor, y alto del teclado: "escribiendo" es las dos cosas en un movil (Android da
  // el foco al primer campo al abrir la pantalla, sin teclado). Ver `isTyping`.
  const [enfocado, setEnfocado] = useState(false);
  const alturaTeclado = useKeyboardHeight();
  const escribiendo = isTyping({
    focused: enfocado,
    keyboardHeight: alturaTeclado,
    platform: Platform.OS,
  });
  useEffect(() => {
    onEditingChange?.(escribiendo);
  }, [escribiendo, onEditingChange]);
  // La pagina se va con su dia: si estaba escribiendo, el gesto de cambiar de dia tiene que
  // volver a encenderse.
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);

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

  /** Un chip tocado: se abre su menu. Lo llaman el editor nativo y el clic de la web. */
  const onChipTouched = useCallback((chip: ChipTocado) => setChipMenu(chip), []);

  /**
   * On the web a click on a chip is read from the page, because the editor gives no event for
   * it. A press that travelled is a drag (a selection), and must not open the menu of the chip
   * it began on.
   */
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
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
      onChipTouched({
        type: chip.getAttribute("type") ?? "",
        id: chip.getAttribute("id") ?? "",
        text: chip.textContent ?? "",
      });
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("click", onClick);
    };
  }, [onChipTouched]);

  const autosave = useMemo(
    () =>
      createAutosave({
        read: async () => editorRef.current?.getHTML() ?? savedRef.current,
        save: async (document) => {
          if (document === savedRef.current) return;
          // An empty day with no entry is not created by looking at it.
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

  /** El chip del menu, tal como esta ahora en el documento del editor. */
  const currentChip = async (
    touched: ChipTocado,
  ): Promise<{ html: string; match: ChipMatch } | null> => {
    const html = await editorRef.current?.getHTML();
    if (!html) return null;
    const same = chipMatches(html).filter((c) => c.type === touched.type && c.id === touched.id);
    const match = same.find((c) => c.text.trim() === touched.text.trim()) ?? same[0];
    return match ? { html, match } : null;
  };

  /**
   * Cerrar el menu deja el cursor justo despues del chip. Sin esto el cursor sigue *dentro* y
   * tocar el mismo chip otra vez no mueve nada, asi que no volveria a abrir el menu.
   */
  const closeChipMenu = async (touched: ChipTocado | null) => {
    setChipMenu(null);
    if (!touched) return;
    const found = await currentChip(touched);
    if (found) editorRef.current?.setSelection(found.match.plainEnd, found.match.plainEnd);
  };

  const openChip = (touched: ChipTocado) => {
    const route = targets?.get(`${touched.type}:${touched.id}`)?.route;
    setChipMenu(null);
    if (route) router.push(route as never);
  };

  const unlinkChip = async (touched: ChipTocado) => {
    setChipMenu(null);
    const found = await currentChip(touched);
    if (!found) return;
    editorRef.current?.setValue(removeChip(found.html, found.match));
    autosave.schedule();
  };

  const changeChip = (touched: ChipTocado) => {
    setChipMenu(null);
    pickerTarget.current = touched;
    // Un `Sheet` sigue montado 330 ms despues de cerrarse, y un `Modal` que se abre mientras otro
    // se va no llega a mostrarse (probado en Android: el selector nunca aparecia). Se espera a que
    // el menu se haya ido del todo.
    setTimeout(() => setPickerOpen(true), SHEET_EXIT_MS);
  };

  /**
   * Puts the chosen thing in the note, or in place of the chip being changed, and gives the
   * cursor back to the editor so the person carries on writing where they were.
   */
  const onPick = async (pick: MentionPick) => {
    setPickerOpen(false);
    const input = editorRef.current;
    if (!input) return;
    const chip = mentionChipFor(pick);

    const replacing = pickerTarget.current;
    pickerTarget.current = null;
    if (replacing) {
      const found = await currentChip(replacing);
      if (found) {
        input.setValue(
          replaceChip(found.html, found.match, {
            indicator: chip.indicator,
            text: chip.text,
            type: pick.type,
            id: pick.id,
          }),
        );
        autosave.schedule();
      }
      return;
    }

    // A trigger only opens at the start of a word, so the `@` goes after a space when the text
    // does not already end in one.
    const text = noteDocumentToPlainText(await input.getHTML());
    const needsSpace = text.length > 0 && !/\s$/.test(text);
    input.focus();
    if (mentionSource.current === "toolbar") input.startMention(needsSpace ? " @" : "@");
    // The chip is born looking like it reads: the colour of its space and the icon it has now.
    input.setMention(chip.indicator, chip.text, { type: pick.type, id: pick.id });
    autosave.schedule();
  };

  if (initialDocument === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  const chipTitle = chipMenu ? chipMenu.text.replace(/ /g, "").trim() : "";
  const chipRoute = chipMenu ? targets?.get(`${chipMenu.type}:${chipMenu.id}`)?.route : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <NoteEditor
        editorRef={editorRef}
        defaultValue={initialDocument}
        placeholder={t("journal.placeholder")}
        autoGrow
        onChanged={() => autosave.schedule()}
        onFocusChange={setEnfocado}
        onMentionTap={Platform.OS === "web" ? undefined : onChipTouched}
        onMentionRequest={(source) => {
          mentionSource.current = source;
          pickerTarget.current = null;
          setPickerOpen(true);
        }}
      />
      <Sheet visible={chipMenu !== null} onClose={() => void closeChipMenu(chipMenu)} title={chipTitle}>
        <SheetOptions
          options={[
            {
              key: "open",
              label: t("journal.chip.open"),
              description: chipRoute ? undefined : t("mention.unavailable"),
              icon: "open-outline" as const,
              disabled: !chipRoute,
              onPress: () => chipMenu && openChip(chipMenu),
            },
            {
              key: "change",
              label: t("journal.chip.change"),
              icon: "swap-horizontal-outline" as const,
              onPress: () => chipMenu && changeChip(chipMenu),
            },
            {
              key: "unlink",
              label: t("journal.chip.unlink"),
              icon: "unlink-outline" as const,
              onPress: () => chipMenu && void unlinkChip(chipMenu),
            },
          ]}
        />
      </Sheet>
      <MentionPickerSheet
        visible={pickerOpen}
        onClose={() => {
          pickerTarget.current = null;
          setPickerOpen(false);
        }}
        onPick={(pick) => void onPick(pick)}
      />
    </View>
  );
}
