import { normalizaColor } from "@orbit-hub/contracts";
import type { TagColors } from "@orbit-hub/contracts";

import { luminanceDe } from "../workspace/wash";
import { COLOR_QUE_NO_ES, clamp01, hslToHex, rgbToHsl } from "../workspace/hsl";
import { ICON_COLOR_KEYS, ICON_COLORS, iconColor } from "./item-icons";

/**
 * What writing a label's colour should leave in the map.
 *
 * A pure function and not a line inside the hook, for the reason the rest of
 * this folder is made of pure functions: this is the rule that decides what
 * happens to the **other** labels when one colour changes, and the map travels
 * whole in a single sync operation, so getting it wrong loses somebody else's
 * colour without either of them finding out.
 *
 * `color: null` is not "no colour" — there is no such state, and a label always
 * has one. It is "no colour **chosen**", which is an absent key, and that is
 * what sends the label back to `derivedTagColor(tag)`.
 */
export function planTagColorChange(
  current: TagColors,
  tag: string,
  color: string | null,
): TagColors {
  // Start from a copy, so the map the caller passed is not the map that changes.
  // `null` deletes the key; anything else sets it. Nothing else in the map moves.
  const next: TagColors = { ...current };
  if (color === null) {
    delete next[tag];
  } else {
    next[tag] = color;
  }
  return next;
}

/* ------------------------------------------------------- se puede leer? -- */

/**
 * El contraste que tiene que alcanzar el color de una etiqueta para escribirse
 * con el, sobre el fondo que la pastilla va a tener debajo.
 *
 * **4.5 y no 3, y la razon es el tamano.** El texto de la pastilla es `caption`:
 * 12 px con peso 500. WCAG llama "texto grande" a 18 px, o a 14 px en negrita, y
 * para el texto grande —y para los bordes y los iconos que dibujan una interfaz—
 * el minimo es 3:1. Una etiqueta de 12 px no es ninguna de las dos cosas, asi que
 * le toca el 4.5:1 del texto normal. Bajarlo a 3 es el cambio que hace que esto
 * parezca un detalle y no lo sea.
 *
 * **El numero va aqui y no en el componente**, porque es una regla y no una
 * constante de JSX: si el umbral lo elige quien pinta, el umbral es el que le
 * conviene a quien pinta. Y el test lo escribe a mano en vez de leerlo de aqui,
 * a proposito —lo bajan los dos a la vez si lo lee— para que aflojarlo sea un
 * test rojo y no un cambio de postura.
 */
export const MIN_LABEL_CONTRAST = 4.5;

/**
 * El contraste entre dos colores, de 1 (el mismo) a 21 (blanco y negro).
 *
 * La formula de WCAG tal cual, sobre `luminanceDe` de `../workspace/wash`, que ya
 * es la luminancia relativa de WCAG y esta exportada: repetirla aqui seria la
 * segunda copia de una cuenta que deberia dar el mismo numero en los dos sitios
 * —y la segunda copia es la que un dia se queda sin actualizar—. Los dos
 * argumentos tienen que ser `#RRGGBB`, que es lo que son todos los colores que se
 * le pasan aqui y todos los de la paleta.
 *
 * **Da 21 en los dos sentidos**, y no 21 y 1/21: el contraste se define siempre
 * sobre la parte clara partida por la parte oscura, para que un numero tenga
 * sentido sin depender de quien mire primero. "Blanco sobre negro" son 21:1, y
 * el 1/21 es la misma medicion leida al reves, no otra salida de esta funcion.
 */
export function contrastRatio(a: string, b: string): number {
  const lumA = luminanceDe(a);
  const lumB = luminanceDe(b);
  const clara = Math.max(lumA, lumB);
  const oscura = Math.min(lumA, lumB);
  return (clara + 0.05) / (oscura + 0.05);
}

