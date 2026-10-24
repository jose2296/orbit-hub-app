import { FlexWidget, TextWidget } from "react-native-android-widget";

import type { CaptureTargets } from "./pinned-list-data";
import { widgetPalette as color } from "./palette";
import type { WidgetStrings } from "./strings";

/** Two buttons that open the app straight on the panel that writes a task or a note. */
export function QuickCaptureWidget({
  targets,
  t,
}: {
  targets: CaptureTargets | null;
  t: WidgetStrings;
}) {
  const buttons = [
    targets?.task ? { label: `+ ${t.newTask}`, caption: targets.task.title, uri: targets.task.uri } : null,
    targets?.note ? { label: `+ ${t.newNote}`, caption: targets.note.name, uri: targets.note.uri } : null,
  ].filter((button): button is { label: string; caption: string; uri: string } => button !== null);

  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: color.card,
        borderRadius: 18,
        padding: 8,
        flexGap: 8,
      }}
    >
      {buttons.length === 0 ? (
        <FlexWidget
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          clickAction="OPEN_URI"
          clickActionData={{ uri: "orbithub:///" }}
        >
          <TextWidget text={t.setUp} style={{ fontSize: 14, color: color.muted }} />
        </FlexWidget>
      ) : (
        buttons.map((button) => (
          <FlexWidget
            key={button.uri}
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
            clickActionData={{ uri: button.uri }}
          >
            <TextWidget
              text={button.label}
              maxLines={1}
              truncate="END"
              style={{ fontSize: 15, fontWeight: "bold", color: color.text }}
            />
            <TextWidget
              text={button.caption}
              maxLines={1}
              truncate="END"
              style={{ fontSize: 11, color: color.muted, marginTop: 2 }}
            />
          </FlexWidget>
        ))
      )}
    </FlexWidget>
  );
}
