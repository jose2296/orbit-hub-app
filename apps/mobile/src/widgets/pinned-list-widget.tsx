import { FlexWidget, TextWidget } from "react-native-android-widget";

import type { PinnedListData } from "./pinned-list-data";
import { darkPalette } from "./palette";
import type { Palette } from "./palette";
import type { WidgetStrings } from "./strings";

/** How the pinned-list widget can look: set up, not set up yet, or its list is gone. */
export type PinnedListView =
  | { state: "ready"; data: PinnedListData }
  | { state: "unconfigured" }
  | { state: "missing" };

const frameOf = (color: Palette) =>
  ({
    height: "match_parent",
    width: "match_parent",
    backgroundColor: color.card,
    borderRadius: 18,
    padding: 12,
  }) as const;

export function PinnedListWidget({
  view,
  t,
  palette = darkPalette,
}: {
  view: PinnedListView;
  t: WidgetStrings;
  palette?: Palette;
}) {
  const color = palette;
  const frame = frameOf(color);
  if (view.state !== "ready") {
    return (
      <FlexWidget
        style={{ ...frame, justifyContent: "center", alignItems: "center" }}
        clickAction="OPEN_URI"
        clickActionData={{ uri: "orbithub:///" }}
      >
        <TextWidget
          text={view.state === "missing" ? t.missing : t.pickList}
          style={{ fontSize: 15, fontWeight: "bold", color: color.text }}
        />
        <TextWidget
          text={t.pickListHint}
          style={{ fontSize: 12, color: color.muted, marginTop: 4 }}
        />
      </FlexWidget>
    );
  }

  const { data } = view;
  const left = data.pendingTotal - data.pending.length;
  return (
    <FlexWidget style={{ ...frame, flexDirection: "column" }}>
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 6,
        }}
        clickAction="OPEN_URI"
        clickActionData={{ uri: data.uri }}
      >
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={data.title}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 16, fontWeight: "bold", color: color.text }}
          />
        </FlexWidget>
        <TextWidget
          text={data.pendingTotal === 0 ? "" : String(data.pendingTotal)}
          style={{ fontSize: 13, color: color.accent, fontWeight: "bold" }}
        />
      </FlexWidget>

      {data.columns ? (
        data.columns.map((column) => (
          <FlexWidget
            key={column.id}
            style={{
              width: "match_parent",
              flexDirection: "column",
              marginBottom: 6,
            }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: data.uri }}
          >
            <FlexWidget
              style={{
                width: "match_parent",
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <TextWidget
                text="●"
                style={{
                  fontSize: 12,
                  color: (column.color as `#${string}` | null) ?? color.accent,
                  marginRight: 6,
                }}
              />
              <FlexWidget style={{ flex: 1 }}>
                <TextWidget
                  text={column.title}
                  maxLines={1}
                  truncate="END"
                  style={{
                    fontSize: 14,
                    fontWeight: "bold",
                    color: color.text,
                  }}
                />
              </FlexWidget>
              <TextWidget
                text={String(column.count)}
                style={{ fontSize: 13, color: color.muted }}
              />
            </FlexWidget>
            {column.tasks.map((title, index) => (
              <TextWidget
                key={index}
                text={title}
                maxLines={1}
                truncate="END"
                style={{ fontSize: 12, color: color.muted, marginLeft: 18 }}
              />
            ))}
          </FlexWidget>
        ))
      ) : data.pending.length === 0 ? (
        <FlexWidget
          style={{
            flex: 1,
            width: "match_parent",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <TextWidget
            text={`✓ ${t.allDone}`}
            style={{ fontSize: 15, color: color.done }}
          />
        </FlexWidget>
      ) : (
        data.pending.map((item) => (
          <FlexWidget
            key={item.id}
            style={{
              width: "match_parent",
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 6,
            }}
            clickAction="TOGGLE"
            clickActionData={{ itemId: item.id }}
          >
            <TextWidget
              text="○"
              style={{ fontSize: 16, color: color.accent, marginRight: 8 }}
            />
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget
                text={item.title}
                maxLines={1}
                truncate="END"
                style={{ fontSize: 14, color: color.text }}
              />
            </FlexWidget>
          </FlexWidget>
        ))
      )}

      {left > 0 ? (
        <TextWidget
          text={`+${left} ${t.more}`}
          style={{ fontSize: 12, color: color.muted }}
        />
      ) : null}
    </FlexWidget>
  );
}
