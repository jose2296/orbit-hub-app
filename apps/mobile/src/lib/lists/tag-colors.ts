import { normalizaColor } from "@orbit-hub/contracts";
import type { TagColors } from "@orbit-hub/contracts";

import { luminanceDe } from "../workspace/wash";
import {
  COLOR_QUE_NO_ES,
  clamp01,
  hslToHex,
  hsvToHex,
  rgbToHsl,
} from "../workspace/hsl";
import { ICON_COLOR_KEYS, iconColor } from "./item-icons";

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
 * El contraste que tiene que alcanzar el texto de una pastilla contra el relleno
 * que esa pastilla lleva.
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

/* ------------------------------------------- la pastilla deriva los dos ----- */

/**
 * De que color se pinta una pastilla: el relleno que lleva su color y el texto
 * que se lee encima.
 *
 * **Esto es lo que sustituyo a la puerta que mediaba el color contra
 * `surfaceMuted` y devolvia el color del tema**, y la razon de que se pudiera
 * borrar en vez de moverse esta en el comentario de mas abajo: el texto
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
 * El color que se busca **no** esta en HSL: HSL solo mueve la luminosidad, y el
 * tono y la saturacion son los del color elegido, que es lo que se quiere conservar.
 * Lo que no se conserva es el tono **en el extremo**, que no tiene ninguno.
 *
 * ---
 *
 * **Lo que se ve, medido, porque no es lo que uno esperaria: el texto se va
 * lejos.** Al 14% de tinte el relleno es sutil —luminancia de WCAG de **0.079 a
 * 0.351** en los doce de la paleta y los dos esquemas, y de 0.147 a 0.351 solo en
 * claro— y para llegar a 4.5:1 sobre el, el texto tiene que recorrer **mucho
 * camino en la luminosidad**: la cuenta no se queda cerca del color elegido, se va.
 * Consecuencias, todas medidas sobre los doce con las superficies reales
 * (`#F0F2F8` y `#1B2231`):
 *
 * - En el tema claro, **once de los doce salen por debajo de luminancia 0.036**, o
 *   sea indistinguibles de negro a los ojos; el unico que no, `brown`, sale hacia
 *   el otro extremo en `#FCEBE0`. `red` queda en `#260606`, `purple` en `#10031B`.
 * - Dos de los doce se van al otro extremo: `teal` en oscuro sale en `#FDFFFF`,
 *   de luminancia **0.996** —blanco con un punto de rojo, a un paso de `#FFFFFF`—
 *   y `brown` en claro en `#FCEBE0`, de luminancia 0.855.
 *
 * **Que el extremo puro salga, sale; en cuantos casos, no se dice aqui a proposito.**
 * Un porcentaje de eso depende de la rejilla que se mida y de si se divide por
 * llamadas o por colores distintos, y salia distinto segun con cual: no describe la
 * funcion, describe la muestra. Lo que si es cierto sin medirse es que **el bucle
 * para en cuanto el contraste pasa**, asi que el texto de una pastilla nunca queda
 * por encima de 4.5:1 mas de un paso —el del propio paso— y por eso el minimo sale
 * pegado a la linea y no holgado.
 *
 * **O sea: el color elegido se reconoce en el relleno y no en el texto.** No es el
 * mismo tono del color elegido —no lo es, y el que diga lo contrario esta
 * equivocado—, es el tono mas cercano al color elegido que todavia se lee. La
 * garantia de que se lee es total; la de que se parece, no, y esa es la diferencia
 * con la puerta anterior: **antes el texto era un color que nadie habia elegido**,
 * el del tema, y ahora es el de la persona, movido. Sigue siendo mejor, pero no es
 * lo mismo, y conviene no contarlo como si lo fuera.
 *
 * **Y el precio de llegar a 4.5:1 son esos puntos de recorrido, no el paso de la
 * cuenta**, sino el 14% de mezcla. Afinar el paso **no acorta el viaje**: la cuenta
 * sale en cuanto un candidato pasa, asi que un paso mas fino cae en **otro hex, con
 * el contraste un poco mas bajo y siempre por encima de la linea** —el bucle solo
 * devuelve dentro del `if` que la exige, asi que "por debajo" no puede salir—.
 * Ni mas lejos ni mas corto: el mismo sitio de la escala de contraste, redondeado a
 * otro lado. Quien quiera que el texto se parezca mas
 * al color elegido tiene **una sola palanca y es `MEZCLA_DE_LA_PASTILLA`**: subirla
 * acerca el relleno al color y acorta el viaje, y bajarla hace lo contrario. Cuanto
 * se puede subir sin perder legibilidad es la pregunta abierta de esta funcion, y la
 * razon por la que el 14% no esta canonizado en ningun sitio mas que en la constante
 * de arriba. El numero que dice por que no se puede subir sin mas es el color de la
 * marca: **`success` `#0E9F6E` mide 3.025:1 sobre `surfaceMuted` claro** —la puerta
 * lo rechazaba por eso—, y este archivo lo saca de ahi **moviéndolo**, no bajando el
 * relleno: pastilla `#2EAB81` con texto `#053827`, a 4.53:1. El mismo `success` en
 * oscuro son `#108E65` y `#02120D`, a 4.64:1.
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

  // **La vuelta, y por que existe: la primera direccion no es un plan B, es medio
  // caso.** El error de leerla como una reserva es pensar que se prueba "por si
  // acaso"; lo que pasa es que **para un color oscuro en tema claro no existe
  // ninguna primera vuelta que pueda funcionar**, y no porque la cuenta falle:
  //
  //   brown `#92400E` en claro -> relleno `#9F592F`, luminancia de WCAG 0.147
  //     NEGRO  sobre ese relleno: 3.94:1   <- no pasa
  //     BLANCO sobre ese relleno: 5.32:1   <- pasa
  //
  // Y eso no es un color raro ni una casualidad: **un tinte de un color oscuro es
  // el mismo color oscuro**, asi que oscurecerlo mas no lo aleja del blanco que
  // hace falta. En el tema claro la cuenta se para en el extremo **negro**, que es
  // el punto mas lejano posible al relleno; si ahi no llega, ningun punto anterior
  // llega tampoco, porque todos son mas claros y por tanto mas cercanos al
  // relleno. Se puede decidir antes de empezar: **basta con medir el extremo** —
  // en claro `contrastRatio("#000000", relleno) < 4.5`, y la vuelta entera esta
  // perdida. Sobre los doce de la paleta con las superficies reales, en claro le
  // pasa a `brown` y en oscuro a `neutral`, `green`, `amber` y `orange` —cuatro de
  // doce, y son justo los que salen hacia el extremo contrario al de su esquema—.
  // Los doce con los dos esquemas estan clavados en `los doce colores de la paleta
  // salen exactamente en estos hex`, en `tag-colors.test.ts`, y ahi se puede
  // comprobar uno por uno que color salio de cada vuelta.
  //
  // El lado oscuro del tema es el mismo caso del reves: `amber` `#D97706` da un
  // relleno `#BE6B0C` al que el blanco **no llega a 3.96:1**, y el ambar
  // oscureciendolo sale en `#1C1001` a 4.71:1. **Estos numeros son sobre `#1B2231`,
  // la superficie oscura del tema, y no sobre `#111827`**, que es la que usa el test
  // de "la pastilla se da la vuelta cuando aclarar no basta" mas abajo —el unico que
  // pone `amber` sobre `#111827`, y lo pone justamente para anclar estas dos cifras—:
  // sobre esa el relleno sale `#BD6A0B` y el blanco llega a 4.02:1. Las dos dicen lo
  // mismo —el blanco no pasa—, y por eso el argumento no depende de cual se cite; lo
  // que **no** se puede es dar las cifras de una sin decir que superficie es, que es
  // justo como se confunde una con otra. La garantia tampoco depende de cual de los dos
  // extremos toque: los dos son el mismo argumento, y estan los dos probados en el
  // bloque de abajo.
  //
  // Y el caso que mas se nota no es un color raro sino el primero que elige
  // cualquiera: **un negro o un blanco puestos a mano.** Con la superficie de su
  // propio esquema los dos se resuelven en la primera vuelta —negro sobre la
  // oscura, blanco sobre la clara—. Lo que necesita la vuelta es **el cruce**:
  // negro sobre la superficie clara, y blanco sobre la oscura. Y ahi el relleno
  // **no** sale "casi igual que la superficie", que es como lo decia este comentario
  // antes: sale un tinte casi negro o casi blanco, o sea un relleno del que el
  // color elegido solo se separa hacia el lado **contrario** al que esta buscando la
  // cuenta. Sin la vuelta esas dos se dibujan ilegibles en un color que **parece**
  // el que eligio la persona, que es peor que el gris de antes.
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    const signo = primero * (vuelta === 0 ? 1 : -1);
    for (let paso = 1; paso <= PASOS_DE_LUMINOSIDAD; paso += 1) {
      const objetivo = clamp01(l + signo * paso * PASO_DE_LUMINOSIDAD);
      const candidato = hslToHex(h, s, objetivo);
      if (contrastRatio(candidato, fill) >= MIN_LABEL_CONTRAST) {
        return { fill, text: candidato };
      }
      // **La vuelta se acaba aqui, y es porque ya no queda nada que probar.** Del
      // resto de los `PASOS_DE_LUMINOSIDAD`, `clamp01` devuelve este mismo `objetivo`
      // —es el extremo— asi que todos evaluarian **el mismo candidato otra vez**: no
      // es que sea lento, es que se esta midiendo el mismo numero una vez tras otra.
      //
      // **No puede cambiar el resultado**, y no por opinion: del paso en que la
      // cuenta pisa el extremo, el candidato es identico y su veredicto tambien, de
      // modo que los pasos que quedan solo podrian repetir el "sigue sin pasar" que
      // acaba de salir.
      //
      // Y lo que verifica que ningun hex se mueve es **`los doce colores de la
      // paleta salen exactamente en estos hex`**, en `tag-colors.test.ts`: el que
      // clava que color sale. **La rejilla de 227 colores no lo verifica** —comprueba
      // que todo llega a 4.5:1, y a un `PASO` distinto llegaria igual con otros hex
      // y la suite seguiria verde—, asi que si esto se documentara otra vez, que sea
      // la tabla y no la rejilla.
      if (objetivo === 0 || objetivo === 1) {
        break;
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
   * Y **de esos dos, uno siempre se lee**. Aqui `L` es la **luminancia relativa de
   * WCAG** —la de `luminanceDe`, de 0 a 1— y **no** la `l` de HSL que se mueve
   * arriba. Las dos van de 0 a 1 y **no son la misma magnitud**, asi que leer una
   * como la otra cambia la cuenta por un factor de dos: el relleno `#BE6B0C` del
   * `amber` en oscuro tiene una luminosidad HSL de **0.40** y una luminancia de WCAG
   * bastante menor. La razon no es que una pese mas que la otra, sino que **pesan
   * canales distintos**: la `l` de HSL es un `(max + min) / 2` sobre los canales, o
   * sea **una media sin pesos de solo los dos extremos, y el canal del medio no
   * cuenta para nada** —en `#BE6B0C` mandan el rojo y el azul—, mientras que WCAG
   * reparte 0.2126 / 0.7152 / 0.0722 entre los tres y **el que mas pesa es el
   * verde, justo el que HSL ignora**. Por eso los dos numeros no se pueden leer el
   * uno por el otro ni aunque los dos vayan de 0 a 1. El negro pasa de 4.5:1 sobre
   * cualquier relleno con `L >= 0.175` y el blanco sobre cualquiera con `L <= 0.183`
   * —las dos bandas salen de `(L + 0.05) / 0.05`, y se pisan entre 0.175 y 0.183—,
   * asi que no hay ningun relleno contra el que los dos extremos fallen a la vez.
   * Ese es el argumento entero, y por eso la funcion no tiene un `return` de
   * emergencia: si se llegara aqui, seria porque el paso o el numero de pasos ya no
   * alcanzan los dos extremos, que es un typecheck y no una pastilla gris. El
   * `throw` de abajo es ese typecheck, escrito como codigo.
   *
   * Ese es el motivo por el que **la puerta de contraste se borra y no se mueve**:
   * antes la unica salida a un color ilegible era el color del tema, que es un color
   * que nadie eligio. Aqui la salida es el **tono mas cercano al color elegido que
   * todavia se lee** sobre el relleno que ese mismo color produce —mas cercano, no
   * el mismo, y en el extremo no conserva ninguno: el bloque de arriba tiene las
   * medidas de hasta donde se llega—. Lo que cambia no es que ahora salga el color
   * de otra persona: sale el de esta, movido hasta que se puede leer.
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
 * una insignia contra su fondo, no una distancia de la reticula de la app, asi que
 * no pertenece a `theme.spacing` —que no tiene numeros entre 1 y 2— sino a la regla
 * que la usa. Subirlo o bajarlo cambia los doce rellenos de la app a la vez, asi
 * que es un numero que se cambia aqui y con un motivo, no en el componente.
 *
 * **Es tambien la unica palanca sobre el aspecto de la pastilla.** Para llegar a
 * 4.5:1 sobre un tinte del 14%, el texto tiene que recorrer mucho camino en la
 * luminosidad, y ese camino es el que hace que el color elegido se lea en el
 * relleno y no en el texto. El paso de la cuenta no lo acorta: con un paso mas fino
 * el hex sale practicamente el mismo, asi que quien quiera que el texto se parezca
 * mas al color elegido sube o baja **aqui** y no toca el paso de abajo. El bloque de
 * `labelPillColors` explica el porque con las cifras.
 */
