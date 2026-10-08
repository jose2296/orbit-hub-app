import type { Share } from "@orbit-hub/contracts";

import { ShareNodeForm } from "@/components/shares/share-node-sheet";

import type { MenuContext, MenuKind } from "@/lib/menus/registry";

export interface SharePageProps {
  ctx: MenuContext;
  /**
   * Lo que se hace cuando el envio salio bien, y es **cerrar el menu entero**.
   *
   * No es una decision de esta pagina: la toma la hoja y llega por props, como el
   * `onBorrar` de `DeletePage`. Lo que la pagina no puede decidir es que la hoja
   * se quede abierta —"ya lo tiene, mandaselo a otro"—, porque la fila se ofrece
   * una vez y el estado del formulario se pierde al desmontar.
   */
  onClose: () => void;
}

/**
 * Que `nodeType` le manda a `ShareNodeForm` por cada kind, **y por que el mapa es
 * exhaustivo y tiene nulos**.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTA TABLA Y NO UNA CONVERSION DE UNA LINEA
 * ------------------------------------------------------------------
 *
 * Porque el `nodeType` no sale de `MenuKind` por regla: son dos vocabularios que
 * hoy se parecen y no son el mismo. `MenuKind` tiene cinco y `shareNodeTypeSchema`
 * (`packages/contracts/src/workspace.ts:943`) tiene `workspace | folder | list |
 * list_item | note`. Tres de los cinco se traducen y dos **no tienen valor todavia**:
 *
 * - `collection` y `bookmark` no estan en el enum del contrato, y no se les inventa
 *   uno. Mandar `"list_item"` para una coleccion seria un POST que el servidor
 *   acepta —el enum lo admite— y grants sobre una tabla que no es esa, que es la
 *   peor falla posible: **no se ve**. Lo amplia la T10.
 * - `workspace` y `list_item` son del enum y no de `MenuKind`: un espacio no tiene
 *   menu de entidad y un elemento de lista tiene el suyo. Ninguno de los dos llega
 *   aca, asi que el mapa no los tiene.
 *
 * Y el tipo es `Record<MenuKind, ...>` y no `Partial<Record<...>>` a proposito: con
 * un `Partial` un sexto kind entra sin que el compilador pregunte nada, y la fila
 * se ofrece con un `nodeType` que nadie escribio —el mismo modo de fallo que un
 * `ctx` con un rol que el contrato no admite—. Con el `Record` completo, agregar un
 * kind al registro rompe el typecheck hasta que alguien decida que pasa con el.
 *
 * El guard esta en `test/share-page.test.ts` y **deriva** los dos lados: el mapa
 * del fuente contra el enum del contrato, y los kinds con `nodeType` contra los
 * kinds a los que el registro les ofrece la fila.
 */
const NODE_TYPE_POR_KIND: Record<MenuKind, Share["nodeType"] | null> = {
  list: "list",
  note: "note",
  folder: "folder",
  collection: null,
  bookmark: null,
};

/**
 * Compartir, y la misma pagina para una lista, una nota y una carpeta.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTA PAGINA ES TAN DELGADA
 * ------------------------------------------------------------------
 *
 * Porque `ShareNodeForm` ya existe, anda y esta probado: el campo, el directorio de
 * personas, los dos roles, la pregunta de si el nodo esta todavia solo en este
 * movil y el envio. Reescribir cualquiera de esas cosas aca seria una segunda
 * implementacion de compartir, y la que se desincroniza es la que nadie prueba.
 * Lo unico que faltaba era **la pagina que la monta**, y es lo que hace este
 * archivo.
 *
 * ------------------------------------------------------------------
 * POR QUE MONTA EL FORMULARIO Y NO UNA HOJA
 * ------------------------------------------------------------------
 *
 * Por lo mismo que el resto de las paginas de este directorio: una hoja encima de
 * otra son dos fondos sobre una pantalla y un toque que llega a la de arriba
 * cerrando la de abajo. `ShareNodeSheet` —el mismo formulario con su propio panel,
 * para los lugares que no tienen un panel del que ser pagina— dice exactamente
 * esto en su cabecera.
 *
 * ------------------------------------------------------------------
 * EL GUARDAR DEL PIE NO ES DE AC
 * ------------------------------------------------------------------
 *
 * El boton de enviar vive en `ShareNodeForm`, que tiene el estado del formulario,
 * y el Guardar del panel vive **arriba**, en el `Sheet` de la hoja. Un contexto no
 * fluye hacia arriba, asi que el formulario **publica** por
 * `ShareFormContexto` y la hoja lo pinta en el pie —el mismo reparto que ya hacen
 * `ShareNodeSheet` y `note-menu-sheet.tsx:99-112`—. Por eso esta pagina no recibe
 * ningun `onSave` ni ningun `enviar`: no tiene nada que publicar y no tiene nada
 * que decidir. Lo que si hace es **no montar nada encima** del pie.
 *
 * ------------------------------------------------------------------
 * Y EL FORMULARIO ES QUIEN ARMA "SUCIO"
 * ------------------------------------------------------------------
 *
 * `useSheetSucio` se consume aca adentro, que es donde el `Provider` llega
 * (`sheet.tsx:630`): el formulario ya lo hace y no se toca. Esta pagina no escribe
 * ahi, y esa es la mitad que se pierde cuando alguien decide "sumar el boton
 * aqui": el `setSucio` de la hoja escribe al valor por defecto y no falla, asi que
 * el bug entra en verde.
 */
export function SharePage({ ctx, onClose }: SharePageProps) {
  const nodeType = NODE_TYPE_POR_KIND[ctx.kind];

  /*
    Un kind sin `nodeType` es uno que el registro **no le ofrece** la fila
    (`ACCIONES.share.disponible` es `COMPARTIBLE.includes(...)`, y `collection` y
    `bookmark` no estan en `COMPARTIBLE`), asi que entrar aca con uno seria un
    fallo de escritura y no un caso de quien esta usando la app.

    Y se pinta `null` en vez de un error porque **la fila no llega a existir**: no
    hay ningun toque que pueda traerla, y un aviso que nadie puede ver es ruido.
    El guard que lo sostiene esta en `test/share-page.test.ts` y deriva los dos
    lados —la fila y el mapa— para que el `null` no se vuelva cierto por una
    razon que nadie miro.
  */
  if (!nodeType) return null;

  return (
    <ShareNodeForm
      /*
        El `id` y el `title` salen del `ctx` y no se piden: el `MenuEntity` ya
        normaliza el nombre —el unico campo que la hoja necesita para pintar el
        titulo de la cabecera— y el id es el identificador de la entidad, que es lo
        que hay que mandar al servidor. Pedirlos por props seria una segunda fuente
        de la verdad para lo que el registro ya sabe.

        Y el `title` va igual aunque la cabecera de la hoja ya lo muestre: lo pide
        `ShareNodeForm` como parte del `target`, y es el nombre que viaja en el
        grant —el que lee la bandeja de entrada de la otra persona—, asi que
        cambiarlo seria cambiar lo que el otro ve.
      */
      target={{ nodeType, nodeId: ctx.entity.id, title: ctx.entity.title }}
      onDone={onClose}
    />
  );
}
