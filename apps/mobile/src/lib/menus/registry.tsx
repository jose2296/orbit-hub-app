import type { Ionicons } from "@expo/vector-icons";
import type { MembershipRole } from "@orbit-hub/contracts";

import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * El registro: que acciones existen, cuales se ofrecen y en que orden.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO NO GUARDA FUNCIONES
 * ------------------------------------------------------------------
 *
 * Porque hay **ocho** hojas de menu en la app y cada una se escribio a mano:
 * `ListMenuSheet`, `NoteMenuSheet`, `FolderMenuSheet`, `WorkspaceMenuSheet`,
 * `CollectionMenuSheet`, `ColumnMenuSheet`, `MediaActionsSheet` y
 * `TemplateMenuSheet`. Las ocho arman sus filas con un `SheetOption[]` local, y
 * por eso el mismo predicado —"solo el dueno comparte", "lo compartido no se
 * borra"— esta escrito cuatro veces con cuatro comentarios distintos, y lo que
 * la ultima hoja que se escribio decidio es lo que corre.
 *
 * La tentacion al unificar es meter las acciones dentro del registro con sus
 * handlers: `{ id, label, onPress }`. **Eso no unifica nada**, solo mueve el
 * `sopa de props`. Cada call site tendria que inyectar quince handlers
 * (`onEditStates`, `onSaveAsTemplate`, `onTogglePin`, `onCreateInside`,
 * `onRename`, `onPickIcon`, `onDelete`, `onDuplicate`, `onShare`, `onExport`,
 * `onReach`, `onPanel`, `listCount`, `workspaceId`, `folder`) para poder pintar
 * un menu, y el objeto que se pasa de una pantalla a otra pasaria a llevar el
 * comportamiento del menu entero adentro. Volveriamos exactamente donde estamos,
 * con menos archivos.
 *
 * Asi que el registro guarda **descriptores puros** y el call site sigue pasando
 * los handlers. Lo que queda aqui es la *lista* —que acciones existen, cuales se
 * ofrecen y en que orden— y esa es justamente la parte que estaba copiada ocho
 * veces. La mecanica (borrar, renombrar, exportar) se la pasa el call site, y
 * por eso el registro se puede testear sin renderizar nada: no hay ningun
 * componente aqui que abrir.
 *
 * ------------------------------------------------------------------
 * POR QUE `labelKey` ES UNA FUNCION
 * ------------------------------------------------------------------
 *
 * Porque el copy de una accion depende del tipo de entidad, y el tipo de la
 * entidad no es un dato del descriptor: es un dato del contexto. El ejemplo que
 * ya duele es borrar: `lists.deleteBody` para una lista,
 * `bookmarks.deleteBody` para un enlace, `collections.delete.body` para una
 * coleccion, y cada uno explica una cosa distinta. Con un `labelKey` fijo habria
 * que elegir uno y mentir en los otros tres, o inventar un texto nuevo que
 * describe mal las cuatro. Como funcion, cada kind resuelve la suya.
 *
 * El mismo motivo hace que el registro no sepa de `useTranslation`: guarda la
 * *clave*, nunca la frase. Las frases viven en `dictionaries.ts` y el unico modo
 * de que una clave mala llegue a produccion es que falte en `en`, que es lo que
 * comprueba `test/menu-registry.test.ts`.
 */

export type MenuKind = "list" | "note" | "folder" | "collection" | "bookmark";

/** Las paginas que `EntityMenuSheet` sabe montar, no una hoja entera. */
export type MenuPageId =
  | "rename"
  | "icon"
  | "access"
  | "delete"
  | "export"
  | "create"
  | "share";

/**
 * Lo que un call site concreto puede hacer, y por lo tanto ofrece.
 *
 * No es un permiso: es una capacidad de la *pantalla*. `editStates` solo la
 * tiene un tablero, y `createInside` solo una carpeta; `panel` solo lo que se
 * puede pinear. La diferencia con `role` es que esta la decide el sitio que
 * abre el menu y no la persona que lo tiene delante.
 */
export type MenuCap =
  | "editStates"
  | "saveAsTemplate"
  | "createInside"
  | "panel"
  | "export";

