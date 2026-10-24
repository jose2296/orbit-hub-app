import { Platform } from "react-native";

/** Every widget the app offers, by the name its provider has in `app.json`. */
const WIDGET_NAMES = [
  "PinnedList",
  "QuickCapture",
  "JournalToday",
  "Shortcuts",
  "Dashboard",
] as const;

/**
 * Repaints every widget on the home screen from the local copy. The app calls it when it goes to
 * the background, so what was edited or synced shows without waiting for the launcher's own
 * update. A no-op outside Android and when nothing is on the home screen.
 */
export async function refreshWidgets(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const { requestWidgetUpdate } =
      require("react-native-android-widget") as typeof import("react-native-android-widget");
    const { viewOf } =
      require("./widget-views") as typeof import("./widget-views");
    await Promise.all(
      WIDGET_NAMES.map((widgetName) =>
        requestWidgetUpdate({
          widgetName,
          renderWidget: async (info) =>
            (await viewOf(widgetName, info.widgetId)) ?? <></>,
        }),
      ),
    );
  } catch {
    // A widget that fails to repaint must never take the app down with it.
  }
}
