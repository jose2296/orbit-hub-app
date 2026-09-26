import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import type { DashboardWidget, List } from "@orbit-hub/contracts";

import {
  IconAction,
  WIDGET_ICON,
  widgetBody,
} from "@/components/dashboard/widget-presentation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DraggableRow } from "@/components/ui/draggable-row";
import { Masonry } from "@/components/ui/masonry";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useDashboard } from "@/hooks/use-dashboard";
import { useLists } from "@/hooks/use-lists";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { WIDGET_CATALOG } from "@/lib/dashboard/layout";
import { LIST_KIND_ICON, LIST_KIND_LABEL } from "@/lib/lists/kind";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";
import type { TranslationKey } from "@/lib/i18n";

/** The list a pinned card stands for, or `null` when the card is not one. */
function pinnedListId(widget: DashboardWidget): string | null {
  const id = widget.settings?.["listId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function pinnedListOf(widget: DashboardWidget): string | null {
  return pinnedListId(widget);
}

/**
 * A card of one list, on the panel.
 *
 * It shows the list and how much is left in it, and it opens the list. Pinning
 * a list is the one way to have a thing you care about in front of you without
 * going looking for it, and a card that says "recent lists" is not that.
 */
function PinnedListCard({
  widget,
  onOpen,
}: {
  widget: DashboardWidget;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const listId = pinnedListId(widget) as string;
  const { lists } = useLists({});
  const list = lists.find((row) => row.id === listId) ?? null;

  const title =
    list?.title ?? (widget.settings?.["title"] as string) ?? t("lists.title");
  const kind = (widget.settings?.["kind"] as List["kind"]) ?? "tasks";
  const count = list?.itemCount ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onOpen}
      style={({ pressed }) => [styles.pinned, { opacity: pressed ? 0.85 : 1 }]}
    >
      <Card style={{ gap: theme.spacing.sm, borderColor: theme.colors.accent }}>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <View
            style={[
              styles.icon,
              {
                backgroundColor: theme.colors.accentSoft,
                borderRadius: theme.radius.md,
              },
            ]}
          >
            <Ionicons
              name={LIST_KIND_ICON[kind] ?? "list-outline"}
              size={16}
              color={theme.colors.accentSoftText}
            />
          </View>
          <AppText variant="caption" tone="subtle" style={styles.flex}>
            {t(LIST_KIND_LABEL[kind])}
          </AppText>
        </View>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        <AppText variant="caption" tone="subtle">
          {t(pluralKey("lists.itemCount", count), { count })}
        </AppText>
      </Card>
    </Pressable>
  );
}

export default function DashboardScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { layout, isLoading, add, remove, pin, move, reset } = useDashboard();
  const { workspaces } = useWorkspaces();

  const availableKinds = (
    Object.keys(WIDGET_CATALOG) as DashboardWidget["kind"][]
  ).filter((kind) => !layout.some((widget) => widget.kind === kind));

  return (
    <Screen>
      {/* The stack header already says "Tu panel"; a second title under it just
          repeats it. */}
      <AppText variant="callout" tone="muted">
        {t("dashboard.subtitle")}
      </AppText>

      {isLoading ? (
        <Card variant="muted">
          <AppText variant="callout" tone="muted" align="center">
            {t("common.loading")}
          </AppText>
        </Card>
      ) : (
        <Masonry>
          {layout.map((widget) => (
            <DraggableRow
              key={widget.id}
              id={widget.id}
              index={layout.findIndex((w) => w.id === widget.id)}
              total={layout.length}
              onReorder={(_, toIndex) => {
                // El dashboard se ordena por flechas; el arrastre reutiliza esa
                // misma acción para que no haya dos caminos al mismo orden.
                if (toIndex < layout.findIndex((w) => w.id === widget.id)) {
                  void move(widget.id, "up");
                } else if (
                  toIndex > layout.findIndex((w) => w.id === widget.id)
                ) {
                  void move(widget.id, "down");
                }
              }}
            >
              {pinnedListOf(widget) ? (
                // A card of the list itself, not another "recent lists" card:
                // pinning a list that then looks like every other widget is a
                // button that does something nobody can see.
                <PinnedListCard
                  widget={widget}
                  onOpen={() =>
                    router.push(`/(app)/list/${pinnedListId(widget)}`)
                  }
                />
              ) : (
                <Card style={{ gap: theme.spacing.md }} kind={widget.kind}>
                  <View style={[styles.row, { gap: theme.spacing.md }]}>
                    <View
                      style={[
                        styles.icon,
                        {
                          backgroundColor: theme.colors.accentSoft,
                          borderRadius: theme.radius.md,
                        },
                      ]}
                    >
                      <Ionicons
                        name={WIDGET_ICON[widget.kind]}
                        size={18}
                        color={theme.colors.accentSoftText}
                      />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="bodyStrong">
                        {t(
                          WIDGET_CATALOG[widget.kind]
                            .labelKey as TranslationKey,
                        )}
                      </AppText>
                      {widget.pinned ? (
                        <Badge label={t("dashboard.pinned")} tone="accent" />
                      ) : null}
                    </View>
                  </View>

                  <AppText variant="caption" tone="subtle">
                    {widgetBody(t, widget.kind, workspaces.length)}
                  </AppText>

                  <View style={[styles.actions, { gap: theme.spacing.sm }]}>
                    <IconAction
                      icon="arrow-up"
                      label={t("dashboard.moveUp")}
                      onPress={() => void move(widget.id, "up")}
                    />
                    <IconAction
                      icon="arrow-down"
                      label={t("dashboard.moveDown")}
                      onPress={() => void move(widget.id, "down")}
                    />
                    <IconAction
                      icon={widget.pinned ? "bookmark" : "bookmark-outline"}
                      label={
                        widget.pinned
                          ? t("dashboard.unpin")
                          : t("dashboard.pin")
                      }
                      onPress={() => void pin(widget.id)}
                    />
                    <IconAction
                      icon="trash-outline"
                      label={t("dashboard.remove")}
                      destructive
                      onPress={() => void remove(widget.id)}
                    />
                  </View>
                </Card>
              )}
            </DraggableRow>
          ))}
        </Masonry>
      )}

      <View style={{ gap: theme.spacing.md }}>
        <AppText variant="heading">{t("dashboard.addWidget")}</AppText>
        {availableKinds.length === 0 ? (
          <EmptyState compact title={t("dashboard.allWidgets")} />
        ) : (
          <View
            style={[styles.row, { gap: theme.spacing.sm, flexWrap: "wrap" }]}
          >
            {availableKinds.map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                onPress={() => void add(kind)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: theme.colors.accentSoft,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <AppText
                  variant="callout"
                  style={{ color: theme.colors.accentSoftText }}
                >
                  + {t(WIDGET_CATALOG[kind].labelKey as TranslationKey)}
                </AppText>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <AppText variant="caption" tone="subtle">
          {t("dashboard.hint")}
        </AppText>
        <View style={[styles.actions, { gap: theme.spacing.sm }]}>
          <IconAction
            icon="refresh"
            label={t("dashboard.reset")}
            onPress={() => void reset()}
          />
          <IconAction
            icon="albums-outline"
            label={t("workspaces.title")}
            onPress={() => router.push("/(app)/workspaces")}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
  icon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  chip: {
    alignSelf: "flex-start",
  },
  pinned: {
    alignSelf: "stretch",
  },
});