/**
 * El handler de una accion que corre **en la hoja**, sin cambiar de pagina.
 *
 * Compartir NO va aqui y es a proposito: compartir es una pagina con su propio
 * formulario y su propio boton de guardar, no una fila que dispara un toast. Lo
 * que decide si algo es `hoja` o `pagina` es si cabe en la misma pantalla, no si
 * escribe.
 *
 * Y `"borrar"` sigue en la union **aunque ninguna accion lo declare ya como
 * `hoja`**: borrar es una pagina, y desde adentro de esa pagina la hoja lo corre
 * por su nombre —`DeletePage` recibe `onBorrar` y `MenuHandlers.borrar` es lo que
 * la app llama de verdad—. Sacarlo de aqui obligaria a la hoja a manejar el
 * handler de borrar con un tipo distinto al del resto, que es precisamente la
 * excepcion que esta vez se quiere evitar.
 */
export type MenuHandlerName =
  | "borrar"
  | "duplicar"
  | "alternarPin"
  | "editarEstados"
  | "guardarComoPlantilla";

export interface MenuEntity {
  id: string;
  /**
   * Normalizado: `Collection.name` y `Folder.name` llegan como `title`.
   *
   * Es la unica normalizacion que hace el registro y se hace **en el call site**,
   * no aqui: este archivo no conoce el contrato de ninguna entidad. La razon de
   * que sea una sola linea y no tres campos (`name`, `title`, `label`) es que el
   * registro compara y ordena sobre ella, y tres campos que pueden discrepar
   * producen una fila vacia en el subtitulo sin que nada falle.
   */
  title: string;
  role: MembershipRole;
  shared: boolean;
}

export interface MenuContext {
  kind: MenuKind;
  entity: MenuEntity;
  caps: Partial<Record<MenuCap, boolean>>;
}

export interface MenuAccion {
  id: string;
  /**
   * Funcion cuando el copy depende del tipo: el cuerpo de borrar ya difiere
   * (`lists.deleteBody`, `note.deleteBody`, `bookmarks.deleteBody`,
   * `collections.delete.body`).
   */
  labelKey: TranslationKey | ((ctx: MenuContext) => TranslationKey);
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "default" | "danger" | "accent";
  /**
   * Si esta accion se ofrece.
   *
   * Lee `role`, `shared` y `caps`, y hay **dos** razones distintas para decir
   * que no, que se distinguen por si hay `motivo`:
   *
   * - **Sin `motivo`**: la opcion no existe para este call site. Un tablero sin
   *   `editStates` no tiene fila de estados, y una opcion que se dibuja y no
   *   hace nada al tocarla es peor que una opcion que no esta.
   * - **Con `motivo`**: la opcion existe pero no se puede usar, y hay que
   *   decirlo. Borrar algo compartido sale grisado con la razon escrita, porque
   *   esconderlo deja a la persona creyendo que no existe en vez de que existe y
   *   no es suya.
   */
  disponible?: (ctx: MenuContext) => boolean;
  /**
   * Por que no se puede, y **la clave de i18n de ese por que**.
   *
   * Una `TranslationKey` y no un `string` porque el consumidor lo mete tal cual
   * en `t(...)`: con el tipo abierto, el unico filtro es un `as TranslationKey`
   * en cada lado, y un cast es exactamente donde se cuela una clave que no esta
   * en `dictionaries.en` —que es el unico sitio donde se puede comprobar, y
   * solo si el tipo obliga.
   */
  motivo?: (ctx: MenuContext) => TranslationKey | null;
  destino:
    | { tipo: "hoja"; handler: MenuHandlerName }
    | { tipo: "pagina"; page: MenuPageId };
}

/**
 * Las doce acciones, por id.
 *
 * Un `Record` y no un array porque el id es el nombre con el que las nueve tareas
 * siguientes van a hablar de esto, y un id descolocado es un error de escritura
 * en vez de un error de orden.
 */
