import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { clearWidgetConfig, readWidgetConfig } from "./config-store";
import type { PinnedListConfig, QuickCaptureConfig } from "./config-store";
import { HelloWidget } from "./hello-widget";
import { completeItem, loadCaptureTargets, loadPinnedList } from "./pinned-list-data";
import { PinnedListWidget } from "./pinned-list-widget";
import type { PinnedListView } from "./pinned-list-widget";
import { QuickCaptureWidget } from "./quick-capture-widget";
import { widgetStrings } from "./strings";

async function viewOfPinnedList(widgetId: number): Promise<PinnedListView> {
  const config = await readWidgetConfig<PinnedListConfig>(widgetId);
  if (!config) return { state: "unconfigured" };
  const data = await loadPinnedList(config.listId);
  return data ? { state: "ready", data } : { state: "missing" };
}

/**
 * One handler for every widget: Android calls it for each event (added, update, resized, click)
 * and it picks the widget by its name.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;

  switch (widgetInfo.widgetName) {
    case "Hello":
      renderWidget(<HelloWidget />);
      return;

    case "PinnedList": {
      if (widgetAction === "WIDGET_DELETED") {
        await clearWidgetConfig(widgetInfo.widgetId);
        return;
      }
      if (widgetAction === "WIDGET_CLICK" && clickAction === "TOGGLE") {
        const itemId = clickActionData?.["itemId"];
        if (typeof itemId === "string") await completeItem(itemId);
      }
      renderWidget(
        <PinnedListWidget view={await viewOfPinnedList(widgetInfo.widgetId)} t={widgetStrings()} />,
      );
      return;
    }

    case "QuickCapture": {
      if (widgetAction === "WIDGET_DELETED") {
        await clearWidgetConfig(widgetInfo.widgetId);
        return;
      }
      const config = await readWidgetConfig<QuickCaptureConfig>(widgetInfo.widgetId);
      renderWidget(
        <QuickCaptureWidget
          targets={config ? await loadCaptureTargets(config) : null}
          t={widgetStrings()}
        />,
      );
      return;
    }

    default:
      return;
  }
}
