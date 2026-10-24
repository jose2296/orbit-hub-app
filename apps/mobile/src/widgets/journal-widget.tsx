import {
  FlexWidget,
  ListWidget,
  TextWidget,
} from "react-native-android-widget";

import type { JournalToday } from "./journal-data";
import { darkPalette } from "./palette";
import type { Palette } from "./palette";
import type { WidgetStrings } from "./strings";

/** Today's page of the journal: its first lines, and a tap anywhere opens it to write. */
export function JournalWidget({
  today,
  t,
  dateLabel,
  palette = darkPalette,
}: {
  today: JournalToday;
  t: WidgetStrings;
  dateLabel: string;
  palette?: Palette;
}) {
  const color = palette;
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "column",
        backgroundColor: color.card,
        borderRadius: 18,
        padding: 14,
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: today.uri }}
    >
      <FlexWidget
        style={{
          flexDirection: "row",
          width: "match_parent",
          justifyContent: "space-between",
        }}
      >
        <TextWidget
          text={dateLabel}
          style={{ fontSize: 15, fontWeight: "bold", color: color.text }}
        />
        <TextWidget
          text={`+ ${t.writeToday}`}
          style={{ fontSize: 13, color: color.accent }}
        />
      </FlexWidget>
      <FlexWidget
        style={{
          flexDirection: "column",
          marginTop: 8,
          width: "match_parent",
          flex: 1,
        }}
      >
        {today.lines.length === 0 ? (
          <TextWidget
            text={t.emptyDay}
            style={{ fontSize: 14, color: color.muted }}
          />
        ) : (
          // Scrolls when the day has more lines than fit.
          <ListWidget style={{ width: "match_parent", height: "match_parent" }}>
            {today.lines.map((line, index) => (
              <FlexWidget
                key={index}
                style={{ width: "match_parent", paddingVertical: 2 }}
                clickAction="OPEN_URI"
                clickActionData={{ uri: today.uri }}
              >
                <TextWidget
                  text={line}
                  maxLines={3}
                  truncate="END"
                  style={{ fontSize: 14, color: color.text }}
                />
              </FlexWidget>
            ))}
          </ListWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  );
}
