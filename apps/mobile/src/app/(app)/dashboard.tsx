import { useCallback, useMemo, useState } from "react";

import { useRouter } from "expo-router";

import { Sheet, SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { useDashboard } from "@/hooks/use-dashboard";
import { useLists } from "@/hooks/use-lists";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { withPinnedList, withoutPinnedList } from "@/lib/dashboard/pin";
import { colorOf } from "@/lib/workspace/color";

import { PanelGrid } from "@/components/dashboard/panel-grid";
import { Screen } from "@/components/ui/screen";

/**
 * The panel, with the lists of every space on it.
 *
 * The cards are the lists and not a row of generic widgets, because a panel
 * whose cards say "recent lists" and "tasks" tells you about the app instead of
 * about your day. A card is a list, painted with the colour of the space it is
 * in, and tapping it opens it.
 */
export default function DashboardScreen() {
  const t = useTranslation();
  const router = useRouter();
  const { layout, save } = useDashboard();
  const { workspaces } = useWorkspaces();
  const { lists } = useLists({});
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const colorByWorkspace = useMemo(
    () =>
      new Map(workspaces.map((workspace) => [workspace.id, workspace.color])),
    [workspaces],
  );

  const onPanel = useMemo(
    () =>
      new Set(
        layout.map((widget) => widget.settings?.["listId"]).filter(Boolean),
      ),
    [layout],
  );

  const colorOfWidget = useCallback(
    (widget: { settings?: Record<string, unknown> }) => {
      const list = lists.find((row) => row.id === widget.settings?.["listId"]);
      return colorOf(list ? colorByWorkspace.get(list.workspaceId) : null);
    },
    [lists, colorByWorkspace],
  );

  /** Which space a card belongs to, said while the panel is being arranged. */
  const whereOfWidget = useCallback(
    (widget: { settings?: Record<string, unknown> }) => {
      const list = lists.find((row) => row.id === widget.settings?.["listId"]);
      const name = workspaces.find((row) => row.id === list?.workspaceId)?.name;
      return name ? t("dashboard.spaceOf", { name }) : "";
    },
    [lists, workspaces, t],
  );

  const describe = useCallback(
    (widget: { id: string; settings?: Record<string, unknown> }) => {
      const list = lists.find((row) => row.id === widget.settings?.["listId"]);
      if (!list) {
        return {
          title: (widget.settings?.["title"] as string) ?? t("lists.title"),
          subtitle: t("dashboard.deletedList"),
          emoji: (widget.settings?.["emoji"] as string) ?? null,
          href: null,
        };
      }
      return {
        title: list.title,
        subtitle: t(pluralKey("lists.itemCount", list.itemCount), {
          count: list.itemCount,
        }),
        emoji: list.emoji,
        href: `/(app)/list/${list.id}`,
      };
    },
    [lists, t],
  );

  const addList = useCallback(
    (listId: string) => {
      const list = lists.find((row) => row.id === listId);
      if (!list) return;
      void save(withPinnedList(layout, list));
    },
    [layout, lists, save],
  );

  const removeList = useCallback(
    (listId: string) => void save(withoutPinnedList(layout, listId)),
    [layout, save],
  );

  const choices = useMemo(
    () =>
      lists.map((list) => {
        const already = onPanel.has(list.id);
        return {
          key: list.id,
          label: list.title,
          description: already
            ? t("dashboard.alreadyOnPanel")
            : `${t("dashboard.spaceOf", { name: workspaces.find((w) => w.id === list.workspaceId)?.name ?? "" })} · ${t(pluralKey("lists.itemCount", list.itemCount), { count: list.itemCount })}`,
          onPress: () => (already ? removeList(list.id) : addList(list.id)),
        } satisfies SheetOption;
      }),
    [lists, onPanel, t, workspaces, addList, removeList],
  );

  const available = useMemo(
    () => lists.filter((list) => !onPanel.has(list.id)).length,
    [lists, onPanel],
  );

  return (
    <Screen>
      <PanelGrid
        layout={layout}
        colorOfWidget={colorOfWidget}
        whereOfWidget={whereOfWidget}
        describe={describe}
        onChange={save}
        onSave={() => {
          setSaving(true);
          void save(layout).finally(() => setSaving(false));
        }}
        saving={saving}
        availableCount={available}
        onOpenEditor={() => setPicking(true)}
        onOpen={(href) => router.push(href as never)}
      />

      <Sheet
        visible={picking}
        onClose={() => setPicking(false)}
        title={t("dashboard.pickLists")}
        subtitle={t(pluralKey("dashboard.cardsAvailable", available), {
          count: available,
        })}
      >
        <SheetOptions options={choices} />
      </Sheet>
    </Screen>
  );
}
