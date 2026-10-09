import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import type { Collection, Folder, List, Note } from "@orbit-hub/contracts";

import { CreateSheet } from "@/components/folders/create-sheet";
import type { SheetOrigin } from "@/components/ui/sheet";
import type { CreateKind } from "@/components/folders/create-sheet";
import { EntityMenuSheet } from "@/components/menus/entity-menu-sheet";
import {
  handlersDeColeccion,
  menuCtxDeColeccion,
} from "@/components/menus/coleccion";
import { ContentList } from "@/components/content/content-list";
import { FloatingButton } from "@/components/ui/floating-button";
import { SaveTemplateSheet } from "@/components/notes/save-template-sheet";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { WorkspaceMenuSheet } from "@/components/workspace/workspace-menu-sheet";
import { useDashboard } from "@/hooks/use-dashboard";
import { useLists } from "@/hooks/use-lists";
import { menuDeLista } from "@/lib/menus/lista";
import { menuDeCarpeta } from "@/lib/menus/carpeta";
import { menuDeNota } from "@/lib/menus/nota";
import { useCollections } from "@/hooks/use-collections";
import { useNotes } from "@/hooks/use-notes";
import { createCollectionAction } from "@/lib/collections/actions";
import { useHeaderAction } from "@/components/ui/header-action";
import { Button } from "@/components/ui/button";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useScreenShare } from "@/hooks/use-screen-share";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useTranslation } from "@/lib/i18n";

/**
 * A space, seen as a folder.
 *
 * The space is the root of the tree, so this screen and the one inside a folder
 * are the same screen with a different folder. Everything that can live in a
 * space lives in one of its folders, and the button in the corner is how all of
 * it is created, in the same three gestures wherever you are.
 */
