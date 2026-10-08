import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import type { IconRef } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Sheet, SheetOptions, useLastValue } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { accionesPara, resuelveLabel } from "@/lib/menus/registry";
import { puedeOfrecerse } from "@/lib/menus/paginas";
import type { MenuContext, MenuHandlerName, MenuPageId } from "@/lib/menus/registry";
import { useTheme } from "@/theme";

import { DeletePage } from "./pages/delete-page";
import { IconPage } from "./pages/icon-page";
import { RenamePage } from "./pages/rename-page";

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
export function EntityMenuSheet({ ctx: pedido, icon, handlers, onClose }: EntityMenuSheetProps) {
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
    .map((accion) => {
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

  const subtitulo = SUBTITULO_POR_PAGINA[pagina];

  return (
    <Sheet
      step={pagina}
      visible={pedido !== null}
      onClose={onClose}
      title={ctx.entity.title}
      subtitle={subtitulo ? t(subtitulo) : undefined}
      scrollable={false}
      onBack={pagina === "options" ? undefined : () => setPagina("options")}
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
          <DeletePage ctx={ctx} onBorrar={borrar} trabajando={trabajando} />
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
  );
}

/** El subtitulo de la cabecera, y el de la primera pagina es ninguno. */
const SUBTITULO_POR_PAGINA: Partial<Record<Pagina, TranslationKey>> = {
  rename: "common.rename",
  icon: "icons.title",
  delete: "common.delete",
};

