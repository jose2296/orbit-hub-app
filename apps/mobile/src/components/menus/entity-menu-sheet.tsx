import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import type { IconRef, ListKind } from "@orbit-hub/contracts";

import { ExportResultSheet } from "@/components/export/export-result-sheet";
import { ShareFormContexto, type ShareFormPublicado } from "@/components/shares/share-form-publicado";
import { Button } from "@/components/ui/button";
import { Sheet, SheetOptions, useLastValue } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useExport } from "@/hooks/use-export";
import type { ExportRequest } from "@/hooks/use-export";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { accionesPara, resuelveLabel, ACCIONES } from "@/lib/menus/registry";
import { puedeOfrecerse } from "@/lib/menus/paginas";
import type { MenuContext, MenuHandlerName, MenuPageId } from "@/lib/menus/registry";
import { useTheme } from "@/theme";

import { AccessPage } from "./pages/access-page";
import { CreatePage } from "./pages/create-page";
import { DeletePage } from "./pages/delete-page";
import { ExportPage } from "./pages/export-page";
import { IconPage } from "./pages/icon-page";
import { RenamePage } from "./pages/rename-page";
import { SharePage } from "./pages/share-page";

/**
 * Lo que el call site sabe hacer con esta entidad.
 *
 * Todo opcional y **a proposito**: el registro decide que filas se ofrecen
 * leyendo `role`, `shared` y `caps`, asi que un handler que falta no es una fila
 * que se esconde —eso lo decide el registro— sino una fila que se ofrece y no
 * tiene a quien ejecutarla, que es un fallo de desarrollo.
 */
export interface MenuHandlers {
  rename?: (title: string) => void | Promise<void>;
  icon?: (icon: IconRef | null) => void | Promise<void>;
  borrar?: () => void | Promise<void>;
  duplicar?: () => void | Promise<void>;
  alternarPin?: () => void | Promise<void>;
  editarEstados?: () => void | Promise<void>;
  guardarComoPlantilla?: () => void | Promise<void>;
  clasificar?: () => void | Promise<void>;
  /*
    ------------------------------------------------------------------
    `crearDentro`, Y POR QUE NO ES UN `MenuHandlerName`
    ------------------------------------------------------------------

    Porque `ACCIONES.createHere` declara `destino: { tipo: "pagina", page:
    "create" }`: el handler no corre **en la hoja**, se usa **desde adentro** de la
    pagina `create`, igual que `MenuHandlers.borrar` se usa desde adentro de
    `DeletePage`. Los dos estan en esta interfaz y ninguno en el union de
    `registry.tsx`, y por eso este no va ahi: `MenuHandlerName` son las acciones que
    el registro apunta con `destino.tipo === "hoja"`, y `createHere` no es una.

    Y devuelve `void`, no `void | Promise<void>` como las de escritura, porque aqui
    **no se escribe nada**: la pagina elige un tipo y lo devuelve, y quien escribe —
    la hoja de creacion con su campo de nombre— es la pantalla. No hay nada que
    esperar, nada que reintentar y nada que dejar abierto.
  */
  crearDentro?: (kind: ListKind) => void;
}

export interface EntityMenuSheetProps {
  /** La entidad sobre la que se actua, o `null` con el menu cerrado. */
  ctx: MenuContext | null;
  /**
   * El icono que tiene la entidad ahora, **si tiene**.
   *
   * Entra por props y no dentro del `ctx` porque `MenuEntity` no lo trae: el
   * registro normaliza el nombre y nada mas —el comentario de `title` lo dice—
   * y porque el campo de icono no es el mismo en todas: una coleccion guarda un
   * `emoji` que es texto plano y un enlace no tiene campo. Meterlo en el
   * registro seria elegir la forma de una y fingir que las otras son iguales.
   *
   * Opcional por lo mismo: los kinds sin `IconRef` no pasan nada y su fila de
   * icono no se ofrece, que es lo que decide `CON_ICON_REF`.
   */
  icon?: IconRef | null;
  /**
   * Cuantos elementos tiene la lista, **solo para `list`**.
   *
   * El mismo caso que `icon` y por la misma razon: `lists.deleteBody` cuenta y
   * `MenuEntity` no puede llevar el numero —el registro no le pide el numero a
   * nadie, es un dato de la entidad y no una decision de menu—, asi que lo pasa
   * el call site que ya lo tiene a mano. `DeletePage` decide que sin numero no
   * dice nada, en vez de pintar un `{count}` crudo.
   *
   * Por eso el numero no se le agrega a `MenuEntity`: las cinco entidades
   * llevarian un campo y cuatro no lo llenarian, y el registro dejaria de ser el
   * lugar donde vive lo que el menu necesita para decidir **que fila se ofrece**.
   */
  conteo?: number;
  /**
   * Si la entidad **ya esta** en el panel, y por eso el slot `pin` se pinta
   * `unpin`.
   *
   * El registro declara las dos etiquetas porque el copy es distinto y reserva
   * **un solo lugar** en el orden del registro: el estado de "ya esta ahi" lo sabe la
   * pantalla (`isPinned(layout, id)`) y no la entidad, asi que meterlo en el
   * `ctx` seria meter en el contexto un dato de la pantalla.
   *
   * Entra por props y no en el `ctx` por lo mismo que el icono: es de la pantalla
   * y lo decide quien la abre.
   */
  pinned?: boolean;
  /**
   * El subtitulo de la cabecera en la primera pagina, **si esta entidad lo
   * necesita**.
   *
   * Es lo que hace que una lista siga diciendo donde vive —"Peliculas · Films"—:
   * `entity.title` es el nombre, y el nombre no dice la carpeta. Opcional porque
   * las otras cuatro entidades no tienen esa segunda mitad y su subtitulo sale de
   * `SUBTITULO_POR_PAGINA`.
   */
  subtitulo?: string;
  handlers: MenuHandlers;
  onClose: () => void;
}