/**
 * De que color se escribe una etiqueta: el suyo, o el del tema si el suyo no se
 * lee encima de la pastilla.
 *
 * **Decidir el contraste y no el color**, que es la misma regla que la cabecera de
 * un espacio ya escribio en `docs/roadmap.md`: el color se usa solo si se puede
 * leer encima y, si no se puede, el texto es el del tema. Nadie tiene que elegir
 * un color que funcione por casualidad ni acordarse de cuales son.
 *
 * La alternativa descartada era la de las variantes: `ICON_COLORS` es un valor
 * plano por color, y un relleno tinteado pediria una variante suave de cada color
 * en cada esquema —24 valores que no existen y que esta regla no va a inventar—.
 * La pastilla se queda con `surfaceMuted` de fondo y el color en el texto.
 *
 * **Lo que cuesta, medido y no supuesto.** Sobre `surfaceMuted` claro,
 * `ICON_COLORS` pasa el umbral con azul, morado y marron; sobre el oscuro, con
 * verde, ambar y neutro. Tres de doce en cada esquema, y **ninguno de los tres es
 * el mismo**, asi que nueve de cada doce se escriben en el color del tema en uno u
 * otro tema. La pastilla no es "la etiqueta de colores": es la etiqueta del tema,
 * con color cuando el color se deja leer. Y los que casi se quedan estan
 * medidos, no estimados —oliva a 4.46 en claro, naranja a 4.47 en oscuro, por
 * debajo de la linea en menos de un 1%—, asi que subir el relleno o retocar un
 * color los haria pasar, y eso ya no es la regla de este archivo: es cambiarla.
 *
 * **La puerta se mide sobre el hex, no sobre la clave**, que es donde se pinta de
 * verdad: una clave que venga de una cache vieja o de una version futura es
 * texto libre, `iconColor` la vuelve a pintar en el neutro, y ese neutro pasa por
 * la misma puerta que todos los demas. Un color que no se puede calcular sale
 * `NaN`, y un `NaN` no llega a 4.5, asi que el resultado es el texto del tema:
 * **fallar aqui es pintar algo que si se lee.**
 *
 * `fallback` viene como parametro y no se lee de aqui dentro porque esta funcion
 * no sabe de que tema la estan llamando, y porque el que sabe —el componente— es
 * quien ya lo tiene a mano.
 */
export function labelTextColor(
  colour: string,
  fill: string,
  fallback: string,
): string {
  const hex = iconColor(colour);
  return contrastRatio(hex, fill) >= MIN_LABEL_CONTRAST ? hex : fallback;
}

/* ------------------------------------------- la pastilla deriva los dos ----- */

/**
 * De que color se pinta una pastilla: el relleno que lleva su color y el texto
 * que se lee encima.
 *
 * **Esto es lo que sustituye a la puerta de `labelTextColor`**, y la razon de que
 * se pueda borrar en vez de moverse esta en el comentario de mas abajo: el texto
 * no se rinde nunca. Si hay que oscurecerlo, se oscurece; si hay que aclararlo, se
 * aclara; y si el extremo del tema no basta, se prueba el otro. **No hay ningun
 * color que se quede sin leer**, que es justo el caso al que la puerta existia
 * para volver —y ese caso no existe.
 *
 * El relleno es **el color mezclado con la superficie al 14%**, un tinte, como el
 * `accentSoft` de las insignias de prioridad. No es `surfaceMuted`: el fondo de
 * una pastilla era del tema y por eso el color de la etiqueta no tenia nada que
 * ver con el, que es la mitad del problema que se arregla aqui.
 *
 * `scheme` decide **en que direccion se empieza** —en claro hacia negro, en oscuro
 * hacia blanco— y por eso sigue siendo un parametro y no una deduccion del
 * relleno: es lo que hace que la pastilla se vea como tinta en claro y como luz en
 * oscuro, que es el mismo criterio con el que el resto de la app elige sus tintes.
 */
