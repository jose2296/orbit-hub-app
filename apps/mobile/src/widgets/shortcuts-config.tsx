import { useState } from "react";
import type { WidgetConfigurationScreenProps } from "react-native-android-widget";

import { routeForList } from "@/lib/lists/route";

import { writeWidgetConfig } from "./config-store";
import type { ShortcutsConfig } from "./config-store";
import { ConfigFrame } from "./config-frame";
import { ListPicker } from "./list-picker";
import { ShortcutsWidget } from "./shortcuts-widget";
import { widgetStrings } from "./strings";
import { bothLooks } from "./widget-views";

export const MAX_SHORTCUTS = 4;

/** Picks up to four places, one after another, with the same level-by-level picker. */
export function ShortcutsConfigScreen({
  widgetInfo,
  renderWidget,
  setResult,
}: WidgetConfigurationScreenProps) {
  const t = widgetStrings();
  const [items, setItems] = useState<ShortcutsConfig["items"]>([]);

  const [failure, setFailure] = useState<string | null>(null);

  const finish = async (final: ShortcutsConfig["items"]) => {
    try {
      const config: ShortcutsConfig = { items: final };
      await writeWidgetConfig(widgetInfo.widgetId, config);
      renderWidget(
        bothLooks((palette) => (
          <ShortcutsWidget config={config} t={t} palette={palette} />
        )),
      );
      setResult("ok");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const add = (label: string, uri: string) => {
    if (items.some((item) => item.uri === uri)) return;
    const next = [...items, { label, uri }];
    setItems(next);
    if (next.length >= MAX_SHORTCUTS) void finish(next);
  };

  return (
    <ConfigFrame
      title={
        failure ?? `${t.shortcutsTitle} (${items.length}/${MAX_SHORTCUTS})`
      }
      onClose={() => setResult("cancel")}
      onSkip={items.length > 0 ? () => void finish(items) : undefined}
      skipLabel={t.done}
    >
      <ListPicker
        allKinds
        emptyLabel={t.nothingHere}
        pickPlaceLabel={t.pickHere}
        onPickPlace={(place) =>
          add(
            place.name,
            place.type === "workspace"
              ? `orbithub://workspace/${place.id}`
              : `orbithub://workspace/${place.workspaceId}/folder/${place.id}`,
          )
        }
        onPick={(_id, list) =>
          add(list.title, `orbithub:/${routeForList(list)}`)
        }
      />
    </ConfigFrame>
  );
}
