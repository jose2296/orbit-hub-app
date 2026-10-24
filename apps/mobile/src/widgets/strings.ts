import { getLocales } from "expo-localization";

export interface WidgetStrings {
  pickList: string;
  pickListHint: string;
  allDone: string;
  pending_one: string;
  pending_other: string;
  missing: string;
  more: string;
}

const dictionary: Record<"es" | "en", WidgetStrings> = {
  es: {
    pickList: "Elige una lista",
    pickListHint: "Toca para configurar el widget",
    allDone: "Todo hecho",
    pending_one: "1 pendiente",
    pending_other: "pendientes",
    missing: "La lista ya no esta",
    more: "mas",
  },
  en: {
    pickList: "Pick a list",
    pickListHint: "Tap to set up the widget",
    allDone: "All done",
    pending_one: "1 pending",
    pending_other: "pending",
    missing: "That list is gone",
    more: "more",
  },
};

/** The widget's words, in the phone's language (Spanish or English). */
export function widgetStrings(): WidgetStrings {
  const language = getLocales()[0]?.languageCode ?? "en";
  return language === "es" ? dictionary.es : dictionary.en;
}