export function labelPillColors(
  colour: string,
  surface: string,
  scheme: "light" | "dark",
): { fill: string; text: string } {
  const hex = tagColorHex(colour);
  const fill = mixHex(hex, surface, MEZCLA_DE_LA_PASTILLA);
  const { h, s, l } = rgbToHsl(hex);
  // En claro la pastilla se tinta hacia una superficie clara, asi que el texto se
  // oscurece; en oscuro al reves. Es el criterio del tema, y es el que decide por
  // donde empieza la cuenta —no por donde se llega.
  const primero = scheme === "dark" ? 1 : -1;

  // **La vuelta, y por que existe: la primera direccion no siempre basta.** El
  // extremo mas cercano al esquema se queda corto cuando el relleno sale tan
  // saturado que ningun aclarado lo salva. Medido sobre `#111827`: ambar `#D97706`
  // —uno de los doce, no un color raro— da un relleno `#BD6A0B` al que el blanco
  // solo llega a **4.02:1**, y de ahi no sube mas porque el relleno ya esta en
  // `L = 0.21` y el blanco tiene 1.0. El mismo ambar, **oscureciendolo**, llega a
  // **4.65:1**. Lo mismo le pasa a `neutral`, `green` y `orange` sobre la
  // superficie oscura, o sea a cuatro de los doce: sin la segunda vuelta, cuatro
  // pastillas de la paleta salen por debajo de la linea en el tema oscuro.
  //
  // Y el peor de los dos extremos no es raro: un negro o un blanco elegidos a mano
  // dan un relleno casi igual que la superficie, y su texto solo se salva dando la
  // vuelta. Sin ella, esas dos —los colores que cualquiera elige primero— se
  // dibujan ilegibles, y eso es peor que el gris que venia antes porque ahora la
  // pastilla **parece** el color que la persona eligio.
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    const signo = primero * (vuelta === 0 ? 1 : -1);
    for (let paso = 1; paso <= PASOS_DE_LUMINOSIDAD; paso += 1) {
      const candidato = hslToHex(h, s, clamp01(l + signo * paso * PASO_DE_LUMINOSIDAD));
      if (contrastRatio(candidato, fill) >= MIN_LABEL_CONTRAST) {
        return { fill, text: candidato };
      }
    }
  }

  /*
   * **Aqui no se llega, y es lo que sostiene el comentario de arriba.** Con
   * `PASOS_DE_LUMINOSIDAD = 60` y un paso de 0.02, la cuenta pasa de largo el
   * extremo en las dos direcciones —`l` esta entre 0 y 1 y 60 pasos son 1.2— asi
   * que los dos extremos absolutos, **negro y blanco, son candidatos siempre**:
   * el `clamp01` los entrega en cuanto la cuenta los pisa, y con la saturacion del
   * color que sea, porque `hslToHex(h, s, 0)` da `#000000` y `hslToHex(h, s, 1)` da
   * `#FFFFFF` para cualquier `h` y cualquier `s`.
   *
   * Y **de esos dos, uno siempre se lee**. El negro pasa de 4.5:1 sobre cualquier
   * relleno con `L >= 0.175` y el blanco sobre cualquier relleno con
   * `L <= 0.183` —las dos bandas salen de `(L + 0.05) / 0.05`, y se pisan entre
   * 0.175 y 0.183—, asi que no hay ningun relleno contra el que los dos extremos
   * fallen a la vez. Ese es el argumento entero, y por eso la funcion no tiene un
   * `return` de emergencia: si se llegara aqui, seria porque el paso o el numero de
   * pasos ya no alcanzan los dos extremos, que es un typecheck y no una pastilla
   * gris. El `throw` de abajo es ese typecheck, escrito como codigo.
   *
   * Ese es el motivo por el que **la puerta de contraste se borra y no se mueve**:
   * antes la unica salida a un color ilegible era el color del tema, que es un
   * color que nadie eligio y que ademas no siempre se leia —la puerta media contra
   * `surfaceMuted` y el texto del tema venia de otra parte—. Aqui la salida es el
   * mismo tono del color elegido, movido hasta que se lee sobre el relleno que ese
   * mismo color produce.
   *
   * **Y quien venga a mirar si aqui falta una guarda: no falta ninguna.** Que no
   * haya un `return` de reserva al final no es que se haya olvidado; el `throw` que
   * si hay se deja notar todavia mas. La guarda es que los dos extremos existen, y
   * esta escrita justo encima.
   */
  throw new Error("labelPillColors: ningun extremo alcanza 4.5:1 — revisa el paso");
}

/**
 * Cuanto se mezcla el color de una pastilla con la superficie.
 *
 * **14%, dentro del 12-15% que pide la spec, y no un token**: es la proporcion de
 * una insignia contra su fondo, no una distancia de la reticula de la app, asi
 * que no
 * pertenece a `theme.spacing` —que no tiene numeros entre 1 y 2— sino a la regla
 * que la usa. Subirlo o bajarlo cambia los doce rellenos de la app a la vez, asi
 * que es un numero que se cambia aqui y con un motivo, no en el componente.
 */
const MEZCLA_DE_LA_PASTILLA = 0.14;

/**
 * El paso con el que se busca el texto legible, y cuantos pasos hay.
 *
 * **De dos en dos, porque es lo mas fino que no recorre el tinte entero para nada**
 * (la spec): un punto de luminosidad se ve a simple vista como un tinte distinto
 * sobre el mismo color, y dos ya no se distinguen del propio redondeo de los
 * canales. En la practica se para en el primero o en el segundo.
 *
 * **60 pasos, y son de sobra.** La cuenta solo necesita llegar al extremo, y desde
 * cualquier punto de 0 a 1 eso son 50 pasos; 60 deja margen para que el paso se
 * cambie a uno mas fino sin tener que acordarse de tocar el 50.
 */
const PASO_DE_LUMINOSIDAD = 0.02;
const PASOS_DE_LUMINOSIDAD = 60;

