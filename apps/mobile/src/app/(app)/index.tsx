import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { useSession } from "@/hooks/use-session";
import { useScreenTitle } from "@/hooks/use-screen-title";

import { PanelGrid } from "@/components/dashboard/panel-grid";
import { PanelPicker } from "@/components/dashboard/pin-picker";
import { useSheetSucio } from "@/components/ui/sheet-sucio";

/**
 * Dice si lo elegido cambio, y vive **dentro** de la hoja a proposito.
 *
 * La pantalla pinta el `Sheet` y esta por encima de el, asi que `useSheetSucio`
 * ahi daria el valor por defecto. Este componente no pinta nada: esta dentro del
 * arbol del `Sheet` para que el que si pinta sepa.
 */
function PinsSucios({ sucio }: { sucio: boolean }) {
  const { setSucio } = useSheetSucio();
  useEffect(() => {
    setSucio(sucio);
  }, [sucio, setSucio]);
  return null;
}
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Sheet } from "@/components/ui/sheet";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { useHeaderAction } from "@/components/ui/header-action";
import { useDashboard } from "@/hooks/use-dashboard";
import { useLists } from "@/hooks/use-lists";
import { useNotes } from "@/hooks/use-notes";
import { notePreview } from "@/lib/notes/note-record";
import { useAllFolders, useWorkspaces } from "@/hooks/use-workspaces";
import {
  withPinnedFolder,
  withPinnedList,
  withPinnedNote,
  withoutPinnedNote,
  withoutPinnedFolder,
  withoutPinnedList,
} from "@/lib/dashboard/pin";
import { cardMark } from "@/lib/dashboard/card-kind";
import type { ListKind } from "@orbit-hub/contracts";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { iconEmoji } from "@/lib/icons/resolve-icon";

