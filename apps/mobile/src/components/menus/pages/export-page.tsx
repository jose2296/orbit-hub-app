import { useMemo } from "react";

import { exportFormatSchema } from "@orbit-hub/contracts";
import type { ExportFormat } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import { SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import type { ExportRequest } from "@/hooks/use-export";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

import type { MenuContext, MenuKind } from "@/lib/menus/registry";

export interface ExportPageProps {
  ctx: MenuContext;
  /**
   * Hay una exportacion en marcha, y **los dos formatos salen apagados**.
   *
   * No es decoracion: el menu se cierra antes de que el peticion salga —ver
   * `EntityMenuSheet`—, asi que la unica forma de ver esta pagina con algo en
   * vuelo es reabrir el menu mientras el fichero baja. Dos filas grises sin
   * explicacion son un menu roto, y por eso la pagina pinta `export.running`
   * debajo en vez de dejar que se adivine.
   */
  running: boolean;
  /**
   * Que se hace con el formato que la persona eligio, y **es de la pantalla**.
   *
   * Delegar es toda la pagina en cuanto al trabajo: la peticion es un objeto que
   * la hoja guarda para poder reenviarla igual en el reintento, y una pagina que
   * lo construyera en cada pulsacion seria una pagina cuyo reintento pide otra
   * cosa. Por eso la pagina arma el `ExportRequest` —lo que se puede derivar del
   * `ctx`— y la hoja decide cuando corre y que hace con el resultado.
   */
  onExport: (args: ExportRequest) => void;
}

/**
 * El recurso de la ruta de exportacion de cada kind, o `null` si no hay endpoint.
 *
 * `GET /lists/:id/export` existe y `GET /collections/:id/export` se creo con la
 * T9. Los otros tres **no tienen** uno: una nota, una carpeta y un enlace no se
 * exportan, y mandarles una ruta seria un 404 del servidor pintado como si fuera
 * un fallo del boton.
 *
 * El tipo es `Record<MenuKind, ...>` y no `Partial<Record<...>>` a proposito,
 * por el mismo motivo que el mapa de `nodeType` de `SharePage`: con un `Partial`
 * un sexto kind entra sin que el compilador pregunte nada y la fila se ofrece
 * apuntando a un endpoint que nadie escribio. Los `null` de hoy son inalcanzables
 * —`ORDEN_POR_KIND` no declara `export` para esos tres— y son la red de seguridad
 * de un hueco futuro, no codigo alcanzable.
 *
 * Y el valor es **el segmento de la ruta y no la ruta entera**, porque el id sale
 * del `ctx` y escribirlo aqui seria una segunda fuente para lo que el registro ya
 * sabe.
 */
const RECURSO_POR_KIND: Record<MenuKind, string | null> = {
  list: "lists",
  collection: "collections",
  note: null,
  folder: null,
  bookmark: null,
};

/**
 * El icono de cada formato.
 *
 * El tipo sale de `SheetOption["icon"]` y no de `Ionicons.glyphMap`: lo que esta
 * tabla tiene que cumplir es "es el icono que `SheetOptions` acepta", y atarla al
 * tipo del componente que la pinta la deja compilar si ese tipo cambia. Y el
 * `Record` es completo por el motivo de siempre —un formato nuevo en el enum del
 * contrato rompe el typecheck hasta que alguien decida que icono lleva—.
 */
const ICONO_POR_FORMATO: Record<ExportFormat, NonNullable<SheetOption["icon"]>> = {
  json: "code-slash-outline",
  csv: "grid-outline",
};

/**
 * Exportar, y **los dos formatos**.
 *
 * ------------------------------------------------------------------
 * POR QUE SON UNA PAGINA Y NO UNA HOJA HERMANA
 * ------------------------------------------------------------------
 *
 * Elegir el formato es una pagina de esta hoja, como renombrar o compartir: son
 * dos filas y contestan en el momento. Reportar el resultado **no**, y esa es la
 * unica excepcion de la hoja, y esta escrita en la cabecera de
 * `ExportResultSheet`: la respuesta llega segundos despues, cuando el fichero ya
 * existe, y para entonces la pagina que eligio el formato ya no esta. Montarla
 * como pagina de la hoja —o como paso mas abajo— es una hoja dentro de la hoja:
 * dos `Modal` sobre una pantalla y un toque que llega al de arriba cerrando el de
 * abajo.
 *
 * ------------------------------------------------------------------
 * LAS FILAS SE DERIVAN, Y EL ORDEN LO DICE EL CONTRATO
 * ------------------------------------------------------------------
 *
 * Se recorren `exportFormatSchema.options` y no una lista escrita aca: el enum de
 * los formatos es del contrato, y el unico sitio donde esta ese enum. Anadir un
 * formato al contrato lo anade a este menu sin que nadie escriba una fila, y una
 * fila escrita a mano podria ofrecer un formato que la API no acepte —que es
 * exactamente lo que paso con `page: "export"` sin pagina: una fila que se
 * dibujaba y no llevaba a nada—.
 *
 * El orden es el del enum y no el de este archivo, y sale bien: **JSON primero**
 * porque es la copia —todo lo que hay, en una forma que se puede volver a
 * leer— y **CSV segundo** porque es el que se abre en una hoja de calculo, y quien
 * ya esta en una hoja de calculo busca ese y no el otro. Es el orden que llevaba
 * la hoja vieja y el que `POST /lists/:id/export` responde igual.
 *
 * Y la etiqueta sale de la clave del contrato por plantilla, `export.format.${formato}`,
 * que es la unica forma de no escribir dos claves a mano: la familia
 * `export.format.*` y sus dos valores existen en los dos idiomas y
 * `test/export-collection.test.ts` lo comprueba contra el enum, asi que un
 * formato nuevo sin frase rompe el test y no la pantalla.
 *
 * ------------------------------------------------------------------
 * LO QUE ESTA PAGINA NO SABE
 * ------------------------------------------------------------------
 *
 * No sabe si la entidad es del dueno, ni cuando cerrar el menu, ni que pintar del
 * intento que salio. Lo unico que arma es el `ExportRequest` —ruta, formato,
 * titulo y `fallbackId`—, y **los cuatro salen del `ctx`**: el id y el nombre ya
 * estan normalizados ahi (`Collection.name` llega como `title`), y reconstruirlos
 * aca seria una segunda fuente para lo que el registro ya sabe. El
 * `fallbackId` es el id porque `exportFilename` lo usa solo cuando el titulo no
 * deja nada utilizable, que es justo el caso en el que el id es la unica cosa que
 * hay.
 */
export function ExportPage({ ctx, running, onExport }: ExportPageProps) {
  const t = useTranslation();

  const recurso = RECURSO_POR_KIND[ctx.kind];

  /*
    Un kind sin recurso es uno que el registro **no le ofrece** la fila —`export`
    solo esta en el orden de `list` y `collection`, y las dos tienen endpoint—, asi
    que entrar aca con uno seria un fallo de escritura y no un caso de quien esta
    usando la app.

    Y se pinta `null` en vez de un error porque **la fila no llega a existir**: no
    hay ningun toque que pueda traerla. Es la misma red que la de `SharePage` con
    su `nodeType` en `null`.
  */
  if (!recurso) return null;

  /**
   * El pedido de este contexto en este formato, y **siempre el mismo objeto por
   * formato**.
   *
   * Se construye una vez por render y se pasa entero, no los campos sueltos: la
   * hoja lo guarda en un `ref` y lo reenvia tal cual en el reintento, y si el
   * reintento se armara aqui otra vez con el titulo del momento seria otra peticion
   * —y por tanto otro nombre de fichero— en lugar del mismo intento.
   */
  const pedidoDe = (formato: ExportFormat): ExportRequest => ({
    path: `/${recurso}/${ctx.entity.id}/export`,
    format: formato,
    title: ctx.entity.title,
    fallbackId: ctx.entity.id,
  });

  const opciones: SheetOption[] = useMemo(
    () =>
      exportFormatSchema.options.map((formato) => ({
        key: formato,
        label: t(`export.format.${formato}` as TranslationKey),
        icon: ICONO_POR_FORMATO[formato],
        disabled: running,
        onPress: () => onExport(pedidoDe(formato)),
      })),
    // `ctx` y `recurso` van tambien: `pedidoDe` los cierra, y una lista de
    // dependencias que no los menciona es una lista que puede mentir sobre lo que
    // se recalcula. En la practica no cambia —la hoja reinicia `pagina` cuando
    // llega otra entidad y esta pagina se desmonta con ella—, y por eso esto es
    // higiene y no un arreglo de un bug.
    [ctx, recurso, running, t, onExport],
  );

  return (
    <>
      <SheetOptions options={opciones} />
      {/*
        La espera, y **solo mientras hay algo en vuelo**. Es la frase que evita
        que las dos filas grises parezcan un menu roto, y va debajo de las filas
        porque es lo que explica y no un titulo.
      */}
      {running ? (
        <AppText variant="caption" tone="muted">
          {t("export.running")}
        </AppText>
      ) : null}
    </>
  );
}
