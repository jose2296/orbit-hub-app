import type { ReactElement } from "react";

import { readWidgetConfig } from "./config-store";
import type {
  PinnedListConfig,
  QuickCaptureConfig,
  ShortcutsConfig,
} from "./config-store";
import { loadDashboard } from "./dashboard-data";
import { DashboardWidget } from "./dashboard-widget";
import { HelloWidget } from "./hello-widget";
import { loadJournalToday } from "./journal-data";
import { JournalWidget } from "./journal-widget";
import { loadCaptureTargets, loadPinnedList } from "./pinned-list-data";
import { PinnedListWidget } from "./pinned-list-widget";
import type { PinnedListView } from "./pinned-list-widget";
import { QuickCaptureWidget } from "./quick-capture-widget";
import { ShortcutsWidget } from "./shortcuts-widget";
import { widgetStrings } from "./strings";

async function viewOfPinnedList(widgetId: number): Promise<PinnedListView> {
  const config = await readWidgetConfig<PinnedListConfig>(widgetId);
  if (!config) return { state: "unconfigured" };
  const data = await loadPinnedList(config.listId);
  return data ? { state: "ready", data } : { state: "missing" };
}

/** What a widget instance draws right now, from the local copy; `null` for a name nobody knows. */
export async function viewOf(
  widgetName: string,
  widgetId: number,
): Promise<ReactElement | null> {
  const t = widgetStrings();
  switch (widgetName) {
    case "Hello":
      return <HelloWidget />;

    case "PinnedList":
      return <PinnedListWidget view={await viewOfPinnedList(widgetId)} t={t} />;

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

    case "Dashboard":
      return <DashboardWidget summary={await loadDashboard()} t={t} />;

    case "JournalToday": {
      const today = await loadJournalToday();
      const [y, m, d] = today.day.split("-").map(Number);
      const dateLabel = new Date(y!, m! - 1, d).toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      return <JournalWidget today={today} t={t} dateLabel={dateLabel} />;
    }

    default:
      return null;
  }
}