/**
 * The home screen: the panel, and nothing else.
 *
 * It used to answer two questions above the panel — what is left to do, and where
 * my things are. Both were answered elsewhere already, and both were answered
 * worse here: the spaces are in the menu and on the spaces screen, and "what is
 * left" was a fixed three items from three lists, which is not the list you were
 * working on. A screen that answers a question badly is worse than a screen that
 * does not answer it, because you have to look at it to find out.
 *
 * So this is the panel and only the panel: the pinned lists as cards, in the
 * colour of the space each one is in, arranged by the person. Tapping one opens
 * it. The pencil in the corner is the whole editing interface, and it is the same
 * one the old app had, down to the wobble.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { user } = useSession();
  const { layout, pages, save, saving } = useDashboard();
  /**
   * Which panel screen the person is looking at.
   *
   * Read by the panel, which is the only thing that draws one, and used so that a
   * card pinned from here lands on the screen somebody is standing on. Page zero
   * to begin with, which is the page a panel with one screen is on.
   */
  const [currentPage, setCurrentPage] = useState(0);
  const { workspaces } = useWorkspaces();
  const { lists } = useLists({});
  /**
   * Every note, and not the ones of one space.
   *
   * The panel is not inside a space, the same as the folders below it: a note is
   * something you wrote and not something that belongs to one place, and a panel
   * that only offered the notes of whichever space you happened to be in would
   * be a panel where your own notes come and go.
   */
  const { notes } = useNotes({});
  const notesById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const noteOnPanel = useMemo(
    () =>
      new Set(
        layout
          .map((widget) => widget.settings?.["noteId"])
          .filter((id): id is string => typeof id === "string"),
      ),
    [layout],
  );
  // The panel is not inside a space, so it needs the folders of all of them.
  const folders = useAllFolders(workspaces.map((space) => space.id));
  const [picking, setPicking] = useState(false);
  /**
   * Whether the panel is being arranged.
   *
   * Here and not in the panel, because the button that starts and ends it lives in
   * the header below. Two pencils — one in the header, one in the panel — is two
   * buttons that mean the same thing in two places, and the one you press is
   * whichever you press first, not the one that saves when you are done.
   */
  const [editing, setEditing] = useState(false);
  /**
   * Where the header's "done" button reaches the panel to finish the arrangement.
   *
   * A ref, so the panel can publish the function that saves without the header
   * having to re-render every time the arrangement changes under it.
   */
  const finishPanel = useRef<() => void>(() => {});

  const colorByWorkspace = useMemo(
    () => new Map(workspaces.map((space) => [space.id, space.color])),
    [workspaces],
  );

  /** The wash of each space, so a card is painted like the screen behind it. */
  const washByWorkspace = useMemo(
    () => new Map(workspaces.map((space) => [space.id, space.wash])),
    [workspaces],
  );

  /**
   * The end colour of each space, for the same reason as the wash.
   *
   * A third lookup and not a field of the first, because the second colour is a
   * decision the person made and can undo: a card painted without it shows the
   * derived pair, which is not the pair the picker teaches.
   */
  const colorToByWorkspace = useMemo(
    () => new Map(workspaces.map((space) => [space.id, space.colorTo])),
    [workspaces],
  );

  /** A card is looked up by its list, once per render, and not by a search. */
  const listById = useMemo(
    () => new Map(lists.map((list) => [list.id, list])),
    [lists],
  );

  /** And by its folder, for the same reason. */
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  /*
    What is on the panel, by id.

    A card with no `listId` or no `folderId` — one whose list was deleted, or a
    card of a kind this version does not know — is not an id, and a set of
    `unknown` makes every `has(id)` call a lie the compiler is happy with. The
    guard is on the *type*, not on truthiness: `filter(Boolean)` narrows nothing,
    so a picker that asks "is this one already pinned?" would be asking about a
    value the set cannot name.
  */
  const onPanel = useMemo(
    () =>
      new Set<string>(
        layout
          .map((widget) => widget.settings?.["listId"])
          .filter((id): id is string => typeof id === "string"),
      ),
    [layout],
  );

  const folderOnPanel = useMemo(
    () =>
      new Set<string>(
        layout
          .map((widget) => widget.settings?.["folderId"])
          .filter((id): id is string => typeof id === "string"),
      ),
    [layout],
  );

  /**
   * Which space a card belongs to, and the thing the card points at.
   *
   * One lookup for both because they are one lookup: a list knows its space and a
   * folder knows its space, and a card knows which of the two it is. Resolving
   * them separately is how a folder card ends up painted in no colour at all
   * while the list next to it is painted correctly.
   */
  const subject = useCallback(
    (widget: { settings?: Record<string, unknown> }) => {
      const folderId = widget.settings?.["folderId"] as string | undefined;
      if (folderId) {
        const folder = folderById.get(folderId);
        // The space a folder is in, from the folder when it is still there and
        // from the card when it is not. The card carries it precisely so that a
        // folder that has been deleted still says which space it was in while
        // somebody is deciding whether to take the card off the panel.
        const workspaceId =
          folder?.workspaceId ?? (widget.settings?.["workspaceId"] as string | undefined);
        return { workspaceId, kind: "folder" as const };
      }
      // A note has no place, so `whereOf` has nothing to say about one: a card
      // that opens a note is not "in" the space the note was written in, and
      // saying it was would move the card when the note was filed somewhere else.
      if (widget.settings?.["noteId"]) {
        return { workspaceId: undefined, kind: "note" as const };
      }

      const list = listById.get(widget.settings?.["listId"] as string);
      return { workspaceId: list?.workspaceId, kind: "list" as const };
    },
    [folderById, listById],
  );

  /** The colour of the space a card belongs to, so the card is painted with it. */
  const colorKeyOf = useCallback(
    (widget: { settings?: Record<string, unknown> }) => {
      const { workspaceId } = subject(widget);
      return workspaceId ? colorByWorkspace.get(workspaceId) : undefined;
    },
    [colorByWorkspace, subject],
  );

  /**
   * The wash of the space a card belongs to.
   *
   * The same lookup as `colorKeyOf` and not folded into it, because the two travel
   * separately: a colour is always there, a wash is a choice that predates the
   * field, and a space without one has to keep painting as it did.
   */
  const washOf = useCallback(
    (widget: { settings?: Record<string, unknown> }) => {
      const { workspaceId } = subject(widget);
      return workspaceId ? washByWorkspace.get(workspaceId) : undefined;
    },
    [washByWorkspace, subject],
  );

  /**
   * The end colour of the space a card belongs to.
   *
   * The same lookup as the wash and for the same reason: the pair the card is
   * painted with has to be the pair the person chose, not the one the maths
   * derives from the first colour alone.
   */
  const colorToOf = useCallback(
    (widget: { settings?: Record<string, unknown> }) => {
      const { workspaceId } = subject(widget);
      return workspaceId ? colorToByWorkspace.get(workspaceId) : undefined;
    },
    [colorToByWorkspace, subject],
  );

  /** Which space a card belongs to, said while the panel is being arranged. */
  const whereOf = useCallback(
    (widget: { settings?: Record<string, unknown> }) => {
      const { workspaceId } = subject(widget);
      const name = workspaces.find((space) => space.id === workspaceId)?.name;
      return name ? t("dashboard.spaceOf", { name }) : "";
    },
    [subject, t, workspaces],
  );

  /**
   * The kind of list a card points at, from the card itself.
   *
   * From the card and not only from the list, because a card outlives its list:
   * the kind was written into the card when it was pinned, so a card whose list
   * has been deleted still knows what it was. The mark is the one thing on a
   * panel that is worth having after the thing it points at is gone.
   */
  const kindOf = (widget: { settings?: Record<string, unknown> }) =>
    (widget.settings?.["kind"] as ListKind | null | undefined) ?? null;

  const describe = useCallback(
    (widget: { id: string; kind?: string; settings?: Record<string, unknown> }) => {
      const title =
        (widget.settings?.["title"] as string) ?? t("lists.title");

      // A folder. It opens the folder, and it says how much is in it, which is the
      // only thing about a folder worth putting on a card.
      const folderId = widget.settings?.["folderId"] as string | undefined;
      if (folderId) {
        const folder = folderById.get(folderId);
        if (!folder) {
          return {
            title,
            subtitle: t("dashboard.deletedFolder"),
            emoji: (widget.settings?.["emoji"] as string) ?? null,
            href: null,
            // Still a folder's card, even though the folder is gone: the mark says
            // what it was, and a card that changes its mark when its subject is
            // deleted is a card that lies about itself.
            mark: cardMark({ folder: true }),
          };
        }
        const inside = lists.filter((list) => list.folderId === folder.id).length;
        return {
          title: folder.name,
          subtitle: t(pluralKey("dashboard.listsInside", inside), {
            count: inside,
          }),
          emoji: iconEmoji(folder.icon),
          href: `/(app)/workspace/${folder.workspaceId}/folder/${folder.id}`,
          mark: cardMark({ folder: true }),
        };
      }

      // A note. It says how much writing is on it, which is the one thing about a
      // note worth putting on a card, and it opens the note.
      const noteId = widget.settings?.["noteId"] as string | undefined;
      if (noteId) {
        const note = notesById.get(noteId);
        if (!note) {
          return {
            title,
            subtitle: t("dashboard.deletedNote"),
            emoji: null,
            href: null,
            mark: cardMark({ note: true }),
          };
        }
        return {
          title: note.title.length > 0 ? note.title : t("note.untitled"),
          subtitle: notePreview(note).slice(0, 80),
          emoji: null,
          href: `/(app)/note/${note.id}`,
          mark: cardMark({ note: true }),
        };
      }

      const list = listById.get(widget.settings?.["listId"] as string);
      if (!list) {
        // A card whose list is gone. It says so instead of opening nothing, and
        // it can still be taken off the panel while the panel is being arranged.
        return {
          title,
          subtitle: t("dashboard.deletedList"),
          emoji: (widget.settings?.["emoji"] as string) ?? null,
          href: null,
          // What it was, from the card itself. The list is gone but the kind was
          // written into the card when it was pinned, and a film list that has
          // been deleted still looks like a film list rather than like nothing.
          mark: cardMark({ kind: kindOf(widget) }),
        };
      }
      return {
        title: list.title,
        subtitle: t(pluralKey("lists.itemCount", list.itemCount), {
          count: list.itemCount,
        }),
        emoji: iconEmoji(list.icon),
        href: `/(app)/list/${list.id}`,
        mark: cardMark({ kind: list.kind }),
      };
    },
    [folderById, listById, lists, t],
  );

  /*
    Lo fijado en el panel, y **en borrador hasta Guardar**.

    Cada toque llamaba a fijar o quitar al instante, asi que salir sin Guardar
    dejaba un panel que nadie confirmo. Ahora los toques mueven estas copias y solo
    Guardar escribe, una sola vez: cada `save` planifica desde el `layout` que su
    llamador capturo, asi que N escrituras seguidas parten del mismo y la segunda
    se come a la primera. Una sola escritura no tiene ese problema porque no hay
    segunda.
  */
  const [pinsBorrador, setPinsBorrador] = useState<{
    lists: Set<string>;
    folders: Set<string>;
    notes: Set<string>;
  } | null>(null);
  useEffect(() => {
    /*
      Al abrir y no en cada render: los conjuntos vivos cambian de identidad en
      cada render del padre, y depender de ellos tiraria lo elegido con cada
      tecla en cualquier otro sitio. Lo elegido pertenece a esta apertura.
    */
    if (picking) {
      setPinsBorrador({
        lists: new Set(onPanel),
        folders: new Set(folderOnPanel),
        notes: new Set(noteOnPanel),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  /** Mueve una copia, y no escribe nada. */
  const moverPin = useCallback(
    (kind: "lists" | "folders" | "notes", id: string) => {
      setPinsBorrador((previo) => {
        const base = previo ?? {
          lists: new Set(onPanel),
          folders: new Set(folderOnPanel),
          notes: new Set(noteOnPanel),
        };
        const copia = {
          lists: new Set(base.lists),
          folders: new Set(base.folders),
          notes: new Set(base.notes),
        };
        const conjunto = copia[kind];
        if (conjunto.has(id)) conjunto.delete(id);
        else conjunto.add(id);
        return copia;
      });
    },
    [onPanel, folderOnPanel, noteOnPanel],
  );

  const pinsSucios = useMemo(() => {
    if (!pinsBorrador) return false;
    const distinto = (a: Set<string>, b: ReadonlySet<string>) =>
      a.size !== b.size || [...a].some((id) => !b.has(id));
    return (
      distinto(pinsBorrador.lists, onPanel) ||
      distinto(pinsBorrador.folders, folderOnPanel) ||
      distinto(pinsBorrador.notes, noteOnPanel)
    );
  }, [pinsBorrador, onPanel, folderOnPanel, noteOnPanel]);

  /**
   * Escribe lo elegido, **una sola vez**.
   *
   * Parte del `layout` vivo y le aplica la diferencia con copias locales, en vez
   * de llamar a fijar/quitar N veces: cada una de esas planifica desde el
   * `layout` capturado y N seguidas se comerian entre si.
   */
  const guardarPins = useCallback(async () => {
    if (!pinsBorrador) {
      setPicking(false);
      return;
    }
    let siguiente = layout;
    for (const id of onPanel) {
      if (!pinsBorrador.lists.has(id)) siguiente = withoutPinnedList(siguiente, id);
    }
    for (const id of pinsBorrador.lists) {
      if (!onPanel.has(id)) {
        const list = listById.get(id);
        if (list) siguiente = withPinnedList(siguiente, list, currentPage);
      }
    }
    for (const id of folderOnPanel) {
      if (!pinsBorrador.folders.has(id)) siguiente = withoutPinnedFolder(siguiente, id);
    }
    for (const id of pinsBorrador.folders) {
      if (!folderOnPanel.has(id)) {
        const folder = folderById.get(id);
        if (folder) siguiente = withPinnedFolder(siguiente, folder);
      }
    }
    for (const id of noteOnPanel) {
      if (!pinsBorrador.notes.has(id)) siguiente = withoutPinnedNote(siguiente, id);
    }
    for (const id of pinsBorrador.notes) {
      if (!noteOnPanel.has(id)) {
        const note = notesById.get(id);
        if (note) siguiente = withPinnedNote(siguiente, note, currentPage);
      }
    }
    await save(siguiente);
    setPinsBorrador(null);
    setPicking(false);
  }, [
    pinsBorrador,
    layout,
    onPanel,
    folderOnPanel,
    noteOnPanel,
    listById,
    folderById,
    notesById,
    currentPage,
    save,
  ]);

  /*
   * What could still be added, and the panel's plus is drawn only when there is
   * something.
   *
   * Notes were missing from this sum, and a person whose account had notes and no
   * lists — which is the ordinary account of somebody who writes rather than
   * collects — got a panel they could arrange and no way to put anything on it.
   * The button hides itself when there is nothing to add, which is right, and it
   * has to be right about *everything* that can be added.
   */
  const available = useMemo(
    () =>
      lists.filter((list) => !onPanel.has(list.id)).length +
      folders.filter((folder) => !folderOnPanel.has(folder.id)).length +
      notes.filter((note) => !noteOnPanel.has(note.id)).length,
    [folderOnPanel, folders, lists, noteOnPanel, notes, onPanel],
  );

  const pistaEdit = useA11yHint(t("dashboard.editLayoutHint"));

  /*
    The panel's one button, in the header — the pencil while you are looking and
    Guardar while you are arranging, from one declaration and one place, so the
    corner of the screen always means the same thing.

    A `useCallback` and not an element, because what is published is a way to
    draw the button rather than the button: the header asks for it every time it
    is drawn, which is what lets it follow `editing` without the layout and the
    screen writing to the same slot.
  */
  const botonCabecera = useCallback(
    () => (
      <View
        style={[
          styles.headerRight,
          { paddingRight: theme.spacing.xs + theme.spacing.lg },
        ]}
      >
        {editing ? (
          <Button
            testID="panel-done"
            label={t("dashboard.saveLayout")}
            icon="checkmark"
            size="sm"
            fullWidth={false}
            loading={saving}
            onPress={() => finishPanel.current()}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("dashboard.editLayout")}
            {...pistaEdit.props}
            onPress={() => setEditing(true)}
            style={({ pressed }) => [styles.editButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="create-outline" size={20} color={theme.colors.text} />
          </Pressable>
        )}
        {pistaEdit.node}
      </View>
    ),
    [
      editing,
      pistaEdit,
      saving,
      t,
      theme.colors.text,
      theme.spacing.lg,
      theme.spacing.xs,
    ],
  );
  /*
    The redraw, on purpose and by hand.

    `botonCabecera` closes over `pistaEdit`, and that hook builds a new object on
    every render, so depending on it would redraw the header on every render.
    The dependencies that actually change what the button *is* are these three:
    the pencil and Guardar swap on `editing`, Guardar spins on `saving`, and the
    words come from `t`.
  */
  useHeaderAction(botonCabecera, [editing, saving, t]);

  // And the title, for the same reason: nothing in the layout claims this
  // screen's header options, so what the screen says is what is drawn.
  useScreenTitle(t("home.greeting", { name: user?.displayName ?? "" }));

  return (
    /*
      `scroll={false}` and `edgeToEdge`, and both are the panel filling the screen.

      The scroll view is what makes the space the panel gets unpredictable: it
      measures its content and the content is the panel, so the panel would be
      asking for the space it is trying to fill. Without it the layout below the
      header has a real height, the panel measures it, and six rows of the cell
      are exactly that height — so the page has nothing to scroll, which is the
      whole point of the grid being a fraction of the screen rather than a number
      of points.

      And `edgeToEdge`, because the gap `Screen` normally leaves at the bottom is
      for a column of things that ends before the window does. The panel does not
      end, and with the gap left in, the bottom of the screen is a strip of
      nothing — a scroll that goes nowhere, on the one screen where nothing is
      allowed to scroll.
    */
    <Screen width="grid" scroll={false} edgeToEdge>
      {/*
        No header of its own. It drew one, and so did the other two destinations,
        and that is why the menu button sat at x = 8 on these three screens and at
        x = -8 on every other screen: two implementations of the same idea, and
        nothing kept them in agreement. The greeting is the title now and the
        pencil is the header's action, both set on the screen above, so there is
        one header in the app and one place to change it.
      */}

      <PanelGrid
        layout={layout}
        colorKeyOf={colorKeyOf}
        washOf={washOf}
        colorToOf={colorToOf}
        whereOf={whereOf}
        describe={describe}
        onChange={save}
        editing={editing}
        onEditingChange={setEditing}
        finishRef={finishPanel}
        availableCount={available}
        pages={pages}
        onPageChange={setCurrentPage}
        onAddPage={(count, draft) => void save(draft, count)}
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
        /*
          El Guardar es el del pie, y escribe lo elegido una sola vez. Los toques
          de dentro solo mueven el borrador: salir sin Guardar deja el panel como
          estaba, que es lo que "salir sin guardar se pierde" significa aqui.
        */
        onSave={() => void guardarPins()}
      >
        <PinsSucios sucio={pinsSucios} />
        <PanelPicker
          workspaces={workspaces}
          folders={folders}
          lists={lists}
          pinnedLists={pinsBorrador?.lists ?? onPanel}
          pinnedFolders={pinsBorrador?.folders ?? folderOnPanel}
          notes={notes}
          pinnedNotes={pinsBorrador?.notes ?? noteOnPanel}
          onToggleNote={(noteId) => moverPin("notes", noteId)}
          onToggleList={(listId) => moverPin("lists", listId)}
          onToggleFolder={(folderId) => moverPin("folders", folderId)}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRight: {
    alignItems: "center",
    justifyContent: "center",
  },
  editButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