/**
 * Los kinds cuyo campo de icono es un `IconRef`, y por lo tanto los unicos que
 * pueden usar el `IconPickerPanel`.
 *
 * **Esto no es una preferencia, es lo que dice el contrato**, y es la razon de
 * que `icon` no sea una accion universal:
 *
 * - `listSchema` (`workspace.ts:410`), `noteSchema` (`:540`) y `folderSchema`
 *   (`:275`) tienen `icon: iconRefSchema.default(null)`, que acepta las dos
 *   mitades del selector: vector con biblioteca y estilo, o emoji.
 * - `collectionSchema` (`bookmarks.ts:82`) tiene **`emoji: z.string().max(16)`**.
 *   Es una cadena, no un `IconRef`: el `emoji` del contrato es texto plano, sin
 *   `library`, sin `style`, sin `color`. A una coleccion **no se le puede guardar
 *   un icono vectorial**, y offeringle el selector entero es ofrecerle media
 *   opcion que al tocarla se pierde.
 * - `bookmarkSchema` (`bookmarks.ts:89`) **no tiene campo de icono**. Ponerle uno
 *   es un cambio de contrato y de la base, no un menu.
 *
 * O sea que "poner icono" en una coleccion es un emoji, y en un enlace todavia
 * no existe. Las tres cosas las resuelve la tarea T10 o una posterior; aqui la
 * fila simplemente no aparece donde no se puede cumplir.
 */
const CON_ICON_REF: MenuKind[] = ["list", "note", "folder"];

/**
 * Los kinds que `shareNodeTypeSchema` (`workspace.ts:943`) admite hoy:
 * `workspace`, `folder`, `list`, `list_item`, `note`. De los cinco de aqui,
 * tres.
 *
 * `ShareNodeSheetProps.target.nodeType` esta atado a ese enum, asi que ofrecer
 * compartir en una coleccion o en un enlace es pintar una fila que al tocarla
 * manda un `nodeType` que el contrato no admite. T10 amplia el enum y esta
 * lista con el.
 */
const COMPARTIBLE: MenuKind[] = ["list", "note", "folder"];