/** La primera pagina y las de `EntityMenuSheet`. */
type Pagina = "options" | MenuPageId;

/**
 * Que se puede hacer con una entidad, y **solo una lista de filas por hoja**.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTA HOJA NO DECIDE NADA
 * ------------------------------------------------------------------
 *
 * Porque hay ocho hojas de menu escritas a mano y el mismo predicado —"solo el
 * dueno comparte", "lo compartido no se borra"— estaba escrito cuatro veces con
 * cuatro comentarios distintos, y lo que decidia la ultima que se escribio era
 * lo que corria. Esa lista, que es justo lo duplicado, ya vive en
 * `lib/menus/registry.tsx` y aca no se reescribe: se pide `accionesPara(ctx)` y
 * se pinta lo que venga, en el orden en que venga.
 *
 * ------------------------------------------------------------------
 * POR QUE UN `Sheet` CON `step` Y NO SEIS HOJAS HERMANAS
 * ------------------------------------------------------------------
 *
 * Porque `Sheet` ya monta `SheetStep` por su cuenta en cuanto le pasan `step`
 * (`sheet.tsx:174`), o sea que el multi-pagina esta resuelto en la base; y
 * porque `Sheet` es un `Modal`, asi que las seis hojas hermanas de
 * `folder-menu-sheet.tsx` son **`Modal` sobre `Modal`**: dos fondos sobre una
 * pantalla y un toque que llega a la de arriba cerrando la de abajo.
 */