export default function WorkspaceScreen() {
  const t = useTranslation();
  const router = useRouter();
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();

  const { workspaces } = useWorkspaces();
  const { folders, isLoading, createFolder, updateFolder, deleteFolder } =
    useFolders(workspaceId);
  const { layout, save } = useDashboard();

  const { lists, createList, updateList, deleteList, duplicateList } = useLists({ workspaceId });
  const { notes, createNote } = useNotes({ workspaceId });
  const { collections, bookmarkCounts } = useCollections(workspaceId);
  const [collectionFor, setCollectionFor] = useState<Collection | null>(null);

  const [menuFor, setMenuFor] = useState<
    { kind: "folder"; folder: Folder } | { kind: "list"; list: List } | null
  >(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createOrigin, setCreateOrigin] = useState<SheetOrigin | null>(null);
  const [createStep, setCreateStep] = useState<"what" | "kind" | "details">("what");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [title, setTitle] = useState("");
  /*
    Donde va lo que se crea, **y `null` es la raiz del espacio**.

    ------------------------------------------------------------------
    POR QUE ES UN PARAMETRO Y NO EL `folderId` DEL ESPACIO
    ------------------------------------------------------------------

    Porque esta pantalla crea en dos sitios y solo uno es la raiz: el boton "+" de la
    esquina, y "Crear una lista aqui" del menu de una carpeta. Las dos llaman **el
    mismo** `onCreate`, asi que el destino tiene que ser parte de lo que la pantalla
    sabe y no algo fijo escrito adentro de la funcion.

    Y `null` es un valor de verdad, no una ausencia: es lo que `createList`,
    `createFolder`, `createCollectionAction` y `createNoteAction` reciben para decir
    "en la raiz". Por eso el estado es `string | null` y no `string`: con un string
    vacio el boton "+" no tendria donde crear y habria que inventar un valor centinela
    que los cuatro actions no saben leer.

    ------------------------------------------------------------------
    Y POR QUE EL ESTADO, Y NO UN PARAMETRO DE `onCreate`
    ------------------------------------------------------------------

    Porque entre que la persona elige el tipo y aprieta Crear hay un `Sheet` entero en
    el medio, y el borrador del nombre vive fuera de el justamente para eso
    (`CreateSheetProps.title`, el comentario de ahi lo explica). El destino es del
    mismo genero: pertenece a la apertura, no al envio.

    Y lo que **no** puede hacer es no limpiarse: `closeSheets()` lo devuelve a `null`,
    asi que el ciclo de "crear dentro de una carpeta" no deja la carpeta puesta para la
    siguiente Apertura —que es el fallo de silencio que este estado evita—. Y las dos
    puertas lo dicen de todas formas: el boton "+" pone `null` explicito, para no
    depender de que el reset haya corrido.
  */
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
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
  useScreenTitle(workspace?.name ?? t("workspaces.title"), workspace?.icon ?? null);

  /*
   * La insignia de compartido, **al lado del titulo y no en un hueco de la barra**.
   *
   * No hay boton de compartir en la cabecera: compartir es una accion, y las
   * acciones van en los tres puntitos. Esto no es un boton, es **una nota sobre lo
   * que estas mirando** — y solo aparece cuando hay algo que decir. Dos iconos
   * distintos porque son dos hechos distintos: te lo dieron, o tu lo diste.
   */
  useScreenShare({
    node: workspace ? { nodeType: "workspace", id: workspace.id } : null,
    conmigo: workspace?.shared === true,
    onShare: () => setMenuOpen(true),
  });

  /** The folder a list lives in, for the menu to say where it is. */
  const folderOf = (list: List) =>
    folders.find((folder) => folder.id === list.folderId) ?? null;

  /**
   * The three menus of a row, and **the three salen del mismo registro**.
   *
   * `menuFor` es la union discriminada de lista y carpeta porque las dos se abren
   * desde el mismo `ContentList`, y la nota va aparte porque su fila abre otra
   * vez. Lo que las tres tienen en comun no es el estado sino el menu: cada una
   * le pide su normalizacion a `lib/menus/` y monta el mismo `EntityMenuSheet`.
   */
  const listaDelMenu = menuFor?.kind === "list" ? menuFor.list : null;
  const menuLista = menuDeLista(listaDelMenu, {
    folder: listaDelMenu ? folderOf(listaDelMenu) : null,
    t,
    layout,
    save,
    updateList,
    deleteList,
    duplicateList,
    // No states row: this is the space, not a board.
  });

  /** How many lists are inside a folder, for the menu to say what it holds. */
  const folderListCount = (folder: Folder | null) =>
    folder ? lists.filter((list) => list.folderId === folder.id).length : 0;

  const carpetaDelMenu = menuFor?.kind === "folder" ? menuFor.folder : null;
  const menuCarpeta = menuDeCarpeta(carpetaDelMenu, {
    layout,
    save,
    updateFolder,
    deleteFolder,
    listCount: folderListCount(carpetaDelMenu),
    t,
    /*
      Crear una lista **adentro**, y el menu se cierra antes de abrir el `Sheet`.

      ------------------------------------------------------------------
      POR QUE ESTE HANDLER ES DE LA PANTALLA Y NO DEL ADAPTADOR
      ------------------------------------------------------------------

      Porque elegir el tipo no crea nada: la lista tiene nombre, y el nombre lo escribe
      el paso de detalles del `CreateSheet` que esta pantalla tiene abierto. Lo que esta
      pantalla decide es **donde** va esa hoja —en la carpeta del menu, no en la raiz— y
      eso es comportamiento de pantalla: `lib/menus/` normaliza y no navega.

      El `menuDeCarpeta` solo reenvia el `kind`, que es todo lo que la pagina sabe.

      ------------------------------------------------------------------
      Y POR QUE `setMenuFor(null)` ESTA AL PRINCIPIO
      ------------------------------------------------------------------

      Por el mismo motivo que en la hoja vieja: se abre otra hoja encima. El `Sheet` de
      la carpeta y el del `CreateSheet` son dos `Modal` sobre la pantalla, y el menu
      que se queda visible debajo se lleva los toques que van al de arriba. Ademas
      `closeSheets` **no** sirve aqui, porque ademas de cerrar las hojas limpia
      `createFolderId` —el destino que recien vamos a poner—, y el orden importa: si se
      cerrara todo, la carpeta se perderia antes de que la otra hoja la leyera.

      Por eso el menu se cierra **suelto** y la hoja de creacion se abre **suelta**: los
      dos caminos se escriben a mano, y no por descuido sino porque el orden es la
      regla.
    */
    createInside: (kind) => {
      /*
        El `?? null` de mas abajo **no** es el caso normal: es la red de seguridad de un
        menu que se cerro entre que se abrio y que se toco, que no deberia pasar. Por eso
        el `if (!carpetaDelMenu) return` va antes: sin carpeta no hay "dentro", y caer
        en `null` crearia en la raiz, que es **exactamente el fallo que este handler
        arregla**. Un `return` callado es preferible a una lista en el sitio que no se
        pidio.
      */
      if (!carpetaDelMenu) return;

      setMenuFor(null);
      setCreateFolderId(carpetaDelMenu.id);
      setCreateKind(kind);
      setCreateStep("details");
      setCreateOrigin(null);
      setCreateOpen(true);
    },
  });

  /*
    La nota, y lo unico que esta pantalla decide del menu: que puede leer el
    documento para la plantilla. La capacidad y el handler son la misma fila, asi
    que el adaptador contesta las dos mitades leyendo este callback —si las dos
    pantallas que abren el menu de una nota lo pasan, la fila sale en las dos; si
    una dejara de pasarlo, su menu pierde la fila sin error en ninguna parte—.

    El `setNoteFor(null)` de abajo esta ademas del `onClose` de la hoja, que es el
    que corre `EntityMenuSheet` cuando la accion termina bien. Es redundante a
    proposito: el menu se cierra igual si el handler llegara a fallar, y una fila
    que abre una hoja y deja el menu abierto encima no es un detalle de copy.
  */
  const menuNota = menuDeNota(noteFor, {
    onSaveAsTemplate: (target) => {
      setNoteFor(null);
      setTemplateFor(target);
    },
  });

  const closeSheets = useCallback(() => {
    setMenuOpen(false);
    setCreateOpen(false);
    setCreateStep("what");
    setCreateKind(null);
    setTitle("");
    /*
      Y el destino, que se limpia con lo demas y por la misma razon: la carpeta de la
      que se entro es de **esa** apertura. Sin este `null`, abrir "crear aqui" en una
      carpeta y cerrar, y despues apretar "+", crearia la lista dentro de la carpeta
      de la apertura anterior —y no fallaria: crearia, en el sitio que no se pidio—.
    */
    setCreateFolderId(null);
    /*
      And the row's own menu, **which it did not close**.

      This function is what every sheet on this screen calls when it is dismissed,
      and it cleared five pieces of state and not the sixth: the item whose menu was
      open. So pressing the cross on a folder's menu asked the screen to close it,
      the screen agreed, and the folder was still there — and the sheet's `visible`
      is "there is a folder", so it stayed open. Which reads, from the other side of
      the screen, as a three-dot button that opens a menu that will not go away.
    */
    setMenuFor(null);
  }, []);

  /*
    Crear, y **las cinco ramas leen el mismo destino**.

    ------------------------------------------------------------------
    POR QUE `folderId: null` NO PUEDE SEGUIR ESTA AHI
    ------------------------------------------------------------------

    Porque `null` no es "el destino que no se": es **la raiz del espacio**. Los cuatro
    actions lo dicen en su propio contrato —`createList` lo documenta como "`null` es el
    espacio mismo, que es la carpeta raiz"—. O sea que un `folderId: null` escrito
    adentro no es un valor por defecto, es una **afirmacion**: "esto va en la raiz".
    Y cuando la persona aprieto "Crear una lista aqui" en una carpeta, esa afirmacion
    es falsa, y lo que hace es crear la lista **en el sitio que no pidio sin fallar**.

    Ese es el peor de los fallos posibles en este trabajo: no es una fila que no esta,
    es una fila que esta, que hace algo y que lo hace mal. El que se equivoca no se
    entera nunca, porque la lista aparece en el espacio y ahi estaba.

    Por eso las **cuatro** ramas —carpeta, nota, coleccion y lista— leen
    `createFolderId`, y no solo la de lista: "crear aqui" hoy elige un tipo de lista,
    pero la accion es "crear dentro de esta carpeta" y el dia que ofrezca tambien una
    nota o una carpeta tienen que ir al mismo sitio que la lista. Dejarlas en `null`
    seria dejar la mitad de la accion con el destino equivocado para siempre.

    ------------------------------------------------------------------
    Y POR QUE NO SE PIDE EL DESTINO COMO PARAMETRO
    ------------------------------------------------------------------

    Porque `onCreate` es el callback de `CreateSheet` y su firma es `() => void`: el
    destino tiene que estar en la pantalla, no en quien la llama. Y porque el estado
    sobrevive al `Sheet` de en medio, que es lo unico que puede: si fuera un argumento
    de `onCreate`, el boton "+" tendria que pasarlo y el menu de la carpeta tambien, y
    cualquiera de los dos que se olvidara crearia en la raiz sin avisar.
  */
  const onCreate = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || !workspaceId) return;
    if (createKind === "folder") {
      // `parentId` y no `folderId`: una carpeta dentro de una carpeta cuelga del
      // mismo lugar, y la raiz es `null` aqui tambien.
      await createFolder({ name: trimmed, parentId: createFolderId });
    } else if (createKind === "note") {
      // Written locally and opened straight away: the note is in the cache from
      // this moment, so there is nothing to wait for.
      const noteId = await createNote({
        workspaceId,
        folderId: createFolderId,
        title: trimmed,
      });
      closeSheets();
      router.push({ pathname: "/note/[noteId]", params: { noteId } });
      return;
    } else if (createKind === "collection") {
      await createCollectionAction({
        workspaceId,
        folderId: createFolderId,
        name: trimmed,
      });
    } else if (createKind) {
      await createList({
        workspaceId,
        folderId: createFolderId,
        title: trimmed,
        kind: createKind,
      });
    }
    closeSheets();
  }, [
    closeSheets,
    createFolder,
    createFolderId,
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
        overlay={<FloatingButton
          onPress={(origin) => {
            setCreateOrigin(origin);
            // La raiz, **dicho**: este boton crea en el espacio y no depende de que
            // `closeSheets` haya limpiado el destino de una apertura anterior. Las dos
            // puertas de esta pantalla dicen donde crean.
            setCreateFolderId(null);
            setCreateOpen(true);
          }}
        />}
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
      overlay={<FloatingButton
          onPress={(origin) => {
            setCreateOrigin(origin);
            /*
              La raiz, **dicho** —y no por distrust del reset, sino porque el boton es
              una puerta y una puerta dice donde abre. Depender de que `closeSheets` haya
              limpiado el destino de la apertura anterior es una cadena de tres pasos
              —abrir, crear, cerrar— para que un `null` llegue al sitio correcto.

              Y el boton "+" no es el unico que abre esta hoja: el menu de una carpeta
              tambien, y ese pone su carpeta. Los dos dicen el suyo.
            */
            setCreateFolderId(null);
            setCreateOpen(true);
          }}
        />}
    >
      {/*
        Lo que queda de la banda, y lo que no, y por que la descripcion y la lista
        van juntas.

        La banda era un rectangulo de color del espacio con el nombre, el menu, la
        descripcion, el rol y los miembros dentro. El color se fue a la cabecera y el
        nombre ya esta en el titulo, asi que de la banda solo sobrevive la
        descripcion.

        **El rol y el numero de miembros tambien se han ido**, y hay que decir por
        que, porque el comentario anterior de aqui defendia lo contrario: decia que
        quitarlos por estar en un rectangulo bonito era perder informacion por un
        estetica. Es cierto que eran los unicos sitios donde se decia, y tambien es
        cierto que ahi no se decia nada: el rol se ve en lo que el menu deja hacer,
        porque el menu de un espacio sin permiso de propietario no trae "salir del
        espacio", y un "2 miembros" al lado no explica nada que los tres puntos de al
        lado no expliquen mejor. Son dos etiquetas de metadatos antes de que empiece
        la lista, y el sitio para eso es el menu, no la primera fila.

        **Y van en un solo hijo de `Screen` y sin separacion.** Estaban en dos, y
        `Screen` pone `gap` entre sus hijos: la descripcion acababa `lg` por encima
        del buscador, y el buscador —que en una carpeta es lo primero que hay bajo
        la cabecera— aqui no lo era. Dos pantallas del mismo arbol con el buscador
        en sitios distintos, y el hueco no hacia nada: la descripcion y el buscador
        son la entrada a la misma lista. Envolverlos en una caja sin `gap` hace que
        la separacion sea la que hay dentro de la lista, que es la misma en las dos.

        No se toca el `gap` de `Screen`, que separa el buscador de los filtros y los
        filtros de las filas, y eso si se quiere igual en todas partes.
      */}
      <View>
        {workspace?.description ? (
          <AppText variant="callout" tone="muted" numberOfLines={2}>
            {workspace.description}
          </AppText>
        ) : null}

        <ContentList
          workspaceId={workspaceId}
          folderId={null}
          folders={folders}
          lists={lists}
          notes={notes}
          collections={collections}
          bookmarkCounts={bookmarkCounts}
          onCollectionMenu={(collection) => setCollectionFor(collection)}
          isLoading={isLoading}
          onFolderMenu={(folder) => setMenuFor({ kind: "folder", folder })}
          onListMenu={(list) => setMenuFor({ kind: "list", list })}
          onNoteMenu={(note) => setNoteFor(note)}
        />
      </View>
      <WorkspaceMenuSheet
        workspace={menuOpen ? workspace : null}
        onClose={closeSheets}
        onDeleted={() => router.replace("/(app)/workspaces")}
      />
      <EntityMenuSheet
        ctx={menuCtxDeColeccion(collectionFor)}
        handlers={handlersDeColeccion(collectionFor)}
        onClose={() => setCollectionFor(null)}
      />

      <EntityMenuSheet
        ctx={menuNota.ctx}
        icon={menuNota.icon}
        handlers={menuNota.handlers}
        onClose={() => setNoteFor(null)}
      />

      <SaveTemplateSheet
        visible={templateFor !== null}
        workspaceId={workspaceId}
        initialName={templateFor?.title ?? ""}
        document={templateFor?.document ?? ""}
        onClose={() => setTemplateFor(null)}
      />

      <EntityMenuSheet
        ctx={menuLista.ctx}
        icon={menuLista.icon}
        conteo={menuLista.conteo}
        pinned={menuLista.pinned}
        subtitulo={menuLista.subtitulo}
        handlers={menuLista.handlers}
        onClose={closeSheets}
      />

      {/*
        La carpeta, y **la fila de "crear una lista aqui" todavia no sale**.

        `ACCIONES.createHere` la declara y `ORDEN_POR_KIND.folder` la lista, con la
        capacidad `createInside` que `menuDeCarpeta` pone en `true`: la pantalla si
        sabe crearla. Lo que la saca es `puedeOfrecerse`, porque la pagina `create`
        no esta escrita —es un `MenuPageId` sin componente que la monte—. Esta
        escrito con nombre en `test/note-folder-menu-parity.test.ts`, porque una
        fila que no se pinto todavia y una fila que se perdio se ven igual desde el
        menu.

        Y lo que **no** se puede recuperar aqui es el `onCreateInside` que esta
        pantalla tenia: `EntityMenuSheet` no tiene prop para el y escribirla esta
        fuera de la superficie de esta tarea. Cuando la pagina `create` exista, el
        boton de abajo —`CreateSheet`— es el que recibe el tipo, y el salto directo
        a "details" con el tipo ya puesto vuelve con ella.
      */}
      <EntityMenuSheet
        ctx={menuCarpeta.ctx}
        icon={menuCarpeta.icon}
        pinned={menuCarpeta.pinned}
        subtitulo={menuCarpeta.subtitulo}
        handlers={menuCarpeta.handlers}
        onClose={closeSheets}
      />

      <CreateSheet
        open={createOpen}
        origin={createOrigin}
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
      />
    </Screen>
  );
}

