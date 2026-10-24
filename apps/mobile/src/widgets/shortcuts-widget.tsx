import { FlexWidget, TextWidget } from "react-native-android-widget";

import type { ShortcutsConfig } from "./config-store";
import { widgetPalette as color } from "./palette";
import type { WidgetStrings } from "./strings";

/** Up to four shortcuts, two by two; each opens its place in the app. */
export function ShortcutsWidget({
  config,
  t,
}: {
  config: ShortcutsConfig | null;
  t: WidgetStrings;
}) {
  const items = config?.items ?? [];
  const rows = [items.slice(0, 2), items.slice(2, 4)].filter(
    (row) => row.length > 0,
  );

  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "column",
        backgroundColor: color.card,
        borderRadius: 18,
        padding: 8,
        flexGap: 8,
      }}
    >
      {rows.length === 0 ? (
        <FlexWidget
          style={{
            flex: 1,
            width: "match_parent",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <TextWidget
            text={t.setUp}
            style={{ fontSize: 14, color: color.muted }}
          />
        </FlexWidget>
      ) : (
        rows.map((row, index) => (
          <FlexWidget
            key={index}
            style={{
              flex: 1,
              width: "match_parent",
              flexDirection: "row",
              flexGap: 8,
            }}
          >
            {row.map((item) => (
              <FlexWidget
                key={item.uri}
                style={{
                  flex: 1,
                  height: "match_parent",
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: color.cardRaised,
                  borderRadius: 12,
                  padding: 6,
                }}
                clickAction="OPEN_URI"
                clickActionData={{ uri: item.uri }}
              >
                <TextWidget
                  text={item.label}
                  maxLines={2}
                  truncate="END"
                  style={{
                    fontSize: 14,
                    fontWeight: "bold",
                    color: color.text,
                  }}
                />
              </FlexWidget>
            ))}
          </FlexWidget>
        ))
      )}
    </FlexWidget>
  );
}
