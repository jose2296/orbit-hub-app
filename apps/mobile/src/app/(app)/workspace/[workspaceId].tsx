import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { Folder, List, Note } from "@orbit-hub/contracts";

import { CreateSheet } from "@/components/folders/create-sheet";
import type { CreateKind } from "@/components/folders/create-sheet";
import { ContentList } from "@/components/content/content-list";
import { FolderMenuSheet } from "@/components/folders/folder-menu-sheet";
import { FloatingButton } from "@/components/ui/floating-button";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { NoteMenuSheet } from "@/components/notes/note-menu-sheet";
import { SaveTemplateSheet } from "@/components/notes/save-template-sheet";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { WorkspaceMenuSheet } from "@/components/workspace/workspace-menu-sheet";
import { useDashboard } from "@/hooks/use-dashboard";
import {
  isFolderPinned,
  withPinnedFolder,
  withoutPinnedFolder,
} from "@/lib/dashboard/pin";
import { useLists } from "@/hooks/use-lists";
import { useNotes } from "@/hooks/use-notes";
import { useHeaderAction } from "@/components/ui/header-action";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * A space, seen as a folder.
 *
 * The space is the root of the tree, so this screen and the one inside a folder
 * are the same screen with a different folder. Everything that can live in a
 * space lives in one of its folders, and the button in the corner is how all of
 * it is created, in the same three gestures wherever you are.
 */
