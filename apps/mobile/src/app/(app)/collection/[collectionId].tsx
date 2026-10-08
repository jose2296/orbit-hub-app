import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import type { Bookmark, Collection } from "@orbit-hub/contracts";

import { LinkRow } from "@/components/bookmarks/link-row";
import { EntityMenuSheet } from "@/components/menus/entity-menu-sheet";
import {
  handlersDeColeccion,
  menuCtxDeColeccion,
} from "@/components/menus/coleccion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useHeaderAction } from "@/components/ui/header-action";
import { Screen } from "@/components/ui/screen";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useCollections } from "@/hooks/use-collections";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useTranslation } from "@/lib/i18n";
import { handlersDeBookmark, menuCtxDeBookmark } from "@/lib/menus/bookmark";
import { useTheme } from "@/theme";

/**
 * Una coleccion, como pantalla y no como filtro.
 *
 * ------------------------------------------------------------------
 * POR QUE DEJO DE SER UN PARAMETRO DE `bookmarks.tsx`
 * ------------------------------------------------------------------
 *
 * Porque `bookmarks.tsx` con `collectionId` en la ruta era una lista de enlaces
 * con el nombre de la coleccion pegado encima, y de ahi salia lo que no podia
 * tener: **ningun menu propio**. Las acciones de la coleccion estaban en su fila,
 * dentro del espacio o de la carpeta, o sea en un sitio al que no se llega desde
 * la coleccion que se esta mirando —y al que se vuelve caminando hacia atras cada
 * vez que hace falta—. Y mientras la coleccion no habia llegado de la cache, la
 * cabecera decia "Bookmarks", que es el nombre de la lista y no el de lo que estas
 * mirando.
 *
 * El esqueleto es el de `folder/[folderId].tsx` y el de `list/[listId].tsx`, y no
 * uno nuevo: `Screen`, el nombre en la cabecera con `useScreenTitle`, y los tres
 * puntitos de la cabecera publicados con `useHeaderAction` —que es la unica via
 * que funciona, y el motivo esta escrito en `header-action.tsx`—. El boton es el
 * `Button` de las demas cabeceras y no el de las filas, porque aqui es una
 * cabecera.
 */

/**
 * Un id de coleccion que no puede existir, para cuando la ruta llega sin el.
 *
 * `applyBookmarkFilters` trata `collectionId: undefined` como "sin opinion sobre
 * la coleccion", que es **la lista entera**: una pantalla titulada "Coleccion" con
 * los enlaces de todos los espacios no es un caso raro de ver, es lo que aparece
 * con un enlace mal escrito. Y el vacio no puede ser un id —`withBookmarkDefaults`
 * deja `collectionId` en `null` cuando el payload no lo trae, nunca en `""`—, asi
 * que filtrar por el deja la pantalla vacia, que es lo que un enlace roto tiene
 * que pintar.
 */
const NINGUNA_COLECCION = "";

