import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import type { List } from "@orbit-hub/contracts";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { CreateSheet } from "@/components/folders/create-sheet";
import type { CreateKind } from "@/components/folders/create-sheet";
import { FolderBrowser } from "@/components/folders/folder-browser";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { FloatingCreateButton } from "@/components/folders/floating-create-button";
import type { SheetOption } from "@/components/ui/sheet";
import { Screen } from "@/components/ui/screen";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useLists } from "@/hooks/use-lists";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useTranslation } from "@/lib/i18n";

/**
 * A folder inside a space, seen as a screen of its own.
 *
 * Going into a folder is a new screen rather than a section that expands, so
 * the back button means one thing: it leaves the level you are in, one folder at
 * a time, and stops at the space. It is the same browser as the root of a space,
 * with a different folder.
 */
export default function FolderScreen() {
  const t = useTranslation();
  const { workspaceId, folderId } = useLocalSearchParams<{
    workspaceId: string;
    folderId: string;
  }>();

  const { workspaces } = useWorkspaces();
  const { folders, isLoading, createFolder } = useFolders(workspaceId);
  const { lists, createList } = useLists({ workspaceId });

  const [menuFor, setMenuFor] = useState<
    | { kind: "folder"; folder: FolderBrowserFolder }
    | { kind: "list"; list: List }
    | null
  >(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"what" | "details">("what");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [title, setTitle] = useState("");

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const folder = useMemo(
    () => folders.find((item) => item.id === folderId) ?? null,
    [folders, folderId],
  );

  useScreenTitle(folder?.name ?? t("folders.title"));

  /** The path from the space down to here, each step a link. */
  const crumbs = useMemo(() => {
    const chain: { id: string; name: string }[] = [];
    let current = folder ?? null;
    // Eight levels is deeper than the server allows, and a cycle would
    // otherwise loop here forever.
    for (let depth = 0; current && depth < 8; depth += 1) {
      chain.unshift({ id: current.id, name: current.name });
      current = folders.find((item) => item.id === current?.parentId) ?? null;
    }
    return [
      {
        label: workspace?.name ?? t("workspaces.title"),
        href: `/(app)/workspace/${workspaceId}`,
      },
      ...chain.map((step) => ({
        label: step.name,
        href:
          step.id === folderId
            ? undefined
            : `/(app)/workspace/${workspaceId}/folder/${step.id}`,
      })),
    ];
  }, [folder, folders, folderId, workspace?.name, workspaceId, t]);

  const closeSheets = useCallback(() => {
    setMenuFor(null);
    setCreateOpen(false);
    setCreateStep("what");
    setCreateKind(null);
    setTitle("");
  }, []);

  const onCreate = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || !workspaceId) return;
    if (createKind === "folder") {
      await createFolder({ name: trimmed, parentId: folderId });
    } else if (createKind && createKind !== "note") {
      // 'note' is greyed out in the panel; it is not a kind of list.
      await createList({
        workspaceId,
        folderId,
        title: trimmed,
        kind: createKind,
      });
    }
    closeSheets();
  }, [
    closeSheets,
    createFolder,
    createList,
    createKind,
    folderId,
    title,
    workspaceId,
  ]);

  const menuOptions: SheetOption[] = useMemo(() => {
    if (!menuFor) return [];
    const options: SheetOption[] = [];

    if (menuFor.kind === "list") {
      options.push(
        {
          key: "edit",
          label: t("common.edit"),
          icon: "create-outline",
          onPress: () => setMenuFor(null),
        },
        {
          key: "share",
          label: t("common.share"),
          icon: "people-outline",
          description: t("lists.shareHint"),
          onPress: () => setMenuFor(null),
        },
        {
          key: "pin",
          label: t("lists.pinToDashboard"),
          icon: "apps-outline",
          onPress: () => setMenuFor(null),
        },
        {
          key: "duplicate",
          label: t("lists.duplicate"),
          icon: "copy-outline",
          onPress: () => setMenuFor(null),
        },
        {
          key: "delete",
          label: t("common.delete"),
          icon: "trash-outline",
          tone: "danger",
          onPress: () => setMenuFor(null),
        },
      );
      return options;
    }

    options.push(
      {
        key: "new-list",
        label: t("lists.create"),
        icon: "add-circle-outline",
        onPress: () => {
          setMenuFor(null);
          setCreateKind("tasks");
          setCreateStep("details");
          setCreateOpen(true);
        },
      },
      {
        key: "new-folder",
        label: t("folders.create"),
        icon: "folder-open-outline",
        onPress: () => {
          setMenuFor(null);
          setCreateKind("folder");
          setCreateStep("details");
          setCreateOpen(true);
        },
      },
      {
        key: "rename",
        label: t("common.rename"),
        icon: "create-outline",
        onPress: () => setMenuFor(null),
      },
      {
        key: "share",
        label: t("common.share"),
        icon: "people-outline",
        onPress: () => setMenuFor(null),
      },
      {
        key: "delete",
        label: t("common.delete"),
        icon: "trash-outline",
        tone: "danger",
        onPress: () => setMenuFor(null),
      },
    );
    return options;
  }, [menuFor, t]);

  return (
    <Screen>
      <Breadcrumbs crumbs={crumbs} />

      <FolderBrowser
        workspaceId={workspaceId}
        folderId={folderId}
        folders={folders}
        lists={lists}
        isLoading={isLoading}
        onFolderMenu={(target) =>
          setMenuFor({ kind: "folder", folder: target })
        }
        onListMenu={(target) => setMenuFor({ kind: "list", list: target })}
      />

      {/* The menu of a thing. A long press opens it on a phone, which is where
          the action is not a button anyone sees all the time. */}
      <Sheet
        visible={menuFor !== null}
        onClose={closeSheets}
        title={
          menuFor?.kind === "list" ? menuFor.list.title : menuFor?.folder.name
        }
        subtitle={workspace?.name}
        scrollable={false}
      >
        <SheetOptions options={menuOptions} />
      </Sheet>

      <CreateSheet
        open={createOpen}
        onClose={closeSheets}
        subtitle={folder?.name ?? workspace?.name}
        step={createStep}
        onStep={setCreateStep}
        kind={createKind}
        onKind={setCreateKind}
        title={title}
        onTitle={setTitle}
        onCreate={() => void onCreate()}
        creating={false}
      />

      <FloatingCreateButton onPress={() => setCreateOpen(true)} />
    </Screen>
  );
}

type FolderBrowserFolder = {
  id: string;
  name: string;
  emoji: string | null;
  parentId: string | null;
  position: number;
};
