import { ShareNodeForm } from "@/components/shares/share-node-sheet";

import { nodeTypeDe } from "@/lib/menus/registry";
import type { MenuContext } from "@/lib/menus/registry";

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
 * ------------------------------------------------------------------
 * POR QUE ACA NO HAY UNA TABLA DE `nodeType`
 * ------------------------------------------------------------------
 *
 * Habia una, y se llamaba `NODE_TYPE_POR_KIND`: un `Record<MenuKind, Share["nodeType"]
 * | null>` escrito a mano con tres valores y dos `null`. `AccessPage` tenia su copia,
 * `NODE_TYPE`, y el registro tenia la suya, `COMPARTIBLE`. **Tres copias del enum del
 * contrato**, con tres mecanismos distintos para decir lo mismo, y las tres se
 * desactualizaron en el mismo commit sin que nada se rompiera.
 *
 * La razon de fondo era buena y la conclusion estaba mal: los dos vocabularios—"que
 * cosas tienen menu" y "que cosas se comparten"— se parecian pero no eran el mismo,
 * y de ahi la conclusion de que hacia falta traducirlos. Ahora que el enum del
 * contrato admite los cinco, **la traduccion es la identidad** y no hay nada que
 * escribir: lo decide `nodeTypeDe`, que se deriva de `shareNodeTypeSchema.options`.
 *
 * Asi que esta pagina no tiene un mapa propio: llama a la misma funcion que el
 * registro usa para saber si ofrece la fila y que `AccessPage` usa para saber si
 * puede preguntar el alcance. Tres lectores, una decision.
 */

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
  const nodeType = nodeTypeDe(ctx.kind);

  /*
    Un kind sin `nodeType` es uno que el contrato no admite, y entonces el registro
    **no le ofrece la fila** (`ACCIONES.share.disponible` es `nodeTypeDe(...) !== null`),
    asi que entrar aca con uno seria un fallo de escritura y no un caso de quien esta
    usando la app.

    Y se pinta `null` en vez de un error porque **la fila no llega a existir**: no
    hay ningun toque que pueda traerla, y un aviso que nadie puede ver es ruido.

    Con los cinco kinds admitidos hoy el `null` es inalcanzable, y esa es la
    respuesta a la pregunta que hacia falta preguntar: el hueco de la T10 no era "el
    mapa no tiene valor", era "el contrato no tiene valor". Arreglado el segundo, el
    `null` sigue aqui como la red que avisa de un kind nuevo que el contrato todavia
    no conoce.
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