export const ACCIONES: Record<string, MenuAccion> = {
  states: {
    id: "states",
    labelKey: "board.editStates",
    icon: "options-outline",
    disponible: (ctx) => ctx.caps.editStates === true,
    destino: { tipo: "hoja", handler: "editarEstados" },
  },

  createHere: {
    id: "createHere",
    labelKey: "lists.createHere",
    icon: "add-circle-outline",
    disponible: (ctx) => ctx.caps.createInside === true,
    destino: { tipo: "pagina", page: "create" },
  },

  rename: {
    id: "rename",
    labelKey: "common.rename",
    icon: "create-outline",
    destino: { tipo: "pagina", page: "rename" },
  },

  icon: {
    id: "icon",
    labelKey: "icons.title",
    icon: "image-outline",
    disponible: (ctx) => CON_ICON_REF.includes(ctx.kind),
    destino: { tipo: "pagina", page: "icon" },
  },

  /*
    Fijar y quitar del panel son **la misma fila en dos estados**, y el registro
    declara las dos porque el copy es distinto y porque el test de paridad de la
    hoja de lista las tiene que encontrar a las dos.

    El *slot* del orden se llama `pin` y no aparece `unpin`: el estado de "ya esta
    en el panel" no lo sabe el registro, lo sabe el call site (`isPinned(layout,
    id)`), y meterlo en `MenuContext` seria meter en el contexto un dato que es
    de la pantalla y no de la entidad. Asi que `ORDEN_POR_KIND` reserva **un**
    lugar y la hoja elige cual de los dos descriptores pinta segun si la cosa ya
    esta ahi. Las dos se ofrecen con la misma capacidad, `panel`.
  */
  pin: {
    id: "pin",
    labelKey: "lists.pinToDashboard",
    icon: "apps-outline",
    disponible: (ctx) => ctx.caps.panel === true,
    destino: { tipo: "hoja", handler: "alternarPin" },
  },

  unpin: {
    id: "unpin",
    labelKey: "lists.unpinFromDashboard",
    icon: "remove-circle-outline",
    disponible: (ctx) => ctx.caps.panel === true,
    destino: { tipo: "hoja", handler: "alternarPin" },
  },

  duplicate: {
    id: "duplicate",
    labelKey: "lists.duplicate",
    icon: "copy-outline",
    destino: { tipo: "hoja", handler: "duplicar" },
  },

  /*
    Compartir es lo que mas se ha copiado en estas hojas: el predicado
    `role === "owner"` estaba escrito a mano en `list-menu-sheet.tsx:269`,
    `folder-menu-sheet.tsx:171` y `note-menu-sheet.tsx:257`, y el de la nota
    tardio en llevar el comentario que explica por que **no** es `owner ||
    editor`. Una sola vez, con el `MembershipRole` del contrato en vez de una
    union literal escrita a mano, que es lo que hacia posible que un `role:
    string` colado pasara sin quejarse.
  */
  share: {
    id: "share",
    labelKey: "share.pickSomeone",
    icon: "people-outline",
    disponible: (ctx) => COMPARTIBLE.includes(ctx.kind) && ctx.entity.role === "owner",
    motivo: (ctx) =>
      COMPARTIBLE.includes(ctx.kind) && ctx.entity.role !== "owner" ? "share.onlyOwner" : null,
    destino: { tipo: "pagina", page: "share" },
  },

  saveAsTemplate: {
    id: "saveAsTemplate",
    labelKey: "note.templates.saveCurrent",
    icon: "bookmark-outline",
    disponible: (ctx) => ctx.caps.saveAsTemplate === true,
    destino: { tipo: "hoja", handler: "guardarComoPlantilla" },
  },

  access: {
    id: "access",
    labelKey: "menus.access",
    icon: "eye-outline",
    destino: { tipo: "pagina", page: "access" },
  },

  /*
    Exportar depende de que exista el endpoint, y por eso es una capacidad y no
    un `kind`: una lista exporta desde hoy y una coleccion no hasta que exista
    `GET /collections/:id/export`. Ponerlo como capacidad hace que la fila no
    aparezca en vez de aparecer y fallar al tocarla.
  */
  export: {
    id: "export",
    labelKey: "export.list.title",
    icon: "download-outline",
    disponible: (ctx) => ctx.caps.export === true,
    destino: { tipo: "pagina", page: "export" },
  },

  /*
    Borrar, y la unica accion destructiva del registro.

    El copy va en `labelKey` **y** el motivo en `motivo`, porque son dos
    preguntas: "que dice la fila" y "por que no puedo tocarla". Con
    `shared: true` la fila dice que no se puede y la razon va en `motivo`, que
    es lo que la hoja pinta en `SheetOption.description` —el unico sitio donde
    cabe, porque `SheetOption` no tiene campo de motivo y `sheet.tsx` no se toca
    en este trabajo.

    Y `motivo` devuelve `null` cuando si se puede, no una cadena vacia: `null` es
    "no hay motivo" y "" es un motivo que no explica nada.

    ------------------------------------------------------------------
    POR QUE BORRAR ES `pagina` Y NO `hoja`
    ------------------------------------------------------------------

    Porque es la unica accion del registro que **escribe y no se puede deshacer**,
    y "no se puede deshacer" en la app significa siempre lo mismo: una pantalla
    que pregunta. Las ocho hojas lo vienen haciendo asi —`CollectionMenuSheet` lo
    tenia como `Paso = "menu" | "rename" | "delete"`, y `list-menu-sheet` tiene su
    pagina— y declararlo `hoja` hacia que `destino: { tipo: "hoja", handler:
    "borrar" }` significara "tocar la fila borra". Eso no es una fila sin
    confirmacion: es un toque que tira trabajo de otra gente.

    Estuvo declarado asi y lo corrigio `EntityMenuSheet` con un caso especial
    mientras ninguna otra tarea lo usaba. **Un trabajo destructivo no puede
    quedar en un parche local**: el parche esta en un archivo y el registro se
    consume en nueve, y T4 a T10 no heredan el parche porque no se copian
    codigos: leen el registro. Ademas `MenuPageId` declaraba `"delete"` sin que
    ninguna accion lo apuntara, que es el sintoma de un destino mal escrito.

    El `handler: "borrar"` no desaparece del contrato: lo llama `DeletePage` desde
    adentro de la pagina, que es lo que el comentario de `MenuHandlerName` dice
    ahora con otras palabras.
  */
  delete: {
    id: "delete",
    labelKey: (ctx) => {
      if (ctx.entity.shared) return "common.deleteNotYours";
      return ctx.kind === "note" ? "note.delete" : "common.delete";
    },
    icon: "trash-outline",
    tone: "danger",
    disponible: (ctx) => !ctx.entity.shared,
    motivo: (ctx) => (ctx.entity.shared ? "common.deleteNotYoursHint" : null),
    destino: { tipo: "pagina", page: "delete" },
  },
};

