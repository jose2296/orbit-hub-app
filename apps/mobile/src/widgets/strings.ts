import { getLocales } from "expo-localization";

export interface WidgetStrings {
  pickList: string;
  pickListHint: string;
  allDone: string;
  pending_one: string;
  pending_other: string;
  missing: string;
  more: string;
  newTask: string;
  newNote: string;
  taskWhere: string;
  noteWhere: string;
  skip: string;
  back: string;
  nothingHere: string;
  setUp: string;
  unclassified: string;
  pickNote: string;
  pickNoteHint: string;
  noteMissing: string;
  emptyNote: string;
  summaryTitle: string;
  pendingWord: string;
  journalDone: string;
  journalPending: string;
  shortcutsTitle: string;
  pickHere: string;
  done: string;
  writeToday: string;
  emptyDay: string;
}

const dictionary: Record<"es" | "en", WidgetStrings> = {
  es: {
    pickList: "Elige una lista",
    pickListHint: "Toca para configurar el widget",
    allDone: "Todo hecho",
    pending_one: "1 pendiente",
    pending_other: "pendientes",
    missing: "La lista ya no está",
    more: "más",
    newTask: "Nueva tarea",
    newNote: "Nueva nota",
    taskWhere: "¿En qué lista van las tareas?",
    noteWhere: "¿En qué espacio van las notas?",
    skip: "Omitir",
    unclassified: "Sin clasificar",
    pickNote: "Elige una nota",
    pickNoteHint: "Toca para configurar el widget",
    noteMissing: "La nota ya no está",
    emptyNote: "La nota está vacía",
    summaryTitle: "Hoy",
    pendingWord: "pendientes",
    journalDone: "Diario de hoy escrito",
    journalPending: "Diario de hoy sin escribir",
    shortcutsTitle: "Elige tus atajos",
    pickHere: "Elegir este sitio",
    done: "Listo",
    writeToday: "Escribir",
    emptyDay: "Nada escrito hoy todavía",
    back: "Atrás",
    nothingHere: "No hay listas de tareas aquí",
    setUp: "Configura el widget",
  },
  en: {
    pickList: "Pick a list",
    pickListHint: "Tap to set up the widget",
    allDone: "All done",
    pending_one: "1 pending",
    pending_other: "pending",
    missing: "That list is gone",
    more: "more",
    newTask: "New task",
    newNote: "New note",
    taskWhere: "Which list do tasks go to?",
    noteWhere: "Which space do notes go to?",
    skip: "Skip",
    unclassified: "Unsorted",
    pickNote: "Pick a note",
    pickNoteHint: "Tap to set up the widget",
    noteMissing: "The note is gone",
    emptyNote: "The note is empty",
    summaryTitle: "Today",
    pendingWord: "pending",
    journalDone: "Today's journal written",
    journalPending: "Today's journal not written yet",
    shortcutsTitle: "Choose your shortcuts",
    pickHere: "Choose this place",
    done: "Done",
    writeToday: "Write",
    emptyDay: "Nothing written today yet",
    back: "Back",
    nothingHere: "No task lists here",
    setUp: "Set up the widget",
  },
};

/** The widget's words, in the phone's language (Spanish or English). */
export function widgetStrings(): WidgetStrings {
  const language = getLocales()[0]?.languageCode ?? "en";
  return language === "es" ? dictionary.es : dictionary.en;
}
