import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import type { List } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { useHeaderAction } from "@/components/ui/header-action";
import { CreateSheet } from "@/components/folders/create-sheet";
import type { CreateKind } from "@/components/folders/create-sheet";
import { ContentList } from "@/components/content/content-list";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { FloatingButton } from "@/components/ui/floating-button";
import type { SheetOption } from "@/components/ui/sheet";
import { Screen } from "@/components/ui/screen";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useLists } from "@/hooks/use-lists";
import { useNotes } from "@/hooks/use-notes";
import { useScreenSpace } from "@/hooks/use-screen-space";
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
  const [createStep, setCreateStep] = useState<"what" | "kind" | "details">("what");
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

  /*
    The menu of **this** folder, from inside it.

    It used to be reachable only from the folder's row in its parent's list, which means
    that creating a folder — the action that puts you inside it — left you somewhere with
    no menu at all. The three dots of a folder are in the folder's parent, so from inside
    there was nothing: you could rename nothing, delete nothing and **share nothing**,
    and the obvious next step after creating a thing is to share it.

    It is the same sheet and the same options as the row's, not a second version of it.
  */
  useHeaderAction(
    () =>
      folder ? (
        <Button
          testID="folder-menu-button"
          label={t("folders.menu")}
          variant="ghost"
          size="sm"
          icon="ellipsis-horizontal"
          iconOnly
          accessibilityHint={t("folders.menuHint")}
          fullWidth={false}
          onPress={() =>
            setMenuFor({
              kind: "folder",
              folder: {
                id: folder.id,
                name: folder.name,
                emoji: folder.emoji,
                parentId: folder.parentId,
                position: folder.position,
              },
            })
          }
        />
      ) : null,
    [folder, t],
  );


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


  /*
    Los dos colores con los que se mide el contraste. Entran como argumentos y no
    se leen de dentro porque un hook que decide el color del fondo de la cabecera
    tambien tiene que poder decir con que texto se va a leer, y eso es del tema.
  */
  useScreenSpace(workspace);

  return (
    <Screen
      /*
        La banda del color del espacio: la mitad de abajo de un lavado que empieza
        en la cabecera y la continua 100 puntos por debajo de su borde. La pinta la
        pantalla y no la cabecera, y por eso el alto de la barra no cambia.
      */
      wash={{ color: workspace?.color, colorTo: workspace?.colorTo, wash: workspace?.wash }}
      overlay={<FloatingButton onPress={() => setCreateOpen(true)} />}
    >
      {/*
        Sin banda. El color del espacio lo pone ahora la cabecera de la app, que
        es donde debe estar: una banda de color encima del contenido obligaba a
        cada pantalla a dibujarla, y hacia falta recordar en tres sitios lo mismo.
        Lo que pierde la banda es el nombre del espacio repetido y las migas, y lo
        gana es una pantalla que empieza por su contenido y no por un adorno.
        Las migas siguen en la cabecera, en su sitio de siempre.
      */}
      <ContentList
        workspaceId={workspaceId}
        folderId={folderId}
        folders={folders}
        lists={lists}
        notes={notes}
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
