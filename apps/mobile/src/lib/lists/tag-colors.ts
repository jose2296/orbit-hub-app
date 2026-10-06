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
import { ITEM_ICON_COLORS } from "@orbit-hub/contracts";

import { iconColorHex } from "@/theme/tokens";

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
 * **3, y el numero no sale de aqui: es el de las insignias de prioridad.** Los
 * cuatro tonos que la app ya tiene dan 3.00 (`success`), 3.25 (`warning`), 4.15
 * (`danger`) y 4.44 (`info`) sobre su propio lavado, y una etiqueta que se
 * parece a una insignia con un liston distinto de su insignia no se parece.
 *
 * **Bajarlo a 3 fue una decision, y esta es la nota que la sostiene.** El texto
 * de la pastilla es `caption`: 12 px. WCAG llama "texto grande" a 18 px, o a
 * 14 px en negrita, y ahi el minimo es 3:1; a 12 px le tocaria 4.5:1. **El peso
 * en negrita no cambia eso**: sigue siendo 12 px, y el bold ayuda a leer pero no
 * mueve el umbral. Asi que el 3 de aqui **no es un atajo que da el bold**, es el
 * liston de las insignias, voluntariamente, para que las dos cosas se lean igual.
 *
 * **Lo que se acepta a cambio, medido:** el texto de una pastilla esta entre 3 y
 * 4.5 de contraste, y en el peor tono de la paleta se queda en 3.0. Es el mismo
 * margen que arrastra `success` desde antes de que existiera este fichero, y la
 * pastilla se ha elegido con el a proposito. Quien necesite 4.5 en todas las
 * etiquetas tiene que subir `MEZCLA_DE_LA_PASTILLA`: el relleno mas lejos del
 * color deja mas recorrido al texto.
 *
 * **El numero va aqui y no en el componente**, porque es una regla y no una
 * constante de JSX: si el umbral lo elige quien pinta, el umbral es el que le
 * conviene a quien pinta. Y el test lo escribe a mano en vez de leerlo de aqui,
 * a proposito —lo bajan los dos a la vez si lo lee— para que aflojarlo sea un
 * test rojo y no un cambio de postura.
 */
