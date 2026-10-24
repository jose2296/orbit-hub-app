import type { WidgetConfigurationScreenProps } from "react-native-android-widget";

import { PinnedListConfigScreen } from "./pinned-list-config";
import { PinnedNoteConfigScreen } from "./note-config";
import { QuickCaptureConfigScreen } from "./quick-capture-config";
import { ShortcutsConfigScreen } from "./shortcuts-config";

/** Android has one configuration activity; it shows the screen of the widget being set up. */
export function WidgetConfigScreen(props: WidgetConfigurationScreenProps) {
  switch (props.widgetInfo.widgetName) {
    case "QuickCapture":
      return <QuickCaptureConfigScreen {...props} />;
    case "PinnedNote":
      return <PinnedNoteConfigScreen {...props} />;
    case "Shortcuts":
      return <ShortcutsConfigScreen {...props} />;
    default:
      return <PinnedListConfigScreen {...props} />;
  }
}