const MEZCLA_DE_LA_PASTILLA = 0.14;

/**
 * El paso con el que se busca el texto legible, y cuantos pasos hay.
 *
 * **De dos en dos, y la justificacion de antes era falsa.** Este comentario decia que
 * 2 era "lo mas fino que no recorre el tinte entero para nada" y que la cuenta "se
 * para en el primero o en el segundo". Las dos cosas son falsas: la cuenta se va
 * hacia el extremo y se va lejos, como explica el bloque de `labelPillColors`.
 * **No se pone aqui ninguna cuenta de pasos ni de evaluaciones** porque ninguna la
 * comprueba un test, y un numero que nadie pueda reproducir es un numero que un dia
 * empieza a estar mal sin que nadie se entere.
 *
 * **Lo que decide el aspecto de la pastilla es el porcentaje de la mezcla, no este
 * numero.** Con un paso mas fino el hex sale practicamente el mismo —la diferencia es
 * de milésimas—, asi que afinar la cuenta no acerca el texto al color elegido; eso se
 * hace con `MEZCLA_DE_LA_PASTILLA`, que esta justo encima. Aqui 2 es la resolucion con
 * la que la cuenta encuentra el sitio, y llega a un color que se puede leer en el
 * codigo sin mas decimales de los necesarios.
 *
 * **Y si cambia este numero, la tabla lo dice.** `los doce colores de la paleta
 * salen exactamente en estos hex`, en `tag-colors.test.ts`, clava que color sale de
 * los doce en los dos esquemas: es el unico sitio al que puede mirar este comentario
 * para saber que el cambio no movio nada. **La rejilla de 227 colores no lo clava**,
 * porque solo mira que todo llegue a 4.5:1.
 *
 * **60 pasos, y son de sobra** —de hecho, con el `break` del extremo **nunca se
 * llegan a gastar**: desde cualquier punto de 0 a 1, llegar al extremo son 50 pasos a
 * paso de 0.02, y el bucle corta en cuanto lo pisa. El 60 esta para que cambiar el
 * paso a uno mas fino no obligue a acordarse de tocar el 50.
 */
