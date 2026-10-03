import type { TagColors } from "@orbit-hub/contracts";

import { luminanceDe } from "../workspace/wash";
import { iconColor } from "./item-icons";

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