/**
 * El color de una etiqueta tal como se pinta: un hex que se pasa entero, el hex
 * de un nombre viejo de la paleta, o el neutro.
 *
 * **No es `iconColor` y no puede serlo.** `iconColor` devuelve el neutro para lo
 * que no conoce, asi que un hex libre —`#3B5FDE`, el que alguien elige en el
 * selector— volveria gris, que es exactamente el bug que este archivo arregla.
 * Aqui el orden es el otro: primero `normalizaColor` del contrato, que es **el
 * unico sitio del repositorio que decide que es un color**, despues el nombre, y
 * el neutro solo para lo que no es ninguna de las dos cosas. No hay un tercer
 * validador de hex en este archivo, y el que hay es el del contrato.
 *
 * **La paleta no esta copiada aqui.** Los doce salen de `ICON_COLORS` en
 * `item-icons.ts` —que se exporta para esto—, que es donde ya vivian y donde se
 * pueden cambiar. Y la puerta es `ICON_COLOR_KEYS.includes` antes de mirar la
 * tabla, no `ICON_COLORS[colour] ?? ...`: la tabla es un objeto literal, asi que
 * `ICON_COLORS["toString"]` es una **funcion**, y un color escrito con esa palabra
 * —o un `__proto__` colado en el mapa— saldria como una funcion donde tiene que
 * haber un hex. El contrato ya tiene el mismo cuidado en `sanitiseTagColors`, con
 * el mismo porque.
 */
export function tagColorHex(colour: string): string {
  const hex = normalizaColor(colour);
  if (hex) {
    return hex;
  }
  // El nombre se recorta igual que la clave en el mapa: lo que viene por el cable
  // es texto libre y `" green "` es el color que alguien eligio, no otro.
  const nombre = typeof colour === "string" ? colour.trim() : "";
  const esDeLaPaleta = (ICON_COLOR_KEYS as readonly string[]).includes(nombre);
  return esDeLaPaleta ? iconColor(nombre) : ICON_COLORS.neutral;
}

/**
 * Dos colores mezclados, canal a canal, en `#RRGGBB`.
 *
 * **Lineal por canal y no en HSL**, y la razon es que una mezcla lineal es la
 * unica de estas dos que **no depende del color de los otros dos**: en HSL, el
 * punto medio de un azul y su propio tinte es un color distinto del punto medio
 * en RGB, asi que un tinte calculado en HSL no es el mismo tinte en cada tono y
 * doce pastillas no se ven de la misma familia. En RGB, mezclar al 14% es mezclar
 * al 14%, siempre.
 *
 * `t` se recorta a 0..1 en vez de calcularlo de todos modos: `a + (b - a) * 1.5`
 * es un canal por encima de 255, y `toString(16)` de un numero de tres digitos
 * devuelve tres caracteres, que es un `#RRGGBB` de siete y un color que el parser
 * de CSS rechaza **en silencio**. Un `t` fuera de rango es un error de quien
 * llama, y aqui sale como un tinte entero sin que se note.
 *
 * **Un color que no se puede leer sale como `COLOR_QUE_NO_ES` y no como
 * `#NANNAN`**, por el mismo motivo y con el mismo cuidado que `hslToHex`: una
 * cadena que no es un color debe ser un color que se puede dibujar.
 */
export function mixHex(a: string, b: string, t: number): string {
  const desde = canales(a);
  const hasta = canales(b);
  if (!desde || !hasta) {
    return COLOR_QUE_NO_ES;
  }
  const cuanto = clamp01(t);
  const canal = (indice: 0 | 1 | 2) =>
    Math.round(desde[indice] + (hasta[indice] - desde[indice]) * cuanto)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${canal(0)}${canal(1)}${canal(2)}`;
}

/**
 * Los tres canales de un hex, o `null` si no hay ningun hex.
 *
 * **Por `normalizaColor` y no con un `replace("#", "")` de su cuenta**: esta seria
 * la segunda copia del formato en el movil, y el unico sitio que puede decidirlo
 * esta en el contrato. Ademas el contrato trae lo que un recorte a mano no
 * trae —`#fff` ampliado a seis digitos, `#` opcional, mayusculas— y `mixHex` lo
 * hereda sin tener que saber nada.
 */
function canales(hex: unknown): [number, number, number] | null {
  const normal = normalizaColor(hex);
  if (!normal) {
    return null;
  }
  const valor = normal.slice(1);
  return [
    parseInt(valor.slice(0, 2), 16),
    parseInt(valor.slice(2, 4), 16),
    parseInt(valor.slice(4, 6), 16),
  ];
}