export default function CollectionScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { collectionId } = useLocalSearchParams<{ collectionId: string }>();

  /*
    ------------------------------------------------------------------
    LOS DOS MENUS, Y LOS DOS GUARDAN LA ENTIDAD
    ------------------------------------------------------------------

    Son dos porque son **dos entidades**: la coleccion que estas mirando y cada
    enlace que hay debajo. El estado es la entidad y no un `true`, con la misma
    razon que en `bookmarks.tsx` y que en las dos pantallas que ya abren el menu
    de una coleccion: la hoja congela lo que recibe con `useLastValue` para
    seguir pintando mientras baja, y lo que espera del llamador al cerrarse es
    `null`. Con un `true` seria la hoja la que tiene que decidir de que entidad se
    trata, que es el `switch` que esta pantalla no tiene.

    Y el enlace entero, no su id: el menu necesita el titulo, el rol y la version
    para armar el ctx y los handlers, y volver a buscarlo en la lista seria una
    segunda fuente de verdad para el mismo enlace.
  */
  const [coleccionConMenu, setColeccionConMenu] = useState<Collection | null>(null);
  const [enlaceConMenu, setEnlaceConMenu] = useState<Bookmark | null>(null);

  /*
    `undefined` y no el `workspaceId` de la ruta: **la ruta no lleva espacio**, y
    el espacio de una coleccion es un dato de la coleccion. Un id de coleccion es
    unico en la cache entera, asi que leerlas todas para hallar una no es una
    pregunta mas amplia de lo necesario: es la unica que se puede hacer antes de
    saber que la coleccion existe. `bookmarks.tsx` recibe el `workspaceId` de la
    ruta porque su ruta la lleva; esta no.
  */
  const { collections } = useCollections(undefined);
  const coleccion = useMemo(
    () => collections.find((item) => item.id === collectionId) ?? null,
    [collections, collectionId],
  );

  const { workspaces } = useWorkspaces();
  const espacio = useMemo(
    () => workspaces.find((item) => item.id === coleccion?.workspaceId) ?? null,
    [workspaces, coleccion?.workspaceId],
  );

  /*
    El nombre de la cabecera es `Collection.name` y no una regla escrita aca: es
    el mismo nombre que va a la cabecera de la hoja y al campo de renombrar, y tres
    copias de la regla "como se llama esto" son tres reglas que pueden diferir sin
    que nada falle. La normalizacion —`name` a `title`— vive en
    `components/menus/coleccion.ts`; lo unico que se reusa aca es el dato.

    El icono **no** se pasa, y es a proposito: el campo de icono de una coleccion
    es `emoji`, que es texto plano, y no un `IconRef` —es la misma regla que
    `CON_ICON_REF` escribe en el registro—. Ponerle un icono de vector seria
    oferecerle algo que el contrato no puede guardar.
  */
  useScreenTitle(coleccion?.name ?? t("collections.kind"));

  /*
    El lavado del espacio, y por que esta pantalla tambien lo lleva: una
    coleccion vive en un espacio, y `list/[listId].tsx` y `folder/[folderId].tsx`
    —las dos pantallas que son su modelo— lo ponen. Sin el, esta seria la unica
    pantalla de dentro de un espacio con la cabecera en el gris del tema, que es
    justo lo que la cabecera unificada vino a evitar.
  */
  useScreenSpace(espacio);

  /*
    El menu de la coleccion, en la cabecera. El `null` cuando no hay coleccion es
    lo que hacen las dos pantallas del modelo: tres puntitos que abren el menu de
    nada son un boton sin destino.

    ------------------------------------------------------------------
    Y POR QUE LA ETIQUETA ES `collections.menu`
    ------------------------------------------------------------------

    Porque es la frase que nombra **este** control para **esta** entidad, al
    estilo de `lists.menu` y `folders.menu`. Las otras dos salidas se descartaron y
    conviene tenerlas contadas, porque cualquier tarea que monte otro tres puntitos
    de cabecera las va a encontrar:

    - Pedir la de otra entidad seria **mentir en voz alta**: "Menu de la lista" en la
      cabecera de una coleccion.
    - Reusar la frase que compone el boton de la fila —"Acciones de {name}"— es la
      que mas encaja, y no se puede: `icon-page.test.ts` afirma que esa frase vive
      **solo** dentro de `menu-button.tsx`, que es el componente que la compone y el
      que se la pide como `label`. Un boton de cabecera y un boton de fila son dos
      controles distintos, y por eso tienen dos frases.
  */
  useHeaderAction(
    () =>
      coleccion ? (
        <Button
          testID="collection-menu-button"
          label={t("collections.menu")}
          variant="ghost"
          size="sm"
          icon="ellipsis-horizontal"
          iconOnly
          fullWidth={false}
          onPress={() => setColeccionConMenu(coleccion)}
        />
      ) : null,
    [coleccion, t],
  );

  /*
    Los enlaces, por el id de la ruta y no por el de la coleccion: la cache todavia
    no ha dicho que la coleccion exista, y filtrar por ella seria filtrar por
    `undefined`, que es la lista entera —el `NINGUNA_COLECCION` de arriba—.

    Y **sin el `workspaceId`**, que no se sabe todavia. No hace falta: el filtro es
    por id de coleccion, que es unico en la cache, asi que anadir el espacio solo
    pondria una segunda condicion que todavia no se puede cumplir.

    ------------------------------------------------------------------
    POR QUE NO HAY ESTADO "NO ENCONTRADA"
    ------------------------------------------------------------------

    Porque `bookmarks.tsx` —el molde de esta pantalla— tampoco lo tiene: sin
    coleccion, el titulo cae a `collections.kind` y el cuerpo dice que no hay
    enlaces. Inventar una pantalla de error para un id que no existe es un estado
    que nadie llega a ver, y el caso de verdad —borrar la coleccion que se esta
    mirando— no pasa por aqui, porque el efecto de mas abajo saca de la pantalla.
  */
  const { bookmarks, isLoading } = useBookmarks({
    collectionId: collectionId ?? NINGUNA_COLECCION,
  });

  /*
    Borrar la coleccion desde su propio menu deja la pantalla sin lo que estaba
    mirando, y **quien navega es el call site**: `DeletePage` corre
    `handlers.borrar` y no sabe de donde se abrio el menu. Es lo mismo que hace
    `list/[listId].tsx` con su `onDeleted`.

    Y se comprueba con un flag y no con `!coleccion`, porque mientras la cache
    carga no hay coleccion **todavia**: sin el flag, entrar en la pantalla por un
    id que no existe —o abrirla en frio— sacaria de ella al instante.
  */
  const existio = useRef(false);
  useEffect(() => {
    if (coleccion) {
      existio.current = true;
      return;
    }
    if (existio.current) router.back();
  }, [coleccion, router]);

  /*
    El orden lo pone el hook (`updatedAt desc`: lo ultimo guardado arriba, que es
    "leer despues"). Esta pantalla no reordena: un `.sort` aca seria un segundo
    criterio compitiendo con el primero, y el molde tampoco ordena.

    Y no arma una lista de "items": lo que cada fila sabe de si misma lo decide
    `LinkRow`, que es **la misma fila** que pintan la lista y el inbox.
  */

  if (isLoading) return <View style={{ flex: 1 }} />;

  return (
    <Screen
      /*
        La mitad de abajo del lavado del espacio: la de arriba la pinta la
        cabecera. Es el mismo par de colores y se juntan sin costura, que es el
        motivo de que el alto de la barra no cambie entre pantallas.
      */
      wash={
        espacio
          ? { color: espacio.color, colorTo: espacio.colorTo, wash: espacio.wash }
          : null
      }
    >
      {bookmarks.length === 0 ? (
        /*
          El vacio dice lo mismo que la lista de la que esta pantalla viene: es la
          misma lista de enlaces, con las mismas palabras. `collections.empty` —"Sin
          enlaces todavia"— es la linea de una **fila** de coleccion, y aqui lo que
          falta son los enlaces, no la coleccion.
        */
        <EmptyState
          icon="bookmark-outline"
          title={t("bookmarks.empty.title")}
          description={t("bookmarks.empty.body")}
        />
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {bookmarks.map((bookmark) => (
            <LinkRow
              key={bookmark.id}
              bookmark={bookmark}
              testID={`collection-menu-${bookmark.id}`}
              onPress={() =>
                router.push({
                  pathname: "/bookmark/[bookmarkId]",
                  params: { bookmarkId: bookmark.id },
                })
              }
              onMenu={() => setEnlaceConMenu(bookmark)}
            />
          ))}
        </View>
      )}
      {/*
        ------------------------------------------------------------------
        DOS HOJAS, UNA IMPLEMENTACION
        ------------------------------------------------------------------

        Una para la coleccion y una para los enlaces, y **no** una sola con un
        estado que diga de que tipo es: cada estado ya **es** la entidad, asi que
        cada hoja recibe su `ctx` y sus handlers tal cual, sin un `switch` en el
        medio que elija. Las dos son `EntityMenuSheet` —la misma clase, la misma
        lista de filas, que sale del registro—, y la de los enlaces es
        exactamente la que abre `bookmarks.tsx`: la fila de un enlace no puede
        ofrecer una cosa distinta aqui y alla.

        Y la de la coleccion no declara ni una opcion: la normalizacion sale de
        `components/menus/coleccion.ts` y las filas las decide el registro.
      */}
      <EntityMenuSheet
        ctx={menuCtxDeColeccion(coleccionConMenu)}
        handlers={handlersDeColeccion(coleccionConMenu)}
        onClose={() => setColeccionConMenu(null)}
      />
      <EntityMenuSheet
        ctx={menuCtxDeBookmark(enlaceConMenu)}
        handlers={handlersDeBookmark(enlaceConMenu)}
        onClose={() => setEnlaceConMenu(null)}
      />
    </Screen>
  );
}

