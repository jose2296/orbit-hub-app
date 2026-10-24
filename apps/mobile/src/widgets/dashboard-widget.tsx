import { FlexWidget, TextWidget } from "react-native-android-widget";

import type { DashboardSummary } from "./dashboard-data";
import { darkPalette } from "./palette";
import type { Palette } from "./palette";
import type { WidgetStrings } from "./strings";

/** The day at a glance: how much is pending, where, and whether the journal has today's page. */
export function DashboardWidget({
  summary,
  t,
  palette = darkPalette,
}: {
  summary: DashboardSummary;
  t: WidgetStrings;
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
      clickActionData={{ uri: "orbithub:///" }}
    >
      <FlexWidget
        style={{
          flexDirection: "row",
          width: "match_parent",
          justifyContent: "space-between",
        }}
      >
        <TextWidget
          text={t.summaryTitle}
          style={{ fontSize: 15, fontWeight: "bold", color: color.text }}
        />
        <TextWidget
          text={`${summary.pendingTotal} ${t.pendingWord}`}
          style={{ fontSize: 13, fontWeight: "bold", color: color.accent }}
        />
      </FlexWidget>
      <FlexWidget
        style={{ flexDirection: "column", marginTop: 8, width: "match_parent" }}
      >
        {summary.top.length === 0 ? (
          <TextWidget
            text={t.allDone}
            style={{ fontSize: 14, color: color.done }}
          />
        ) : (
          summary.top.map((list) => (
            <FlexWidget
              key={list.id}
              style={{
                flexDirection: "row",
                width: "match_parent",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
              clickAction="OPEN_URI"
              clickActionData={{ uri: list.uri }}
            >
              <TextWidget
                text={list.title}
                maxLines={1}
                truncate="END"
                style={{ fontSize: 14, color: color.text }}
              />
              <TextWidget
                text={String(list.pending)}
                style={{ fontSize: 14, color: color.muted }}
              />
            </FlexWidget>
          ))
        )}
      </FlexWidget>
      {summary.unclassified > 0 ? (
        <FlexWidget
          style={{ width: "match_parent", marginTop: 6 }}
          clickAction="OPEN_URI"
          clickActionData={{ uri: "orbithub://unclassified" }}
        >
          <TextWidget
            text={`${t.unclassified}: ${summary.unclassified}`}
            style={{ fontSize: 12, color: color.accent }}
          />
        </FlexWidget>
      ) : null}
      <TextWidget
        text={summary.wroteToday ? t.journalDone : t.journalPending}
        style={{
          fontSize: 12,
          color: summary.wroteToday ? color.done : color.muted,
          marginTop: 6,
        }}
      />
    </FlexWidget>
  );
}
