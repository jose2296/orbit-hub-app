import type { WidgetConfigurationScreenProps } from "react-native-android-widget";

import { PinnedListConfigScreen } from "./pinned-list-config";
import { QuickCaptureConfigScreen } from "./quick-capture-config";

/** Android has one configuration activity; it shows the screen of the widget being set up. */
export function WidgetConfigScreen(props: WidgetConfigurationScreenProps) {
  return props.widgetInfo.widgetName === "QuickCapture" ? (
    <QuickCaptureConfigScreen {...props} />
  ) : (
    <PinnedListConfigScreen {...props} />
  );
}