const PASO_DE_LUMINOSIDAD = 0.02;
const PASOS_DE_LUMINOSIDAD = 60;

/**
 * El color de una etiqueta tal como se pinta: un hex que se pasa entero —y
 * normalizado—, el hex de un nombre viejo de la paleta, o el neutro.
 *
 * **No es `iconColor` y no puede serlo.** `iconColor` devuelve el neutro para lo
 * que no conoce, asi que un hex libre —`#3B5FDE`, el que alguien elige en el
 * selector— volveria gris, que es exactamente el bug que este archivo arregla.
 * Aqui el orden es el otro: primero `normalizaColor` del contrato, que es **el
 * unico sitio del repositorio que decide que es un color**, despues el nombre, y
 * el neutro solo para lo que no es ninguna de las dos cosas. No hay un tercer
 * validador de hex en este archivo, y el que hay es el del contrato.
 *
 * **"Tal cual" y "normalizado" son dos cosas, y aqui gana lo segundo.** El brief
 * decia que un hex sale *tal cual*; lo que sale es **el mismo color en la forma que
 * el resto del repositorio habla**: `#3b5fde` sale `#3B5FDE` y `#abc` sale
 * `#AABBCC`. No es una traicion de "tal cual" —`#ABC` y `#AABBCC` son el mismo azul
 * y `#3b5fde` y `#3B5FDE` tambien—: es que lo que llega por el cable puede venir
 * en minusculas de una build vieja, y un mapa donde `#3b5fde` y `#3B5FDE` son
 * colores distintos es un mapa en el que la misma etiqueta tiene dos colores y
 * solo uno esta en pantalla. **Que el mapa y la pastilla hablen los dos la misma
 * forma de ese hex es el motivo de que la normalizacion este aqui y no en el
 * contrato solo**: `sanitiseTagColors` ya normaliza lo que se guarda, asi que si
 * esta no lo hiciera, lo que se dibujaria y lo que se guardaria serian dos
 * cadenas del mismo color. Hay un test que lo afirma con las dos formas.
 *
 * **La paleta no esta copiada aqui.** Los doce salen de `ICON_COLORS` en
 * `item-icons.ts`, que es donde ya vivian y donde se pueden cambiar, y de ahi
 * tambien sale el neutro: **la ultima rama es `iconColor("neutral")` y no
 * `ICON_COLORS.neutral`** para que la politica de "lo que no se conoce es neutro"
 * tenga **un solo sitio**, el `??` de `iconColor`. Las dos cosas leerian el mismo
 * objeto hoy, pero si manana la reserva de un icono cambia, una copia de esa
 * decision en este archivo seria la que se queda atras —la segunda copia es
 * siempre la que no se actualiza— y este archivo no la necesita para nada.
 *
 * Y la puerta es `ICON_COLOR_KEYS.includes` antes de mirar la tabla, no
 * `ICON_COLORS[colour] ?? ...`: la tabla es un objeto literal, asi que
 * `ICON_COLORS["toString"]` es una **funcion**, y un color escrito con esa palabra
 * —o un `__proto__` colado en el mapa— saldria como una funcion donde tiene que
 * haber un hex. **`iconColor` no hace esa pregunta** —`iconColor("toString")`
 * devuelve `Object.prototype.toString`—, asi que el fallo es real y lo resuelve
 * quien llama, que es esta linea. El contrato ya tiene el mismo cuidado en
 * `sanitiseTagColors`, con el mismo porque.
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
  return esDeLaPaleta ? iconColor(nombre) : iconColor("neutral");
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
 * **Y el `Number.isFinite` va antes del recorte y no por debajo, porque
 * `clamp01` no limpia un `NaN`.** `clamp01` es `Math.min(Math.max(valor, 0), 1)`, y
 * las tres de `Math` devuelven `NaN` cuando una entrada es `NaN`: un `t` de `NaN`
 * llegaba a `Math.round`, `"NaN".toString(16)` es la cadena `"NaN"`, y el retorno
 * era literalmente **`#NANNANNAN`** —la mitad del hex, en mayusculas y con el
 * formato perfecto, que es justo lo que el parser de CSS acepta sin quejarse y
 * que React Native se traga sin error—. Medido antes del arreglo, no supuesto.
 *
 * **Lo que este guard tiene en comun con el de `hslToHex` es el ternario, no el
 * default.** `hslToHex` si usa `Number.isFinite(v) ? v : 0` en sus canales —de ahi
 * sale la forma— pero **no cubre su `m = l - c / 2`**, asi que con una luminosidad
 * `NaN` devuelve `#NANNANNAN` tambien: medido, `hslToHex(0, 1, NaN)`. No lo arreglo
 * aqui porque `hsl.ts` no es de este archivo y nadie me ha pedido que lo toque;
 * lo dejo escrito para que el siguiente que encuentre el mismo `#NANNANNAN` en una
 * insignia sepa que hay dos sitios y por que este ya esta cerrado.
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
  const cuanto = Number.isFinite(t) ? clamp01(t) : 0;
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

/* -------------------------------------- lo que el selector de color pregunta -- */

