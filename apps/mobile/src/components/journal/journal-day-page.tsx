import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";

import { JournalDayView } from "@/components/journal/journal-day-view";
import { MentionPickerSheet } from "@/components/mentions/mention-picker-sheet";
import type { MentionPick } from "@/components/mentions/mention-picker-sheet";
import { NoteEditor } from "@/components/notes/note-editor";
import { useJournalEntry, useMentionTargets } from "@/hooks/use-journal";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { isTyping } from "@/lib/typing-state";
import { lookupIn, writeJournalEntry } from "@/lib/journal/entries";
import { mentionChipFor, renderMentions } from "@/lib/journal/mentions";
import { useTranslation } from "@/lib/i18n";
import { createAutosave } from "@/lib/notes/autosave";
import type { JournalDay } from "@orbit-hub/contracts";
import { noteDocumentToPlainText } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

/**
 * One day of the journal, **always editable**: there is no read/edit switch to press.
 *
 * On the web the editor is simply there, and a click on a chip goes to what it points
 * at (read from the page). On a phone the editor cannot take a press on a chip, so a day
 * with words rests as the rendered text, where a chip answers a press, and a tap on the
 * text itself puts the cursor in; leaving the editor puts it back. Either way the person
 * never chooses a mode: they tap, and either something opens or they are writing.
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
   * Whether the editor is on screen, **in the platforms where it is not always**.
   *
   * On the web it always is. On a phone a day with words rests as rendered text because
   * the editor gives no event for a press on a chip (the library only has
   * `onMentionPress` on its read-only component), and a chip that cannot be pressed
   * cannot take you anywhere. A tap on the text switches to the editor, and losing focus
   * switches back. An empty day has nothing to read, so it is the editor from the start.
   */
  const [escribiendo, setEscribiendo] = useState(false);
  // El editor se monta por un toque y debe nacer con el cursor dentro.
  const [enfocarAlMontar, setEnfocarAlMontar] = useState(false);
  // El selector de menciones es una hoja: abrirla le quita el foco al editor, y eso no es
  // "terminar de escribir". Sin esta marca el editor se desmontaria con la hoja abierta y
  // `onPick` se quedaria sin editor al que escribir.
  const pickerAbierto = useRef(false);
  // Foco del editor, y alto del teclado: "escribiendo" es las dos cosas en un movil (Android da
  // el foco al primer campo al abrir la pantalla, sin teclado). Ver `isTyping`.
  const [enfocado, setEnfocado] = useState(false);
  const alturaTeclado = useKeyboardHeight();
  const escribiendoDeVerdad = isTyping({
    focused: enfocado,
    keyboardHeight: alturaTeclado,
    platform: Platform.OS,
  });
  useEffect(() => {
    onEditingChange?.(escribiendoDeVerdad);
  }, [escribiendoDeVerdad, onEditingChange]);
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

  // La pagina se va con su dia: si estaba escribiendo, el gesto de cambiar de dia tiene
  // que volver a encenderse.
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
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

  // Al cerrarse el teclado (el boton de atras del sistema, por ejemplo) el editor sigue
  // enfocado y, siendo nativo, seguiria comiendose los toques: se desmonta y el dia vuelve a
  // descansar como texto, que es donde el swipe funciona.
  const tecladoVisto = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (alturaTeclado > 0) {
      tecladoVisto.current = true;
      return;
    }
    if (tecladoVisto.current && escribiendo && !pickerAbierto.current) {
      tecladoVisto.current = false;
      void autosave.flush();
      setEnfocarAlMontar(false);
      setEscribiendo(false);
    }
  }, [alturaTeclado, escribiendo, autosave]);

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
    pickerAbierto.current = false;
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
  // En un movil el editor (un `EditText` nativo) se queda con TODOS los toques de la pagina y
  // ningun padre puede interceptarlos: con el editor montado no hay swipe entre dias posible. Asi
  // que el dia descansa siempre como texto (o como su hueco, si esta vacio) y el editor solo se
  // monta al tocar para escribir.
  if (Platform.OS !== "web" && !escribiendo) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <JournalDayView
          document={entrada?.document ?? ""}
          placeholder={t("journal.placeholder")}
          lookup={lookupIn(targets ?? new Map())}
          targets={targets ?? new Map()}
          onEdit={() => {
            setEnfocarAlMontar(true);
            setEscribiendo(true);
          }}
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
        autoFocus={enfocarAlMontar}
        onChanged={() => autosave.schedule()}
        onFocusChange={(focused) => {
          setEnfocado(focused);
          // Terminar de escribir devuelve el dia a su lectura, donde un enlace responde a un
          // toque. Solo en el movil, y no si el foco se fue porque se abrio el selector.
          if (!focused && Platform.OS !== "web" && !pickerAbierto.current) {
            void autosave.flush();
            setEnfocarAlMontar(false);
            setEscribiendo(false);
          }
        }}
        onMentionRequest={(source) => {
          mentionSource.current = source;
          pickerAbierto.current = true;
          setPickerOpen(true);
        }}
      />
      <MentionPickerSheet
        visible={pickerOpen}
        onClose={() => {
          pickerAbierto.current = false;
          setPickerOpen(false);
        }}
        onPick={(pick) => void onPick(pick)}
      />
    </View>
  );
}