export function EntityMenuSheet({
  ctx: pedido,
  icon,
  conteo,
  pinned,
  subtitulo,
  handlers,
  onClose,
}: EntityMenuSheetProps) {
  // La ultima, y no la del llamador: el llamador la pone a `null` para cerrar y la
  // hoja tiene que seguir pintando mientras baja. `useLastValue` es la razon por
  // la que el menu no desaparece a mitad del gesto de salida.
  const ctx = useLastValue(pedido);

  /*
    ------------------------------------------------------------------
    LOS HANDLERS, CON EL MISMO RELOJ QUE `ctx`
    ------------------------------------------------------------------

    Porque `Sheet` mantiene el `Modal` montado `SALIDA + 90` —330 ms— despues de
    `visible === false` (`sheet.tsx:631`), o sea **por diseno** esa hoja sigue
    visible e interactiva con el `ctx` viejo. Si los handlers no se congelaran con
    el mismo reloj, en esa ventana el call site ya habria devuelto `{}` —que es lo
    que devuelve `handlersDeColeccion(null)`— y un toque en "Eliminar" caeria en
    `sinHandler()`: un "Error inesperado" en una hoja que ya se esta yendo, por un
    toque que llego tarde.

    Y el congelado va **aca y no en cada call site**: que el que tiene que acordarse
    sea el componente es la diferencia entre un menu que aguanta la salida y nueve
    call sites que hay que arreglar cada vez que se abre uno nuevo.
  */
  const abierto = pedido !== null;
  const handlersVivos = useLastValue(abierto ? handlers : null) ?? {};

  /*
    El icono se congela con el mismo reloj, y con un envoltorio porque `null` aca
    es un valor de verdad.

    `useLastValue` guarda lo que no es `null` ni `undefined`, asi que
    `useLastValue(abierto ? icon : null)` devolveria para siempre el icono de la
    entidad anterior en cuanto una entidad no tuviera icono: "sin icono" se
    congela como si fuera "cerrado". El envoltorio es siempre un objeto —con
    `icon` adentro, que si puede valer `null`— y por eso el reloj funciona y el
    valor llega entero.
  */
  const iconoVivo = useLastValue(abierto ? { icon } : null)?.icon ?? null;

  const theme = useTheme();
  const t = useTranslation();

  const [pagina, setPagina] = useState<Pagina>("options");
  const [borrador, setBorrador] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reintento, setReintento] = useState<(() => void) | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  /*
    ------------------------------------------------------------------
    EL CANAL DE COMPARTIR, Y POR QUE EL GUARDAR DEL PIE LO PIDE EL FORMULARIO
    ------------------------------------------------------------------

    El boton de enviar vive en `ShareNodeForm` —que es quien tiene el estado del
    formulario— y el Guardar del pie vive **arriba**, en el `Sheet` que esta misma
    hoja pinta. Un contexto no fluye hacia arriba, asi que el hijo no puede leer
    nada del padre: lo que hace es **publicar** y el padre lo pinta. Es el mismo
    reparto que `ShareNodeSheet` y `note-menu-sheet.tsx:99-112`, y el que
    `share-form-publicado.ts` explica desde antes de que existiera esta pagina.

    Y el estado va **aca** y no en `SharePage` por la misma razon que el borrador
    de renombrar vive en la hoja: entrar y salir de la pagina desmonta el
    formulario con lo escrito ahi, asi que lo que el pie tiene que pintar tiene que
    estar en un sitio que sobreviva a eso. Un `useState` dentro de la pagina se
    pierde con ella.
  */
  const [sharePublicado, setSharePublicado] = useState<ShareFormPublicado | null>(null);
  const shareCanal = useMemo(() => ({ publicar: setSharePublicado }), []);

  const titulo = ctx?.entity.title ?? "";
  const nombre = borrador ?? titulo;

  /*
    Cada apertura arranca en el menu, con el nombre de esta entidad y sin error.

    Y cuelga de **la arista de apertura y no de `ctx`**: `ctx` es
    `useLastValue(pedido)`, que se congela mientras `pedido` es `null` —de eso
    vive—, asi que su identidad solo cambia cuando llega *otra* entidad. Reabrir
    la misma devuelve el mismo objeto y el efecto no correria, y el menu abriria
    en la pagina en la que se lo dejo con el nombre del otro. Es el mismo bug que
    `list-menu-sheet.tsx:184-208` ya fijo por escrito.
  */
  useEffect(() => {
    if (!abierto) return;
    setPagina("options");
    setError(null);
    setReintento(null);
    setTrabajando(false);
    /*
      Y la hoja hermana de resultados se apaga **al abrir el menu**, no al
      cerrarlo —que es lo mismo que hacia la hoja vieja con `setShowing(false)`—.
      Sin esto, un export que se abrio de mas tarde se saltaria encima del menu que
      acaba de abrir otra persona, y dos hojas a la vez sobre una pantalla es justo
      lo que el resto de este archivo existe para que no pase.
    */
    setMostrandoExport(false);
  }, [abierto]);

  /*
    El borrador se vacia **durante el render** y no en el efecto de arriba, y es la
    unica pieza de estado que se vacia ahi.

    Porque el borrador es lo unico de este bloque que alimenta una **pregunta**:
    vaciandolo en un efecto, el calculo de "sucio" de abajo leeria todavia el
    borrador abandonado de la apertura anterior, armaria "¿salir sin guardar?" por un
    texto que ya no existe, y solo el render siguiente lo desarmaria. Un frame de
    una hoja recien abierta preguntando por algo que nadie escribio.

    Un `setState` durante el render es el patron documentado de React para
    ajustar estado a una prop que cambio, y el `useRef` es lo que evita el
    bucle: React descarta la salida de este render y vuelve a renderizar con
    `borrador` ya en `null`, antes de montar nada y antes de correr un solo
    efecto.
  */
  const abiertoAnterior = useRef(abierto);
  if (abierto !== abiertoAnterior.current) {
    abiertoAnterior.current = abierto;
    if (abierto) setBorrador(null);
  }

  /*
    ------------------------------------------------------------------
    EL BORRADOR VIVE ACA; "SUCIO" LO ARMA `RenamePage`
    ------------------------------------------------------------------

    El borrador es de la hoja y no se mueve: entrar en renombrar, escribir y tocar
    ← desmonta la pagina **con el texto escrito todavia ahi**, asi que el texto
    tiene que estar en un sitio que sobreviva a eso, y ese sitio es este estado.

    Y `sucio` se **deriva** de el —en `RenamePage`—, no al reves. Lo que cambio
    en esta ronda no es donde vive la verdad sino **quien la escribe**: antes lo
    hacia esta hoja, con

        const { setSucio } = useSheetSucio();

    y eso era un no-op silencioso. `SheetSucioContexto.Provider` esta **dentro**
    del `<Modal>` de `Sheet` (`sheet.tsx:630`), asi que quien lo consume tiene que
    ser **hijo** de `Sheet`, y esta hoja es su **padre**: leia el contexto por
    defecto —`sucio: false, setSucio: () => {}`— y la red de seguridad de "¿sales
    sin guardar?" no estaba conectada a nada. El sintoma es el peor posible: el
    menu renombra, se cierra, y el nombre escrito se pierde sin preguntar, y
    ningun test lo ve porque `setSucio` no hace nada y por lo tanto **no falla**.

    La derivacion va en la pagina porque la pagina es hija de `Sheet` y ahi si
    llega —es el mismo reparto que ya hacen `rename-sheet.tsx` y
    `share-node-sheet.tsx`, y el mismo que `index.tsx` y `reorder-sheet.tsx`
    resuelven con un componente que no pinta nada—. El contexto no fluye hacia
    arriba, y un contexto que no llega no es un contexto.

    ------------------------------------------------------------------
    Y POR QUE ESTA HOJA NO PUEDE SEGUIR DERIVANDOLO
    ------------------------------------------------------------------

    Porque cualquier `setSucio` aca vuelve a escribir en el contexto por defecto
    y el bug regresa sin que nada se rompa. Lo que se le pasa a la pagina son los
    dos datos de los que se deriva —`borrador` y `titulo`— y la decision la toma
    alla. Un guard de `entity-menu-sheet.test.ts` afirma las dos mitades.

    Y por eso `borrador` es `string | null` y no `string`: `null` es "todavia no se
    escribio nada" —el menu recien abierto— y `""` es "se borro el campo a mano".
    Con un solo string, un menu recien abierto arrancaba con `""` contra un titulo
    no vacio y por lo tanto ya "sucio" antes de que nadie tocara nada.

    Y la condicion **no mira en que pagina estamos**: el borrador sobrevive a la
    flecha, asi que la pregunta tiene que sobrevivir tambien. Si dijera
    `pagina === "rename"`, volver con ← desarmaria la pregunta con el texto
    escrito ahi, que es el bug.
  */

  /*
    ------------------------------------------------------------------
    LA REGLA DE ERROR, Y POR QUE ESTA ACA
    ------------------------------------------------------------------

    Un handler que lanza o rechaza **no cierra el menu**. La hoja se queda, el
    error se muestra y hay un `common.retry` que corre **la misma llamada otra
    vez**, no una parecida: un reintento que rehace el pedido con otra cosa no es
    un reintento.

    Y cerrar va *despues* del `await`, no antes. Las hojas viejas hacen
    `onClose(); void hacer();` —el panel se va y el trabajo sigue detras—, que
    esta bien para pinear o duplicar y esta **muy mal** para lo que escribe: si
    el renombrar falla, no hay donde mostrar nada y la persona se queda creyendo
    que guardo. Es la Review Focus #2.

    Y de los dos corredores de abajo solo uno cierra: `correr` es el de las
    acciones que terminan el menu, y `correrEnLaPagina` el de las que se quedan.
    Lo que se comparte —el mensaje y el reintento— esta en `fallar`, para que la
    parte que decide si el menu se va no arrastre la que decide como se avisa.
  */
  /**
   * Que se avisa cuando algo fallo, y **una sola vez para todas las acciones**.
   *
   * Vive aca y no dentro de cada `catch` porque hay dos corredores —el que cierra
   * y el que deja la hoja abierta— y el que decide si la persona se queda con el
   * menu abierto o sin el, nunca es el que escribe el error ni el que arma el
   * reintento. Si cada corredor trajera su propio `catch`, el mensaje y el
   * `common.retry` serian dos implementaciones que se pueden desincronizar, y la
   * que se desincroniza es la que nadie prueba.
   */
  const fallar = (problema: unknown, otraVez: () => void) => {
    setError(problema instanceof Error ? problema.message : t("errors.unknown"));
    // El `(() => ...)` es necesario: sin el, React toma la funcion como el
    // updater del estado y guarda otra cosa.
    setReintento(() => otraVez);
  };

  /** Una accion que **termina el menu**: pinear, duplicar, renombrar, borrar. */
  const correr = async (hecho: () => void | Promise<void>, otraVez: () => void) => {
    if (trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      await hecho();
      onClose();
    } catch (problema) {
      fallar(problema, otraVez);
    } finally {
      setTrabajando(false);
    }
  };

  /**
   * Una escritura que **deja el menu abierto**, que es la regla de la pagina de
   * icono y no la de las acciones de hoja.
   *
   * No es un `correr` con un parametro porque la diferencia no es de timing sino
   * de contrato: una accion de hoja termina el menu cuando va bien, y elegir un
   * icono no —se elige, se cambia de color, se quita y se vuelve a poner, y con
   * el menu cerrandose en cada celda habria que reabrirlo para cada intento—. Lo
   * que **si** es el mismo esta en `fallar`, y por eso el error y el reintento se
   * escribieron una vez sola.
   *
   * Y mantiene el `if (trabajando) return`: dos celdas tocadas seguidas con una
   * escritura todavia en vuelo, la segunda no corre. Es lo que hacen las cuatro
   * hojas que esta pagina reemplaza —`note-menu-sheet.tsx:181` es el
   * `if (!note || busy) return` de esta misma regla—, y lo que hace que esa
   * segunda se vea en vez de desaparecer es que `IconPage` recibe `trabajando` y
   * deja el panel sin toques mientras dura la primera.
   *
   * Lo que **no** hay es una recuperacion para esa segunda celda, y no se
   * promete: el `common.retry` es del error, y cuando la escritura va bien no hay
   * error que reintentar. Perder un toque que llega durante una escritura que si
   * funciono es lo correcto —queria decir "cambiar a este", y ese cambio ya se
   * guardo—. Durante una que fallo, en cambio, se ve: el error queda con su boton
   * y `otraVez` repite la llamada exacta.
   */
  const correrEnLaPagina = async (hecho: () => void | Promise<void>, otraVez: () => void) => {
    if (trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      await hecho();
    } catch (problema) {
      fallar(problema, otraVez);
    } finally {
      setTrabajando(false);
    }
  };

  /**
   * El handler de una accion de hoja, **o `null` si no llego**.
   *
   * `null` es un fallo de desarrollo y no un caso de quien esta usando la app:
   * el registro ofrece la fila porque el `ctx` dice que puede, asi que un handler
   * ausente es un call site que se olvido de pasarlo. Se muestra el error y se
   * deja el menu abierto —para que se note— en vez de fingir que la fila no
   * hace nada.
   */
  const handlerDe = (nombre: MenuHandlerName): (() => void | Promise<void>) | null => {
    const handler = handlersVivos[nombre];

    return handler ? () => handler() : null;
  };

  /** El aviso de un handler que no llego, y nada de reintentar. */
  const sinHandler = () => {
    setError(t("errors.unknown"));
    // Sin `Reintentar`: repetir algo que no se puede hacer no es un reintento,
    // es un error con un boton encima.
    setReintento(null);
  };

  const correrHoja = (handler: MenuHandlerName) => {
    const otraVez = () => correrHoja(handler);
    const hecho = handlerDe(handler);

    if (!hecho) {
      sinHandler();
      return;
    }
    void correr(hecho, otraVez);
  };

  const renombrar = (tituloNuevo: string) => {
    const otraVez = () => renombrar(tituloNuevo);
    const handler = handlersVivos.rename;

    if (!handler) {
      sinHandler();
      return;
    }
    void correr(() => handler(tituloNuevo), otraVez);
  };

  const borrar = () => {
    const otraVez = () => borrar();
    const hecho = handlerDe("borrar");

    if (!hecho) {
      sinHandler();
      return;
    }
    void correr(hecho, otraVez);
  };

  /**
   * Poner el icono, y **el `null` pasa de largo**.
   *
   * El `null` no es "no me llego nada": es lo que dice "sin icono", y lo manda la
   * fila `icon-cell-none` del selector (`icon-picker-sheet.tsx:499`). Si esta
   * funcion lo filtrara por verdadismo, quitar el icono desde el menu dejaria de
   * existir sin ningun error en ninguna parte —la fila desaparece, el handler
   * nunca corre— y por eso el `icon` va al handler tal cual.
   *
   * Y corre con `correrEnLaPagina` y no con `correr` porque elegir un icono no
   * termina el menu: el panel sigue abierto para probar otro, cambiar el color o
   * quitarlo. El error se muestra igual, con su reintento, porque va por el
   * `fallar` que los dos corredores comparten.
   */
  const ponerIcono = (icon: IconRef | null) => {
    const otraVez = () => ponerIcono(icon);
    const handler = handlersVivos.icon;

    if (!handler) {
      sinHandler();
      return;
    }
    void correrEnLaPagina(() => handler(icon), otraVez);
  };

  /*
    ------------------------------------------------------------------
    PONER UNA LISTA ADENTRO, Y POR QUE NO ES UN CORREDOR
    ------------------------------------------------------------------

    Delegar y listo. La hoja vieja llamaba `onCreateInside(kind)` desde el `Sheet` de
    los tipos y no cerraba nada: el menu se iba porque la pantalla que lo abrio abria
    su propia hoja de creacion con el tipo ya puesto, y esa pantalla es la que sabe
    donde va la lista nueva.

    Por eso esta pagina **no cierra el menu** y por eso no usa `correr` ni
    `correrEnLaPagina`: los dos corredores son para escrituras —esperan, avisan el
    fallo sin cerrar y cierran o dejan abierta segun la accion—, y aqui no hay
    escritura. La decision de si el menu se va la toma el call site, y es suya porque
    el `kind` es lo unico que la pagina le devuelve.

    Y lo que si hay es el `sinHandler()`, con la misma razon que en el resto: la fila
    se ofrece porque el `ctx` dice que puede, asi que un handler ausente es un call
    site que se olvido de pasarlo. Se avisa y el menu se queda abierto, para que se
    note; una fila que al tocarse no hace nada en silencio es peor que una fila que
    no esta.
  */
  const crearDentro = (kind: ListKind) => {
    const handler = handlersVivos.crearDentro;

    if (!handler) {
      sinHandler();
      return;
    }

    handler(kind);
  };

  /*
    ------------------------------------------------------------------
    EXPORTAR, Y POR QUE EL RESULTADO NO ES UNA PAGINA DE ESTA HOJA
    ------------------------------------------------------------------

    Elegir el formato **si** es una pagina de esta hoja, como renombrar o
    compartir: son dos filas y contestan en el momento. Reportar el resultado no,
    y esa es la unica excepcion del archivo, y no es una preferencia: la respuesta
    llega segundos despues —o no llega nunca— y para entonces la pagina que eligio
    el formato ya esta desmontada. `ExportResultSheet` va por eso **hermana** de
    este `Sheet`, no dentro: dos `Modal` sobre una pantalla son dos fondos y un
    toque que llega al de arriba cerrando el de abajo, que es exactamente el
    argumento que la cabecera de esta hoja hace contra las seis hojas hermanas de
    la carpeta vieja.

    Y el estado vive aca y no en la pagina por la misma razon que el borrador de
    renombrar y que el canal de compartir: entrar y salir de la pagina desmonta lo
    que hay ahi, y lo que la hoja hermana tiene que pintar —el intento que se
    acaba de resolver y el `ExportRequest` para reenviarlo igual— tiene que
    sobrevivir a eso.
  */
  const { running: exportando, error: errorDeExport, result: resultado, run: correrExport } =
    useExport();

  /*
    El pedido del intento en curso, **en un `ref` y no en estado**.

    Es la misma regla que el `exporting` de la hoja vieja y por la misma razon: el
    reintento tiene que ser **la misma peticion** —misma ruta, mismo formato, mismo
    titulo, mismo `fallbackId`—, y un pedido guardado en estado se reconstruye en
    cada pulsacion. Reconstruido despues de un renombrar seria otro nombre de
    fichero, y pasado por un formato distinto seria el otro formato: las dos cosas
    son "reintentar" de palabra y son otra exportacion en los hechos.
  */
  const pedidoDeExport = useRef<ExportRequest | null>(null);

  /*
    Si hay algo en vuelo, **en un `ref`**.

    Las dos filas de formato se quedan en pantalla —y se quedan pulsables— durante
    los 330 ms que esta hoja tarda en irse, y en una pantalla ancha donde el panel
    solo se desvanece un segundo toque cae en la misma fila. Eso es una segunda
    descarga del mismo contenido y, en un movil, un panel de compartir encima del
    otro. Un `ref` se lee cuando ocurre la pulsacion y no cuando se construyo el
    manejador, que es justo lo que hace falta: el manejador lo lleva el render con
    el que se pinto la hoja, y ese render ya tenia `exportando === false`.
  */
  const exportandoAhora = useRef(false);

  /*
    Si la hoja hermana de resultados esta levantada, y **lo que lleva no es estado
    propio**: lo que se guarda es "el intento se ha resuelto", porque ese es el
    momento en que el fichero ya esta en disco. Abrir en la pulsacion pondria un
    panel en pantalla sin nada que decir durante los segundos que tarda un fichero
    grande, y el error vive en `useExport`, que se limpia al empezar el intento.
  */
  const [mostrandoExport, setMostrandoExport] = useState(false);

  /**
   * Exportar, y **el menu se va antes de que salga el peticion**.
   *
   * Es lo que garantiza que las dos hojas no coexistan como dos fondos: `onClose`
   * corre primero y el `Sheet` de esta hoja baja entero mientras el fichero baja.
   * Al revés —exportar y cerrar al final— dejaria el panel de formatos abierto
   * encima de una hoja hermana que ya esta respondiendo, que es el caso que la
   * hoja vieja documentaba y que hoy no puede ocurrir.
   *
   * Y el `finally` sube la hoja hermana **tambien** cuando el intento fallo: un
   * fallo que nadie ve es un bug y no un diseno, y `ExportResultSheet` es la unica
   * pieza de la app que puede decir por que no hay fichero.
   */
  const exportar = async (args: ExportRequest) => {
    if (exportandoAhora.current) return;
    exportandoAhora.current = true;
    pedidoDeExport.current = args;

    onClose();
    try {
      await correrExport(args);
    } finally {
      exportandoAhora.current = false;
      setMostrandoExport(true);
    }
  };

  /**
   * La misma peticion otra vez, y **el mismo objeto**.
   *
   * Se reenvia `pedidoDeExport.current` y no se reconstruye: reconstruirlo cogeria
   * el titulo de ahora, que tras un renombrar es el nombre de otro fichero, y
   * elegir el formato de nuevo seria elegir el que aparece primero en la lista, no
   * el que fallo. Es la misma regla de reintento que el `otraVez` del resto de la
   * hoja, con la diferencia de que aqui lo que se repite es una peticion y no una
   * funcion.
   */
  const reintentarExport = () => {
    const anterior = pedidoDeExport.current;
    if (!anterior) return;
    void exportar(anterior);
  };

  if (!ctx) return null;

  /*
    `puedeOfrecerse` viene de `lib/menus/paginas` y no de mas abajo: el filtro dice
    que filas se ofrecen, y si viviera aca no se podria importar en ningun test
    —esta hoja arrastra `IconPage` y de ahi `@expo/vector-icons`, que en Node no se
    parsea—, con lo que lo unico que se podia hacer era reescribirlo a mano en el
    test y esperar a que divergiera. Que la lista de paginas montadas este en un
    archivo sin React es lo que hace que esto sea un filtro y no una copia.
  */
  const opciones: SheetOption[] = accionesPara(ctx)
    .filter(puedeOfrecerse)
    .map((declarada) => {
      /*
        ------------------------------------------------------------------
        EL SLOT `pin`, Y POR QUE ACA SE ELIGE UNA DE LAS DOS
        ------------------------------------------------------------------

        `pin` y `unpin` son **una fila en dos estados**, y el registro los declara
        a los dos con un solo lugar en el orden: el estado de "ya esta en el
        panel" no lo sabe el `ctx` sino la pantalla, y por eso viaja en la prop
        `pinned`.

        Lo que se hace aca es **leer el registro y no escribir una fila**: se toma
        el descriptor que el registro declaro para el otro estado. Si el registro
        dejara de declarar `unpin`, `ACCIONES.unpin` seria `undefined` y la hoja
        reventaria en el primer render; por eso el `?? declarada`, que es peor que
        la fila que falta pero no es una pantalla rota.
      */
      const pineada = ACCIONES.pin?.id === declarada.id && pinned === true;
      const accion = pineada ? (ACCIONES.unpin ?? declarada) : declarada;
      const etiqueta = resuelveLabel(accion, ctx);
      /*
        El motivo va a `description` porque `SheetOption` no tiene campo de motivo
        (`sheet.tsx:1098`) y esta base no se toca en este trabajo. Y va con
        `disabled` puesto: son las dos caras de la misma regla, y sin el
        `disabled` la fila diria "no lo puedes eliminar" con el boton vivo.
      */
      const motivo = accion.motivo?.(ctx) ?? null;

      return {
        key: accion.id,
        /*
          Con `{ name }` siempre, aunque hoy ninguna etiqueta de fila lo use. Es
          lo que hace que `share.title` —"Compartir {name}"— entre sin un segundo
          formato por accion, y lo que evita que la proxima etiqueta con un hueco
          salga con el `{name}` crudo en pantalla.
        */
        label: t(etiqueta, { name: ctx.entity.title }),
        icon: accion.icon,
        tone: accion.tone ?? "default",
        /*
          El galon va **solo en las filas que llevan a otro lado**, y esa es la
          unica senal de que la fila no hace la cosa al toque: "Eliminar" abre una
          pantalla que pregunta y "Pinear en el panel" hace la cosa, y sin galon
          las dos se ven igual. La fila que borra en el momento tiene que **dirse**
          antes de apretarla, no despues.

          Y va con la fila apagada tambien: la fila grisada sigue siendo una puerta
          —esta cerrada—, y `description` dice por que.
        */
        chevron: accion.destino.tipo === "pagina",
        description: motivo ? t(motivo) : undefined,
        disabled: accion.disponible?.(ctx) === false,
        onPress: () => {
          /*
            El destino se lee tal cual lo declaro el registro, sin excepciones: si
            dice `pagina`, se empuja esa pagina; si dice `hoja`, corre el handler.
            Borrar entra por la primera rama —es una pagina, la que pregunta— y
            por eso no hay ningun caso especial que pueda quedar viejo cuando el
            registro cambie.
          */
          if (accion.destino.tipo === "pagina") {
            setError(null);
            setReintento(null);
            setPagina(accion.destino.page);
            return;
          }
          correrHoja(accion.destino.handler);
        },
      };
    });

  /*
    El subtitulo de la cabecera, y **las dos mitades estan en el mismo lugar**.

    La tabla gana cuando tiene entrada, y son las paginas que el registro conoce:
    una lista no dice nada en su pagina de renombrar y si su tipo y su carpeta en la
    primera. La prop `subtitulo` llena solo ese hueco, y llega **ya resuelta** —la
    lista concatena el tipo y el nombre de la carpeta antes de pasarlo—, asi que
    pasa por `t` solo cuando lo que hay es una clave. Un `t()` sobre un texto ya
    traducido imprimiria la frase con las llaves puesta.
  */
  /*
    ------------------------------------------------------------------
    EL GUARDAR DEL PIE, Y POR QUE ES **DE UNA PAGINA A LA VEZ**
    ------------------------------------------------------------------

    El pie es del `Sheet`, que es de toda la hoja: hay **un solo** Guardar y cinco
    paginas, asi que la pregunta es de quien es. Aca es de la de compartir y solo
    mientras estamos en ella, y el corte lo hace `pagina === "share"` y no el
    estado del formulario.

    Por que no alcanza con `sharePublicado` a secas, que ya es `null` cuando el
    formulario no esta montado: porque ese `null` lo produce el **cleanup** del
    efecto del hijo, o sea que la hoja estaria heredando de la pagina una decision
    que es de ella. Hoy coincide, y el que llegue en T9 con un formulario que
    limpia distinto encontraria un Guardar en una pagina sin formulario —"Guardar"
    que no hace nada, que es decoracion— sin que nada se rompiera. El corte por
    pagina no depende de que la pagina sea educada.

    Y las tres props van juntas por el mismo corte, porque son la misma pregunta:
    que dice el boton, cuando esta apagado y por que. `saveLabel` va con
    `share.send` —"Compartir"— y no con el `common.save` por defecto, porque el
    boton **manda un correo**: "Guardar" en un formulario que escribe el grant de
    otra persona es la palabra equivocada, y el error sale en el correo de la otra
    persona.

    ------------------------------------------------------------------
    Y POR QUE RENOMBRAR NO COMPITE POR EL PIE
    ------------------------------------------------------------------

    Porque `RenamePage` **no usa** el Guardar del pie: tiene su boton adentro, y es
    una decision escrita (`rename-page.tsx:54-63`). El `onSave` del `Sheet` se apaga
    solo cuando su promesa resuelve, y `onSave` no puede rechazar sin dejar una
    promesa sin manejar, asi que un renombrar que falla por ahi apagaria la pregunta
    de "salir sin guardar" y el nombre escrito se iria sin avisar.

    O sea que hoy las dos mitades no se pisan por casualidad sino porque **solo
    compartir publica**. Cuando otra pagina quiera el pie, el corte por `pagina` es
    lo que las separa, y por eso el corte esta escrito en la hoja y no se deja que
    el ultimo `onSave` que se escriba gane.
  */
  const enCompartir = pagina === "share";

  const claveDeSubtitulo = SUBTITULO_POR_PAGINA[pagina];
  const subtituloDeCabecera = claveDeSubtitulo ? t(claveDeSubtitulo, { name: titulo }) : subtitulo;

  /*
    El `Provider` envuelve **el `Sheet` entero**, no solo el contenido, y por la
    misma razon que en `ShareNodeSheet` y `note-menu-sheet.tsx`: el canal tiene que
    estar por encima del formulario que lo usa, y el formulario se pinta dentro
    del `Sheet`. Que el `Modal` de `Sheet` se dibuje en otra rama del arbol —por
    eso es un portal— no cambia de quien es padre: en React el arbol de nodos y el
    lugar de la pantalla son dos cosas, y el contexto sigue siguiendo al arbol.
  */
  return (
    <>
      <ShareFormContexto.Provider value={shareCanal}>
        <Sheet
          step={pagina}
          visible={pedido !== null}
          onClose={onClose}
          title={ctx.entity.title}
          subtitle={subtituloDeCabecera}
          scrollable={false}
          onBack={pagina === "options" ? undefined : () => setPagina("options")}
          onSave={enCompartir ? sharePublicado?.enviar : undefined}
          saveDisabledReason={enCompartir ? sharePublicado?.motivo : undefined}
          saveLabel={enCompartir ? t("share.send") : undefined}
        >
          <View
            style={{
              gap: theme.spacing.md,
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: theme.spacing.sm,
            }}
          >
            {pagina === "options" ? <SheetOptions options={opciones} /> : null}

            {pagina === "rename" ? (
              <RenamePage
                nombre={nombre}
                /*
                  Los dos datos de los que se deriva "sucio", y **los dos van por
                  props** porque la pagina no puede leerlos: `borrador` es estado de
                  esta hoja y el `MenuContext` no lo lleva —el registro no conoce
                  borradores—. El titulo si esta en el `ctx`, asi que la pagina
                  compararia contra lo que se le pasa y no contra el `ctx` entero.
                */
                borrador={borrador}
                titulo={titulo}
                onChange={setBorrador}
                onRename={() => {
                  if (nombre.trim().length === 0 || trabajando) return;
                  renombrar(nombre.trim());
                }}
                trabajando={trabajando}
              />
            ) : null}

            {pagina === "delete" ? (
              // El `conteo` lo pasa el call site y solo una lista lo tiene: las otras
              // cuatro no llenan el campo, y `DeletePage` ya sabe que sin numero no
              // dice nada en vez de pintar un `{count}` crudo en pantalla.
              <DeletePage ctx={ctx} onBorrar={borrar} trabajando={trabajando} conteo={conteo} />
            ) : null}

            {/*
              Compartir, y **la fila vuelve a existir con esto**.

              `ACCIONES.share` declara `destino: { tipo: "pagina", page: "share" }` desde
              la T1 y la hoja lo filtra con `puedeOfrecerse` mientras su pagina no exista:
              sin este bloque, compartir una lista deja de estar en el menu, que es
              exactamente lo que paso con la hoja de lista cuando paso al registro.

              Y el `onClose` es el de la hoja, no uno de la pagina: al enviar bien se
              cierra **el menu entero**. La hoja vieja hacia lo mismo —`onDone={() =>
              onClose()}`— y la razon esta en `SharePage`: el estado del formulario se
              pierde al desmontar, asi que "quedarse para mandar a otro" no es una
              opcion que exista.
            */}
            {pagina === "share" ? <SharePage ctx={ctx} onClose={onClose} /> : null}
            {pagina === "access" ? (
              <AccessPage ctx={ctx} />
            ) : null}

            {/*
              El icono se escribe al elegir y la hoja **no** se cierra: el panel
              sigue abierto para cambiar de opinion, y el error —si el handler
              falla— se muestra mas abajo, con su reintento, igual que en las otras
              paginas. Por eso esta recibe `onSelect` y no un boton de guardar: en el
              registro, `icon` es una pagina que se entra, no una fila que dispara una
              cosa y se va.

              Y por eso recibe `trabajando`: es lo que apaga el panel mientras se
              escribe, que sin el el grid entero sigue tappable y el segundo toque se
              pierde sin decir nada.
            */}
            {pagina === "icon" ? (
              <IconPage icon={iconoVivo} onSelect={ponerIcono} trabajando={trabajando} />
            ) : null}

            {/*
              Poner una lista **adentro**, y la fila vuelve a existir con esto.

              `ACCIONES.createHere` declara `destino: { tipo: "pagina", page: "create" }`
              desde la T1 y `ORDEN_POR_KIND.folder` la lista para la carpeta. Sin este
              bloque el filtro la saca entera y **crear una lista dentro de una carpeta
              deja de existir**, que es lo que hacia la hoja vieja con `onCreateInside`.

              Y el `onSelect` es el `crearDentro` de la hoja —el handler congelado, no
              el de las props—, por la misma razon que `ponerIcono`: durante los 330 ms
              de la salida el call site ya devolvio `{}` y un toque que llega tarde no
              puede caer en un handler vivo. Y **no** es `correr` ni `correrEnLaPagina`
              porque elegir el tipo no escribe: la pagina devuelve el `kind` y el call
              site decide, que es lo que hacia la hoja vieja.
            */}
            {pagina === "create" ? <CreatePage onSelect={crearDentro} /> : null}

            {/*
              Exportar, y **la fila vuelve a existir con esto**.

              `ACCIONES.export` declara `destino: { tipo: "pagina", page: "export" }`
              desde la T1 y `ORDEN_POR_KIND` la lista para lista y coleccion. Sin este
              bloque el filtro la saca entera y **exportar una lista deja de
              existir**, que es exactamente lo que paso con la hoja de lista cuando
              paso al registro en la T6, y nadie lo noto porque "una fila que no esta"
              y "una fila que todavia no se escribio" se ven igual desde el menu.

              La pagina **no** lleva `onClose` y no decide nada del intento: elige un
              formato y lo devuelve. Quien corre la peticion, quien cierra el menu
              antes de correrla y quien levanta la hoja hermana al terminar es esta
              hoja, y el por que esta escrito en `exportar`.
            */}
            {pagina === "export" ? (
              <ExportPage ctx={ctx} running={exportando} onExport={exportar} />
            ) : null}

            {/*
              El fallo, **en la hoja y no en un toast**: un toast se va solo y a la
              pagina de borrar hay que volver a entrar para volver a leerlo. Y el
              reintento va al lado del error, que es donde se lo busca.
            */}
            {error ? (
              <View style={{ gap: theme.spacing.sm }}>
                <AppText variant="caption" style={{ color: theme.colors.danger }}>
                  {error}
                </AppText>
                {reintento ? (
                  <Button
                    label={t("common.retry")}
                    variant="secondary"
                    fullWidth
                    onPress={() => reintento()}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        </Sheet>
      </ShareFormContexto.Provider>

      {/*
        ------------------------------------------------------------------
        LA HOJA HERMANA DEL RESULTADO, Y POR QUE ESTA AFUERA DEL `Sheet`
        ------------------------------------------------------------------

        Es la unica hoja hermana que este archivo monta, y no es una excepcion al
        argumento del principio —una hoja encima de otra son dos fondos— sino lo
        contrario: **esta no se abre mientras la otra esta**. Reportar el resultado
        llega cuando el fichero ya esta, y para entonces esta hoja ya se fue; lo
        unico que se cruza son los 330 ms en que el `Modal` del menu sigue montado,
        y eso lo garantiza una sola cosa: `exportar` llama a `onClose()` antes de
        que salga el peticion. Es la misma regla que la hoja vieja de lista
        aplicaba y escribia—"dos paneles, y uno de ellos a la vez como regla, no
        como garantia"—, y la garantia era el mismo `onClose()` antes de `run`.

        Montada **dentro** del `Sheet` —o como pagina— seria un `Modal` dentro de un
        `Modal`: dos fondos y un toque que cierra el de abajo. Por eso el guard de
        `entity-menu-sheet.test.ts` sigue contando un `Sheet` aqui, y por eso esta
        hoja no la monta la pagina: `ExportPage` elige un formato y nada mas.

        Y el `title` sale del **pedido**, no del `ctx` de pantalla: si el intento se
        resolviera con otra entidad delante —se compartio el enlace, el titulo
        cambio— un titulo leido del `ctx` seria el nombre equivocado sobre los
        numeros correctos.
      */}
      <ExportResultSheet
        attempt={
          mostrandoExport
            ? { result: resultado, error: errorDeExport, onRetry: reintentarExport }
            : null
        }
        title={pedidoDeExport.current?.title}
        onClose={() => setMostrandoExport(false)}
      />
    </>
  );
}

/**
 * El subtitulo de la cabecera, y el de la primera pagina es ninguno.
 *
 * `share` esta aca y no sale de `SharePage` porque el subtitulo lo pinta el `Sheet`,
 * que es el padre, y una pagina no puede dictarselo a quien lo contiene. Es el
 * mismo reparto que el borrador de renombrar, del otro lado del arbol.
 *
 * Y el `{ name }` lo pone la hoja para todas, no solo para esta: el titulo de la
 * cabecera ya es el nombre de la entidad y es el unico `{name}` que tiene sentido en
 * cualquier pagina. Una clave sin el hueco lo ignora —`formatTranslation` solo
 * reemplaza lo que encuentra (`dictionaries.ts:2485`)—, asi que el resto no cambia.
 */
const SUBTITULO_POR_PAGINA: Partial<Record<Pagina, TranslationKey>> = {
  rename: "common.rename",
  icon: "icons.title",
  delete: "common.delete",
  share: "share.subtitle",
  /*
    `create` dice "Crear una lista aqui" porque eso es lo que la hoja vieja tenia
    **escrito como titulo** del panel de los tipos, y el titulo de esta hoja es el
    nombre de la entidad —la carpeta—, que no dice de que va el panel. Sin esta
    entrada la cabecera de la pagina sale con el nombre de la carpeta y nada mas, y
    las seis filas de tipos no dicen donde van a parar.
  */
  create: "lists.createHere",
  /*
    `export` dice "Formato" y no el nombre de la entidad: las dos filas de la
    pagina son los dos formatos, y la cabecera ya dice de que se trata con el
    titulo de la hoja —el nombre de la lista o de la coleccion—. La frase de la
    espera (`export.running`) **no** va aqui y la pinta la pagina, porque depende
    de si hay algo en vuelo y esta tabla es de claves fijas.
  */
  export: "export.format",
};

