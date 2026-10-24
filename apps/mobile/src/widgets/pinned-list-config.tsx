import type { WidgetConfigurationScreenProps } from "react-native-android-widget";

import { writeWidgetConfig } from "./config-store";
import type { PinnedListConfig } from "./config-store";
import { ConfigFrame } from "./config-frame";
import { ListPicker } from "./list-picker";
import { loadPinnedList } from "./pinned-list-data";
import { PinnedListWidget } from "./pinned-list-widget";
import { widgetStrings } from "./strings";

/**
 * The screen Android opens when a pinned-list widget is dropped on the home screen, and again when
 * it is reconfigured.
 */
export function PinnedListConfigScreen({
  widgetInfo,
  renderWidget,
  setResult,
}: WidgetConfigurationScreenProps) {
  const t = widgetStrings();

  const choose = async (listId: string) => {
    const config: PinnedListConfig = { listId };
    await writeWidgetConfig(widgetInfo.widgetId, config);
    const data = await loadPinnedList(listId);
    if (data)
      renderWidget(<PinnedListWidget view={{ state: "ready", data }} t={t} />);
    setResult("ok");
  };

  return (
    <ConfigFrame title={t.pickList} onClose={() => setResult("cancel")}>
      <ListPicker onPick={(id) => void choose(id)} emptyLabel={t.nothingHere} />
    </ConfigFrame>
  );
}
