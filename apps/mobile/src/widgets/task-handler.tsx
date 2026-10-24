import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { clearWidgetConfig } from "./config-store";
import { completeItem } from "./pinned-list-data";
import { viewOf } from "./widget-views";

/** The widgets that keep a choice per instance, to be forgotten when the instance is removed. */
const CONFIGURED = new Set(["PinnedList", "QuickCapture", "Shortcuts"]);

/**
 * One handler for every widget: Android calls it for each event (added, update, resized, click)
 * and it picks the widget by its name.
 */
export async function widgetTaskHandler(
  props: WidgetTaskHandlerProps,
): Promise<void> {
  const {
    widgetInfo,
    widgetAction,
    clickAction,
    clickActionData,
    renderWidget,
  } = props;

  if (widgetAction === "WIDGET_DELETED") {
    if (CONFIGURED.has(widgetInfo.widgetName))
      await clearWidgetConfig(widgetInfo.widgetId);
    return;
  }

  if (
    widgetInfo.widgetName === "PinnedList" &&
    widgetAction === "WIDGET_CLICK" &&
    clickAction === "TOGGLE"
  ) {
    const itemId = clickActionData?.["itemId"];
    if (typeof itemId === "string") await completeItem(itemId);
  }

  const view = await viewOf(widgetInfo.widgetName, widgetInfo.widgetId);
  if (view) renderWidget(view);
}