export const MIN_LABEL_CONTRAST = 3;

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
 * El relleno es **el color mezclado con la superficie al 6%**, un tinte, como el
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
 * **Lo que se ve, medido, y no es lo que uno esperaría: el texto se queda cerca.**
 * Con el relleno al 6% —pegado al color elegido— para llegar a `MIN_LABEL_CONTRAST`
 * la cuenta recorre camino corto y el texto se queda en el mismo tono. Consecuencias,
 * todas medidas sobre los doce con las superficies reales (`#F0F2F8` y `#1B2231`):
 *
 * - **Ninguno de los doce sale por debajo de luminancia 0.036** en ninguno de los dos
 *   esquemas, ni se va al extremo blanco. Antes, al 14% con listón 4.5, once de los
 *   doce en claro caían por debajo de ese 0.036 —indistinguibles de negro— y `teal` en
 *   oscuro salía en `#FDFFFF`.
 * - El texto sí es del tono elegido: `green` en `#0B5225`, `teal` en `#06403A`,
 *   `purple` en `#3A0A65`. Son oscuros, pero son **verde, verde azulado y violeta**, y
 *   no el negro que salía antes. En negrita se leen como el texto de color de una
 *   insignia, que es de donde salio la peticion.
 *
 * **Y el relleno es mucho mas visible que el de una insignia.** Va de **2.55 a 5.59**
 * de contraste contra la superficie en claro, y de 2.12 a 4.72 en oscuro, donde el
 * lavado de una insignia esta entre 1.00 y 1.07. Es el otro lado de la misma cuenta:
 * cuanto mas pegado esta el relleno al color, mas se ve, y a la vez mas tiene que
 * alejarse el texto. Las dos cosas se mueven juntas y en sentidos opuestos, y por eso
 * este numero es el que decide el aspecto y no otro.
 *
 * **Que el extremo puro salga, sale; en cuantos casos, no se dice aqui a proposito.**
 * Un porcentaje de eso depende de la rejilla que se mida y de si se divide por
 * llamadas o por colores distintos, y salia distinto segun con cual: no describe la
 * funcion, describe la muestra. Lo que si es cierto sin medirse es que **el bucle
 * para en cuanto el contraste pasa**, asi que el texto de una pastilla nunca queda
 * por encima de `MIN_LABEL_CONTRAST` mas de un paso —el del propio paso— y por eso
 * el minimo sale pegado a la linea y no holgado.
 *
 * **O sea: el color elegido se reconoce en el relleno y no en el texto.** No es el
 * mismo tono del color elegido —no lo es, y el que diga lo contrario esta
 * equivocado—, es el tono mas cercano al color elegido que todavia se lee. La
 * garantia de que se lee es total; la de que se parece, no, y esa es la diferencia
 * con la puerta anterior: **antes el texto era un color que nadie habia elegido**,
 * el del tema, y ahora es el de la persona, movido. Sigue siendo mejor, pero no es
 * lo mismo, y conviene no contarlo como si lo fuera.
 *
 * **Y lo que queda de recorrido son esos puntos, no el paso de la cuenta**, y por
 * eso la mezcla importa mas que el paso. Afinar el paso **no alarga el viaje**: la
 * cuenta sale en cuanto un candidato pasa, asi que un paso mas fino cae en un
 * candidato **que pasa igual de facil, y a veces en el mismo hex** —la rejilla fina
 * contiene a la gruesa, y el mismo punto esta en las dos—, y siempre por encima de
 * la linea —el bucle solo devuelve dentro del `if` que la exige, asi que "por
 * debajo" no puede salir—. Lo que **no** se puede decir es que el paso mas fino
 * caiga siempre en otro hex, ni que el contraste baje: eso depende del color, y si
 * el viaje se da la vuelta **no lo decide el paso sino `clamp01`, que es monotono y
 * no puede dar marcha atras**.
 *
 * **Quien quiera que el texto se parezca mas al color elegido tiene una sola palanca
 * y es `MEZCLA_DE_LA_PASTILLA`, y ahora apunta al lado contrario de antes.** Bajarla
 * **acerca el relleno a la superficie**, y eso deja al texto mas sitio: es lo que
 * paso al bajar del 14% al 6%, y por eso el texto salio del negro. Subirla acerca
 * el relleno al color y acorta el viaje, con lo cual el texto se va otra vez hacia
 * el extremo. El 6% es un punto entre las dos cosas, no el final de un recorrido.
 *
 * **El numero que dice por que el texto puede ser el color es el de la marca.**
 * `success` `#0E9F6E` mide **3.00:1** sobre su lavado `successSoft`, y es el valor
 * mas flojo de los cuatro tonos: la puerta de contraste de este repo se construyo
 * para las etiquetas y nunca se aplico a las insignias, asi que la insignia de
 * `success` lleva años en 3.00 y nadie lo ha arreglado. `MIN_LABEL_CONTRAST` esta en
 * 3 porque **`dangerSoft` da 4.15, `warningSoft` 3.25 y `infoSoft` 4.44** —el mas
 * flojo de los cuatro es 3.00—, y una pastilla que se parece a una insignia no
 * puede traer un liston que las insignias no tienen. Esa es la cuenta entera, y no
 * sale de este archivo: sale de `badge.tsx` y de los tokens del tema.
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

  // **La vuelta, y por que el 6% la hace MAS necesaria y no menos.** Se baje la
  // mezcla y se baje el liston, y esta vuelta se sigue necesitando, y el 6% es
  // justo lo que la hace mas frecuente. La razon esta en como esta escrita la
  // llamada al mixing, y se ha leido al reves en este mismo comentario dos veces:
  //
  //   mixHex(hex, surface, MEZCLA) interpola **de hex hacia surface**, asi que
  //   `t = 0.06` es "6% hacia la superficie" —el relleno se queda **cerca del color
  //   elegido**— y `t = 0.14` era "14% hacia la superficie", o sea un relleno mas
  //   lavado. **Bajar el numero hace el relleno MAS oscuro, no mas claro.**
  //
  // Con `#000000` sobre la superficie clara del tema: al 14% el relleno era
  // `#222223` y al **6% es `#0E0F0F`**, mas negro todavia. El negro sobre ese relleno
  // da **1.09:1** y hace falta la vuelta, que es lo que hace que ese color se lea.
  //
  // Asi que el caso que la vuelta cubre es el **negro puesto a mano en tema claro**, y
  // el 6% lo hace mas seguro que el 14%: cuanto mas cerca del color el relleno, menos
  // tiene que alejarse el texto y mas facil es que la primera vuelta se quede corta.
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
      // cuenta pisa el extremo, el candidato es identico y su verdicto tambien, de
      // modo que los pasos que quedan solo podrian repetir el "sigue sin pasar" que
      // acaba de salir.
      //
      // Y lo que verifica que ningun hex se mueve es **`los doce colores de la
      // paleta salen exactamente en estos hex`**, en `tag-colors.test.ts`: el que
      // clava que color sale. **La rejilla de 227 colores no lo verifica** —comprueba
      // que todo llega a `MIN_LABEL_CONTRAST`, y a un `PASO` distinto llegaria igual
      // con otros hex y la suite seguiria verde—, asi que si esto se documentara otra
      // vez, que sea la tabla y no la rejilla.
      if (objetivo === 0 || objetivo === 1) {
        break;
      }
    }
  }

  /*
   * **Aqui no se llega, y es una property, no una costumbre.** La cuenta de arriba
   * tiene que encontrar un tono que pase, y por la aritmetica del comentario de
   * antes no puede fallar: el extremo de la unica vuelta siempre pasa, siempre, para
   * cualquier hex. Este `throw` es la prueba de que eso no ha cambiado.
   *
   * Con `PASOS_DE_LUMINOSIDAD = 60` y un paso de 0.02, la cuenta pasa de largo el
   * extremo —`l` esta entre 0 y 1 y 60 pasos son 1.2— asi que los dos extremos
   * absolutos, **negro y blanco, son candidatos siempre**: el `clamp01` los entrega
   * en cuanto la cuenta los pisa, y con la saturacion del color que sea, porque
   * `hslToHex(h, s, 0)` da `#000000` y `hslToHex(h, s, 1)` da `#FFFFFF` para
   * cualquier `h` y cualquier `s`.
   *
   * Y **de esos dos, uno siempre se lee**. Aqui `L` es la **luminancia relativa de
   * WCAG** —la de `luminanceDe`, de 0 a 1— y **no** la `l` de HSL que se mueve
   * arriba. Las dos van de 0 a 1 y **no son la misma magnitud**, asi que leer una
   * como la otra cambia la cuenta: el relleno `#CE7209` del `amber` en oscuro tiene
   * una luminosidad HSL de **0.53** y una luminancia de WCAG de **0.318**, y con el
   * uno la cuenta sale 8.13:1 y con el otro 3.11:1. **Ninguna de las dos magnitudes
   * esta dos veces lejos de la otra**, asi que lo que hace el cambio no es un factor
   * sino que **miden cosas distintas**: la `l` de HSL es un `(max + min) / 2` sobre
   * los canales, o sea **una media sin pesos de solo los dos extremos, y el canal del
   * medio no cuenta para nada** —en `#CE7209` mandan el rojo y el verde—, mientras
   * que WCAG reparte 0.2126 / 0.7152 / 0.0722 entre los tres. Por eso los dos numeros
   * no se pueden leer el uno por el otro ni aunque los dos vayan de 0 a 1. El negro
   * pasa de 3:1 sobre cualquier relleno con `L >= 0.300` y el blanco sobre cualquiera
   * con `L <= 0.100` —las dos bandas salen de `(L + 0.05) / 0.05`, y **no se pisan**:
   * entre 0.100 y 0.300 las dos pasan—, asi que no hay ningun relleno contra el que
   * los dos extremos fallen a la vez.
   *
   * Ese es el argumento entero, y por eso la funcion no tiene un `return` de
   * emergencia: si se llegara aqui, seria porque el paso o el numero de pasos ya no
   * alcanzan el extremo, que es un typecheck y no una pastilla gris. El `throw` de
   * abajo es ese typecheck, escrito como codigo.
   *
   * Ese es el motivo por el que **la puerta de contraste se borra y no se mueve**:
   * antes la unica salida a un color ilegible era el color del tema, que es un color
   * que nadie eligio, y esa es la cuenta que hacia falta. Con la geometria de arriba
   * —y con el producto de los dos contrastes valiendo 21 para cualquier relleno— el
   * tema no aparece por ningun lado: **no hay ningun hex del mundo que no tenga un
   * tono suyo que se lea**, y por eso no hace falta el plan B. Para cambiar el
   * liston habria que tocar `PASO_DE_LUMINOSIDAD` o `PASOS_DE_LUMINOSIDAD`, y las dos
   * cosas estan escritas justo encima.
   */
  throw new Error(
    `labelPillColors: ningun extremo alcanza ${MIN_LABEL_CONTRAST}:1 — revisa el paso`,
  );
}

