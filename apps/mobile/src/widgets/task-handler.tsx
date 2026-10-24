import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { HelloWidget } from "./hello-widget";

/**
 * One handler for every widget: Android calls it for each event (added, update, resized, click)
 * and it picks the widget by its name.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  switch (props.widgetInfo.widgetName) {
    case "Hello":
      props.renderWidget(<HelloWidget />);
      return;
    default:
      return;
  }
}
