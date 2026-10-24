import { FlexWidget, TextWidget } from "react-native-android-widget";

import type { PinnedNoteData } from "./note-data";
import { darkPalette } from "./palette";
import type { Palette } from "./palette";
import type { WidgetStrings } from "./strings";

/** How the note widget can look: set up, not set up yet, or its note is gone. */
export type PinnedNoteView =
  | { state: "ready"; data: PinnedNoteData }
  | { state: "unconfigured" }
  | { state: "missing" };

/** A note on the home screen: its title and first lines; a tap opens it. */
export function PinnedNoteWidget({
  view,
  t,
  palette = darkPalette,
}: {
  view: PinnedNoteView;
  t: WidgetStrings;
  palette?: Palette;
}) {
  const color = palette;
  const frame = {
    height: "match_parent",
    width: "match_parent",
    backgroundColor: color.card,
    borderRadius: 18,
    padding: 14,
  } as const;

  if (view.state !== "ready") {
    return (
      <FlexWidget
        style={{ ...frame, justifyContent: "center", alignItems: "center" }}
        clickAction="OPEN_URI"
        clickActionData={{ uri: "orbithub:///" }}
      >
        <TextWidget
          text={view.state === "missing" ? t.noteMissing : t.pickNote}
          style={{ fontSize: 15, fontWeight: "bold", color: color.text }}
        />
        <TextWidget
          text={view.state === "missing" ? t.pickNoteHint : t.pickNoteHint}
          style={{ fontSize: 12, color: color.muted, marginTop: 4 }}
        />
      </FlexWidget>
    );
  }

  const { data } = view;
  return (
    <FlexWidget
      style={{ ...frame, flexDirection: "column" }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: data.uri }}
    >
      <TextWidget
        text={data.title}
        maxLines={1}
        truncate="END"
        style={{
          fontSize: 16,
          fontWeight: "bold",
          color: color.text,
          marginBottom: 6,
        }}
      />
      {data.lines.length === 0 ? (
        <TextWidget
          text={t.emptyNote}
          style={{ fontSize: 14, color: color.muted }}
        />
      ) : (
        data.lines.map((line, index) => (
          <TextWidget
            key={index}
            text={line}
            maxLines={2}
            truncate="END"
            style={{ fontSize: 14, color: color.text, marginBottom: 3 }}
          />
        ))
      )}
    </FlexWidget>
  );
}