/**
 * Cuanto se mezcla el color de una pastilla con la superficie.
 *
 * **6%, y no un token**: es la proporción de una insignia contra su fondo, no una
 * distancia de la retícula de la app, así que no pertenece a `theme.spacing` —que no
 * tiene números entre 1 y 2— sino a la regla que la usa. Subirlo o bajarlo cambia
 * los doce rellenos de la app a la vez, así que es un número que se cambia aquí y
 * con un motivo, no en el componente.
 *
 * **Bajó de 14% a 6%, y el motivo es que el color se vea más, no menos.**
 * `mixHex(hex, surface, t)` interpola **de `hex` hacia `surface`**, así que `t = 0.06`
 * es "6% hacia la superficie": el relleno se queda **pegado al color elegido**. Bajar
 * el número hace el relleno más del color, que es lo que quería quien lo pidió —un
 * fondo "un poco más fuerte" del mismo tono— y no al revés.
 *
 * **Lo que cuesta, medido, y es menos de lo que parecía.** Con el 14% el texto tenía
 * que recorrer tanto camino en la luminosidad que salía casi negro —once de los doce
 * por debajo de luminancia 0.036, indistinguibles de negro a los ojos— y una etiqueta
 * cuyo color no puedes ver en el texto no se parece a una insignia, que sí enseña el
 * suyo: `success` escribe `#0E9F6E`, que es verde, no negro. Con el relleno al 6%
 * **ninguno de los doce sale por debajo de 0.036** —medido, cero de doce en los dos
 * esquemas— y el color elegido se reconoce en el texto además de en el relleno:
 * `green` da `#0B5225` y `teal` `#06403A`, que son verde y verde azulado.
 *
 * **Y la otra mitad de lo que se pidió también se cumple por el mismo número.** Con
 * el relleno casi igual al color, el texto tiene que irse hacia el extremo contrario,
 * y de ahi el peso: `TagChip` pinta el texto en **negrita**, que es lo que hace que
 * una etiqueta de 12 px con 3:1 se lea como una insignia y no como una nota al pie.
 *
 * **Lo que este número NO hace es esconder el relleno, y conviene no creerlo.** El
 * lavado de una insignia está entre 1.00 y 1.04 de contraste contra la superficie
 * —casi invisible, que es lo que la hace parecer texto de color— y el relleno de una
 * pastilla al 6% va de **2.55 a 5.59**: se ve unas cinco veces más. Es lo que se
 * pidió y es lo que hay; la semejanza con la insignia está en **el texto del mismo
 * tono en negrita**, no en un relleno que se esconda.
 */