export default function WorkspaceScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();

  const { workspaces } = useWorkspaces();
  const { folders, isLoading, createFolder } = useFolders(workspaceId);
  const { layout, save } = useDashboard();

  /** Whether a folder already has a card, so the menu can say "take it off". */
  const folderOnPanel = useCallback(
    (folderId: string) => isFolderPinned(layout, folderId),
    [layout],
  );
  const { lists, createList } = useLists({ workspaceId });
  const { notes, createNote } = useNotes({ workspaceId });

  const [menuFor, setMenuFor] = useState<
    { kind: "folder"; folder: Folder } | { kind: "list"; list: List } | null
  >(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"what" | "details">("what");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [title, setTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  /*
    A note acted on from its row, and the template sheet it can lead to.
    Both live here rather than in the list because the list is drawn by three
    screens and a note's menu does not care which of them opened it.
  */
  const [noteFor, setNoteFor] = useState<Note | null>(null);
  const [templateFor, setTemplateFor] = useState<Note | null>(null);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  /**
   * The colours of the text that goes on the band.
   *
   * Asked for from the space and not from the theme, and that is the whole point
   * of a band in the colour of the space: theme text on a space colour is dark
   * text on a dark space half the time. The accent has no say in it either — a
   * space is a category and the accent means "this is the action".
   */
  // The second colour went with it because it is the person's own choice, and a
  // band that drops it paints a different pair from the one the picker shows.
  useScreenTitle(workspace?.name ?? t("workspaces.title"));

  /** The folder a list lives in, for the menu to say where it is. */
  const folderOf = (list: List) =>
    folders.find((folder) => folder.id === list.folderId) ?? null;

  /** How many lists are inside a folder, for the delete to say what it takes. */
  const folderListCount = (folder: Folder | null) =>
    folder ? lists.filter((list) => list.folderId === folder.id).length : 0;

  const closeSheets = useCallback(() => {
    setMenuOpen(false);
    setCreateOpen(false);
    setCreateStep("what");
    setCreateKind(null);
    setTitle("");
  }, []);

  const onCreate = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || !workspaceId) return;
    if (createKind === "folder") {
      await createFolder({ name: trimmed, parentId: null });
    } else if (createKind === "note") {
      // Written locally and opened straight away: the note is in the cache from
      // this moment, so there is nothing to wait for.
      const noteId = await createNote({
        workspaceId,
        folderId: null,
        title: trimmed,
      });
      closeSheets();
      router.push({ pathname: "/note/[noteId]", params: { noteId } });
      return;
    } else if (createKind) {
      await createList({
        workspaceId,
        folderId: null,
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
    router,
    title,
    workspaceId,
  ]);

  if (!workspaceId) {
    return (
      <Screen>
        overlay={<FloatingButton onPress={() => setCreateOpen(true)} />}
        <AppText variant="body">{t("workspaces.notFound")}</AppText>
      </Screen>
    );
  }

  /*
    El menu del espacio, en la cabecera de la app. Estaba dentro de la banda de
    color, y con la banda fuera se quedaba sin sitio; el sitio de las acciones de
    una pantalla es la cabecera, y asi los tres puntitos de la lista, la carpeta y
    el espacio están en el mismo lugar.
  */
  useHeaderAction(
    () =>
      workspace ? (
        <Button
          testID="workspace-menu-button"
          label={t("workspaceMenu.open")}
          variant="ghost"
          size="sm"
          icon="ellipsis-horizontal"
          iconOnly
          fullWidth={false}
          onPress={() => setMenuOpen(true)}
        />
      ) : null,
    [t, workspace],
  );

  useScreenSpace(workspace);

  return (
    <Screen
      /*
        La banda del color del espacio: la mitad de abajo de un lavado que empieza
        en la cabecera y la continua 100 puntos por debajo de su borde.

        La pinta la pantalla y no la cabecera, y esa distincion es lo que deja el
        alto de la barra quieto —56 en todas las pantallas, medido en el panel, en
        una lista y fuera de un espacio—, porque anadir el desvanecido a la caja de
        la cabecera Bajaba el contenido 28 puntos y hacia que dos pantallas con la
        misma barra tuvieran la misma linea de titulo.
      */
      wash={
        workspace
          ? { color: workspace.color, colorTo: workspace.colorTo, wash: workspace.wash }
          : null
      }
      overlay={<FloatingButton onPress={() => setCreateOpen(true)} />}
    >
      {/*
        Lo que estaba dentro de la banda, sin la banda.

        La banda era un rectangulo de color del espacio con el nombre, el menu, la
        descripcion, el rol y los miembros dentro. **El color se va a la
        cabecera** y el nombre ya esta en el titulo, asi que sobra. Lo que **no**
        se va son los tres hechos: el rol —que es lo que decide si puedes hacer
        algo— y los miembros y la descripcion, que son los unicos sitios donde se
        decia. Quitarlos sin querer porque estaban en un rectangulo bonito seria
        perder informacion por un aesthetic, y esta pantalla es la que mas lo
        necesita: es la puerta de un espacio.

        Asi que el mismo contenido, en los colores del tema y sin fondo de color.
        El menu del espacio se ha ido a la cabecera de la app, al lado del titulo,
        que es donde estan las acciones de todas las pantallas.
      */}
      <View style={{ gap: theme.spacing.sm }}>
        <View style={[styles.bandTop, { gap: theme.spacing.sm }]}>
          {/* El rol es un hecho sobre quien puede cambiar cosas, y va escrito en
              el tema y no en el acento: el acento significa "esto es la accion",
              y un rol no es una accion. */}
          <Badge
            label={t(`workspaces.role.${workspace?.role ?? "viewer"}` as never)}
          />
          <AppText variant="caption" tone="muted">
            {t(pluralKey("workspaces.members", workspace?.memberCount ?? 0), {
              count: workspace?.memberCount ?? 0,
            })}
          </AppText>
        </View>

        {workspace?.description ? (
          <AppText variant="callout" tone="muted" numberOfLines={2}>
            {workspace.description}
          </AppText>
        ) : null}
      </View>


      <WorkspaceMenuSheet
        workspace={menuOpen ? workspace : null}
        onClose={closeSheets}
        onDeleted={() => router.replace("/(app)/workspaces")}
      />

      <ContentList
        workspaceId={workspaceId}
        folderId={null}
        folders={folders}
        lists={lists}
        notes={notes}
        isLoading={isLoading}
        onFolderMenu={(folder) => setMenuFor({ kind: "folder", folder })}
        onListMenu={(list) => setMenuFor({ kind: "list", list })}
        onNoteMenu={(note) => setNoteFor(note)}
      />
      <NoteMenuSheet
        note={noteFor}
        onClose={() => setNoteFor(null)}
        onSaveAsTemplate={(target) => {
          setNoteFor(null);
          setTemplateFor(target);
        }}
      />

      <SaveTemplateSheet
        visible={templateFor !== null}
        workspaceId={workspaceId}
        initialName={templateFor?.title ?? ""}
        document={templateFor?.document ?? ""}
        onClose={() => setTemplateFor(null)}
      />

      <ListMenuSheet
        list={menuFor?.kind === "list" ? menuFor.list : null}
        folder={menuFor?.kind === "list" ? folderOf(menuFor.list) : null}
        onClose={closeSheets}
      />

      <FolderMenuSheet
        folder={menuFor?.kind === "folder" ? menuFor.folder : null}
        workspaceId={workspaceId}
        listCount={folderListCount(
          menuFor?.kind === "folder" ? menuFor.folder : null,
        )}
        onPanel={
          menuFor?.kind === "folder" ? folderOnPanel(menuFor.folder.id) : false
        }
        onTogglePin={() => {
          const folder =
            menuFor?.kind === "folder"
              ? (folders.find((row) => row.id === menuFor.folder.id) ?? null)
              : null;
          if (!folder) return;
          void save(
            isFolderPinned(layout, folder.id)
              ? withoutPinnedFolder(layout, folder.id)
              : withPinnedFolder(layout, folder),
          );
        }}
        onClose={closeSheets}
        onCreateInside={(kind) => {
          setMenuFor(null);
          setCreateKind(kind);
          setCreateStep("details");
          setCreateOpen(true);
        }}
      />

      <CreateSheet
        open={createOpen}
        onClose={closeSheets}
        subtitle={workspace?.name}
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

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  band: {
    width: "100%",
  },
  bandTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  bandMeta: {
    flexDirection: "row",
    alignItems: "center",
  },
  more: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