/**
 * El orden canonico, por kind. **El unico lugar donde vive el orden.**
 *
 * Anadir una opcion a las cinco entidades es agregar una entrada a `ACCIONES` y
 * una al orden de cada kind. No es editar cinco hojas, que es como se hacia.
 *
 * Borrar va ultimo en los cinco, y por el motivo de siempre: es lo unico que no
 * se deshace volviendo a abrir el menu.
 *
 * **Ningun kind declara `icon` o `share` sin poder cumplirlas.** Los cinco ordenes
 * estan escritos uno por uno y no por combinacion, porque lo que decide es que el
 * conjunto de cada uno es el que el contrato y la app pueden cumplir hoy:
 *
 * - `note` **no declara `pin`**: `note/[noteId].tsx` no tiene `isPinned`, ni
 *   `onTogglePin`, ni una entrada de pinear. Las notas no se pinean al panel.
 * - `collection` **no declara `icon`**: su campo es `emoji`, una cadena
 *   (ver `CON_ICON_REF`).
 * - `collection` y `bookmark` **no declaran `share`**: el enum del contrato no
 *   los admite (ver `COMPARTIBLE`).
 * - `bookmark` **no declara `icon`**: no tiene campo (ver `CON_ICON_REF`).
 */
export const ORDEN_POR_KIND: Record<MenuKind, string[]> = {
  list: [
    "states",
    "rename",
    "icon",
    "pin",
    "duplicate",
    "share",
    "access",
    "export",
    "delete",
  ],
  note: ["rename", "icon", "share", "saveAsTemplate", "access", "delete"],
  folder: ["createHere", "pin", "rename", "icon", "share", "access", "delete"],
  collection: ["rename", "access", "export", "delete"],
  bookmark: ["rename", "access", "delete"],
};

/** La clave de i18n de una accion, resuelta para un contexto concreto. */
export function resuelveLabel(accion: MenuAccion, ctx: MenuContext): TranslationKey {
  return typeof accion.labelKey === "function" ? accion.labelKey(ctx) : accion.labelKey;
}

/**
 * Las acciones que se pintan para este contexto, **en el orden del registro**.
 *
 * Filtra por `disponible` con una distincion: una accion que no se puede **y no
 * explica por que** no se ofrece (le falta la capacidad), y una que no se puede
 * **y si lo explica** se queda en la lista para que la hoja la dibuje grisada
 * con el motivo en `description`. Es la diferencia entre una opcion que no
 * existe y una opcion que existe y no es tuya, y la segunda tiene que verse.
 *
 * Si un id del orden no estuviera en `ACCIONES` —un bug de escritura— lo
 * descarta en vez de devolverlo: pintar un `undefined` revienta la hoja, y el
 * test de paridad ya falla antes por el mismo bug y con un mensaje que nombra el
 * id que falta.
 */
export function accionesPara(ctx: MenuContext): MenuAccion[] {
  return ORDEN_POR_KIND[ctx.kind]
    .map((id) => ACCIONES[id])
    .filter((accion): accion is MenuAccion => {
      if (!accion) return false;
      if (accion.disponible?.(ctx) !== false) return true;
      return accion.motivo !== undefined;
    });
}

/**
 * Si dos acciones son la misma fila para quien las mira.
 *
 * Por el `labelKey` **resuelto** y el icono, y no por el id: el id es interno
 * del registro y lo que hay que preservar al migrar una hoja es la fila que esa
 * hoja dibujaba. Por eso resuelve con un `ctx`: sin el, dos `labelKey` que son
 * funciones—"cuando es nota" y "cuando es una lista"— se compararian por
 * identidad de funcion y darian que no son la misma fila cuando son la misma.
 */
export function esDuplicada(
  a: MenuAccion,
  b: MenuAccion,
  ctx: MenuContext,
): boolean {
  return resuelveLabel(a, ctx) === resuelveLabel(b, ctx) && a.icon === b.icon;
}