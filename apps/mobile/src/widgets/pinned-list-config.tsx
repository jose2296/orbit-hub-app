import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { WidgetConfigurationScreenProps } from "react-native-android-widget";

import { writeWidgetConfig } from "./config-store";
import type { PinnedListConfig } from "./config-store";
import { listPinnableLists, loadPinnedList } from "./pinned-list-data";
import { PinnedListWidget } from "./pinned-list-widget";
import { widgetPalette as color } from "./palette";
import { widgetStrings } from "./strings";

type Row = Awaited<ReturnType<typeof listPinnableLists>>[number];

/**
 * The screen Android opens when a pinned-list widget is dropped on the home screen, and again when
 * it is reconfigured. It lives in its own React root, outside the app's providers, so it is plain
 * views with the widget palette.
 */
export function PinnedListConfigScreen({
  widgetInfo,
  renderWidget,
  setResult,
}: WidgetConfigurationScreenProps) {
  const t = widgetStrings();
  const [lists, setLists] = useState<Row[] | null>(null);

  useEffect(() => {
    void listPinnableLists().then(setLists);
  }, []);

  const choose = async (list: Row) => {
    const config: PinnedListConfig = { listId: list.id };
    await writeWidgetConfig(widgetInfo.widgetId, config);
    const data = await loadPinnedList(list.id);
    if (data) renderWidget(<PinnedListWidget view={{ state: "ready", data }} t={t} />);
    setResult("ok");
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.card, paddingTop: 48 }}>
      <Text style={{ color: color.text, fontSize: 20, fontWeight: "700", paddingHorizontal: 20 }}>
        {t.pickList}
      </Text>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {(lists ?? []).map((list) => (
          <Pressable
            key={list.id}
            onPress={() => void choose(list)}
            style={{ backgroundColor: color.cardRaised, borderRadius: 12, padding: 16 }}
          >
            <Text style={{ color: color.text, fontSize: 16 }}>{list.title}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable onPress={() => setResult("cancel")} style={{ padding: 20 }}>
        <Text style={{ color: color.muted, fontSize: 15 }}>×</Text>
      </Pressable>
    </View>
  );
}