/**
 * Lo que dice el campo de un color, en la forma en que el repositorio habla.
 *
 * **Envuelve a `normalizaColor` y no repite su regla.** El contrato es el dueño
 * del formato, el movil tiene su validador propio —`esHex`, en
 * `lib/workspace/hsl.ts`— y hay un test que compara los dos y obliga a que digan
 * lo mismo. Un `RegExp` mas aqui seria un tercero, y el tercero es el que se
 * queda sin actualizar.
 */
export function normalizaHex(texto: string): string | null {
  return normalizaColor(texto);
}

/**
 * El color de un tono, una saturacion y un valor.
 *
 * El cuadrado de un selector tiene tres numeros sueltos y `hsvToHex` quiere un
 * `Hsv`; esta es la unica parte del selector que lo sabe. Las mayusculas las pone
 * `hsvToHex`, y estan aqui porque el boton de "usar este color" compara el color
 * del cuadrado con el que ya esta elegido, y dos formas del mismo color
 * comparadas como distintas son un boton que se queda apagado con el color delante.
 */
export function hexDeHsv(h: number, s: number, v: number): string {
  return hsvToHex({ h, s, v });
}

/**
 * La tinta que se lee **encima** de un color: negro o blanco, el que mas contraste
 * tenga con el.
 *
 * El selector dibuja sobre el color elegido —el anillo del marcador y la tilde de
 * la pastilla que esta elegida—, y una tinta fija desaparece: el blanco en el
 * blanco de la esquina del cuadrado y el negro en la de abajo. **No busca un tono
 * intermedio** porque un gris se leeria en ninguno de los dos casos, que es
 * justo cuando hace falta que se lea.
 */
export function tintaDe(color: string): "#000000" | "#FFFFFF" {
  const hex = tagColorHex(color);
  return contrastRatio("#000000", hex) >= contrastRatio("#FFFFFF", hex)
    ? "#000000"
    : "#FFFFFF";
}
