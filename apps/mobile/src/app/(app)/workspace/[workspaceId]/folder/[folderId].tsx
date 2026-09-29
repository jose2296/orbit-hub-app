import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import type { List } from "@orbit-hub/contracts";

import { CreateSheet } from "@/components/folders/create-sheet";
import type { CreateKind } from "@/components/folders/create-sheet";
import { ContentList } from "@/components/content/content-list";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { FloatingButton } from "@/components/ui/floating-button";
import type { SheetOption } from "@/components/ui/sheet";
import { Screen } from "@/components/ui/screen";
import {
  SpaceHeader,
  type SpaceHeaderVariant,
} from "@/components/workspace/space-header";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useLists } from "@/hooks/use-lists";
import { useNotes } from "@/hooks/use-notes";
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
  const { notes, createNote } = useNotes({ workspaceId, folderId });
  const router = useRouter();

  const [menuFor, setMenuFor] = useState<
    | { kind: "folder"; folder: CarpetaDeEsteNivel }
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

  /**
   * The text colours for the band, asked of the space rather than of the theme.
   *
   * Same reason as the screen above: theme text on a space colour is dark on dark
   * half the time, and the band is the one place a folder screen says which space
   * it belongs to.
   */
  // The second colour travels with the first: it is the person's own choice, and
  // a band painted without it is a different pair from the one the picker shows.
  /*
   * Which of the three ways of naming the space this screen uses.
   *
   * It is a constant and not a preference because it is a decision about the shape
   * of a screen, not about a person: the three answer different questions and only
   * one of them can be true at a time. `dot` says which space, `crumbs` says where
   * you are inside it, and `tint` says only that you are in one.
   *
   * **`tint`, de las tres.** The other two say it well and the tint says it best,
   * and not because it says more: because it says it from the **whole** screen and
   * not from a corner. A dot is read when you look at the dot and a trail is read
   * when you look at the trail, and both live on a screen that is otherwise a list
   * of rows in neutral grey. The tint is the only thing behind the list too, so a
   * glance that never reaches the header still knows which space it is in.
   *
   * The price is that it is a background, and the row asked for none. It is a wash
   * at one part in sixteen with a hairline of the same colour: enough to warm the
   * surface, not enough for the screen to be a colour. And the text keeps the
   * theme's own colours, because a contrast that depends on the space is one that
   * has to be checked against every colour a person is allowed to pick.
   */
  const VARIANTE: SpaceHeaderVariant = "tint";

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
    } else if (createKind === "note") {
      // A note is written locally and opened straight away. Going to the editor
      // before the sync has happened is the whole point: the note exists in the
      // cache from this moment, so there is nothing to wait for and nothing that
      // can fail on the way.
      const noteId = await createNote({
        workspaceId,
        folderId,
        title: trimmed,
      });
      closeSheets();
      router.push({ pathname: "/note/[noteId]", params: { noteId } });
      return;
    } else if (createKind) {
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
    createNote,
    createKind,
    folderId,
    router,
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
    <Screen overlay={<FloatingButton onPress={() => setCreateOpen(true)} />}>
      {/*
        The band of the space, on the folder screen too.

        The folder is a level of the space and not a space of its own, so the
        colour of the space is what the screen is in. Without it, going into a
        folder is a screen that looks like a different place — and the level you
        are in is exactly the thing you lose track of when you are three folders
        deep in something you cannot name.
      */}
      <SpaceHeader
        space={workspace}
        variant={VARIANTE}
        spaceHref={`/(app)/workspace/${workspaceId}`}
        crumbs={crumbs}
      />
      <ContentList
        workspaceId={workspaceId}
        folderId={folderId}
        folders={folders}
        lists={lists}
        notes={notes}
        isLoading={isLoading}
        colorKey={workspace?.color}
        wash={workspace?.wash}
        // Beside the colour and the wash, for the same reason: a browser that
        // only got the first colour draws the derived pair, not the chosen one.
        colorTo={workspace?.colorTo}
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
        // The other way to start a note, and the reason the sheet offers four
        // things and not three: a template is a note somebody already wrote, and
        // it belongs in this space because that is where the sheet is.
        onFromTemplate={() => {
          closeSheets();
          router.push({
            pathname: "/(app)/templates",
            params: { workspaceId },
          });
        }}
        creating={false}
      />
    </Screen>
  );
}

type CarpetaDeEsteNivel = {
  id: string;
  name: string;
  emoji: string | null;
  parentId: string | null;
  position: number;
};