const MEZCLA_DE_LA_PASTILLA = 0.06;

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
 * numero.** Acercar el texto al color elegido se hace con `MEZCLA_DE_LA_PASTILLA`, que
 * esta justo encima. Aqui 2 es la resolucion con la que la cuenta encuentra el sitio, y
 * llega a un color que se puede leer en el codigo sin mas decimales de los necesarios.
 *
 * **Y si cambia este numero, la tabla lo dice.** `los doce colores de la paleta
 * salen exactamente en estos hex`, en `tag-colors.test.ts`, clava que color sale de
 * los doce en los dos esquemas: es el unico sitio al que puede mirar este comentario
 * para saber que el cambio no movio nada. **La rejilla de 227 colores no lo clava**,
 * porque solo mira que todo llegue a `MIN_LABEL_CONTRAST`.
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
  const esDeLaPaleta = (ITEM_ICON_COLORS as readonly string[]).includes(nombre);
  return esDeLaPaleta ? iconColorHex(nombre, "light") : iconColorHex("neutral", "light");
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
 * **El `Number.isFinite` de este `t` era necesario porque `clamp01` no limpiaba un
 * `NaN`, y ahora es redundante porque `clamp01` si lo limpia.** Antes `clamp01`
 * era `Math.min(Math.max(valor, 0), 1)`, y las tres de `Math` devuelven `NaN`
 * cuando una entrada es `NaN`, asi que un `t` de `NaN` llegaba a `Math.round`,
 * `"NaN".toString(16)` es la cadena `"NaN"`, y el retorno era literalmente
 * **`#NANNANNAN`** —diez caracteres: nueve cifras, donde un `#RRGGBB` tiene seis,
 * y ninguna hexadecimal—. Ese retorno no lo dibuja nadie: **ningun** parser de
 * CSS puede leer una declaracion de color asi, la declaracion se descarta sin un
 * error y el elemento se queda con lo que ya habia pintado. Medido antes del
 * arreglo, no supuesto.
 *
 * **El guard se queda puesto de todos modos, y esa es la decision que se quiere
 * ver.** `clamp01` ahora responde `0` ante un `NaN`, asi que `clamp01(t)` da
 * exactamente lo mismo que este `Number.isFinite`: quitarlo no cambia ni un hex.
 * Se deja porque aqui la garantia se lee en la linea que la hace, y el dia que
 * `clamp01` vuelva a ser una cuenta de una linea sin `Number.isFinite` este `t`
 * sigue a salvo sin que nadie tenga que acordarse. Un guard que hoy no hace nada
 * y cuyo un trabajo es que no haga falta mañana.
 *
 * **Lo que este guard tiene en comun con el de `hslToHex` es el ternario y el
 * recorte, y los dos vigilan la suma hoy.** `hslToHex` ponia
 * `Number.isFinite(v) ? v : 0` **en el canal**, y `m = l - c / 2` se sumaba
 * despues: con una luminosidad `NaN` salia `#NANNANNAN` tambien —medido antes de
 * arreglarlo, `hslToHex(0, 1, NaN)`—, porque el guard estaba en el operando que no
 * podia hacer el dano. Era **latente y no vivo**: `aHex` rechaza todo lo que no sea
 * un hex, de modo que `rgbToHsl` no puede devolver una `l` que no sea finita y el
 * camino de la app nunca llegaba; lo que si era cierto es que el guard estaba en el
 * sitio equivocado. Arreglado en `hsl.ts`: el guard esta en la suma y los tres
 * parametros que no son numeros caen en `0`.
 *
 * **Y ahora `hslToHex` recorta tambien, con este mismo `clamp01`.** Antes de eso
 * solo lo hacia `mixHex`, y el motivo de que este lo hiciera era que el otro no:
 * una `s` de 5 o una `l` de 2 —finitas, sin nada roto— salian de `hslToHex` como
 * `#2FD-1FE-1FE` y `#FF2FD2FD`, o sea cadenas que ningun parser de CSS lee. Los
 * dos hacen ahora la misma cosa por el mismo motivo, que es la unica forma de que
 * un ternario de estos se pueda copiar sin preguntar antes por que.
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
