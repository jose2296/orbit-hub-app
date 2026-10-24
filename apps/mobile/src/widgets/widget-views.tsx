import type { ReactElement } from "react";
import type { WidgetRepresentation } from "react-native-android-widget";

import { readWidgetConfig } from "./config-store";
import type {
  PinnedListConfig,
  PinnedNoteConfig,
  QuickCaptureConfig,
  ShortcutsConfig,
} from "./config-store";
import { loadDashboard } from "./dashboard-data";
import { DashboardWidget } from "./dashboard-widget";
import { HelloWidget } from "./hello-widget";
import { loadJournalToday } from "./journal-data";
import { JournalWidget } from "./journal-widget";
import { loadCaptureTargets, loadPinnedList } from "./pinned-list-data";
import { loadPinnedNote } from "./note-data";
import { PinnedNoteWidget } from "./note-widget";
import type { PinnedNoteView } from "./note-widget";
import { darkPalette, lightPalette } from "./palette";
import type { Palette } from "./palette";
import { PinnedListWidget } from "./pinned-list-widget";
import type { PinnedListView } from "./pinned-list-widget";
import { QuickCaptureWidget } from "./quick-capture-widget";
import { ShortcutsWidget } from "./shortcuts-widget";
import { widgetStrings } from "./strings";

/** A widget in both looks: the launcher picks the one that matches the system theme. */
export function bothLooks(
  render: (palette: Palette) => ReactElement,
): WidgetRepresentation {
  return { light: render(lightPalette), dark: render(darkPalette) };
}

async function viewOfPinnedList(widgetId: number): Promise<PinnedListView> {
  const config = await readWidgetConfig<PinnedListConfig>(widgetId);
  if (!config) return { state: "unconfigured" };
  const data = await loadPinnedList(config.listId);
  return data ? { state: "ready", data } : { state: "missing" };
}

async function viewOfPinnedNote(widgetId: number): Promise<PinnedNoteView> {
  const config = await readWidgetConfig<PinnedNoteConfig>(widgetId);
  if (!config) return { state: "unconfigured" };
  const data = await loadPinnedNote(config.noteId);
  return data ? { state: "ready", data } : { state: "missing" };
}

/** What a widget instance draws right now, from the local copy; `null` for a name nobody knows. */
export async function viewOf(
  widgetName: string,
  widgetId: number,
): Promise<WidgetRepresentation | null> {
  const t = widgetStrings();
  switch (widgetName) {
    case "Hello":
      return bothLooks(() => <HelloWidget />);

    case "PinnedList":
      const view = await viewOfPinnedList(widgetId);
      return bothLooks((palette) => (
        <PinnedListWidget view={view} t={t} palette={palette} />
      ));

    case "PinnedNote": {
      const view = await viewOfPinnedNote(widgetId);
      return bothLooks((palette) => (
        <PinnedNoteWidget view={view} t={t} palette={palette} />
      ));
    }

    case "QuickCapture": {
      const config = await readWidgetConfig<QuickCaptureConfig>(widgetId);
      return (
        <QuickCaptureWidget
          targets={config ? await loadCaptureTargets(config) : null}
          t={t}
        />
      );
    }

    case "Shortcuts":
      return (
        <ShortcutsWidget
          config={await readWidgetConfig<ShortcutsConfig>(widgetId)}
          t={t}
        />
      );

    case "Dashboard": {
      const summary = await loadDashboard();
      return bothLooks((palette) => (
        <DashboardWidget summary={summary} t={t} palette={palette} />
      ));
    }

    case "JournalToday": {
      const today = await loadJournalToday();
      const [y, m, d] = today.day.split("-").map(Number);
      const dateLabel = new Date(y!, m! - 1, d).toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      return bothLooks((palette) => (
        <JournalWidget
          today={today}
          t={t}
          dateLabel={dateLabel}
          palette={palette}
        />
      ));
    }

    default:
      return null;
  }
}
