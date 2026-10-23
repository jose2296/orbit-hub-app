/**
 * El swipe entre dias, decidido a partir de los toques crudos de React Native.
 *
 * En Android el editor nativo le quita el toque al gesto de `react-native-gesture-handler`
 * (`begin` y despues `finalize ok=false`, sin desplazamiento), pero React Native sigue entregando
 * los eventos tactiles de la pagina entera: `touchStart`, todos los `touchMove` y `touchEnd`. Asi
 * que en un movil el swipe se decide aqui, sin pelear con el editor, y funciona escribiendo o no.
 */

/** Lo que se ha movido el dedo antes de saber si es un swipe, un scroll o un toque. */
const DECIDE_AFTER = 12;
const SWIPE_FRACTION = 0.25;
const FLICK_VELOCITY = 700;

export type DragKind = "undecided" | "horizontal" | "vertical";

/**
 * Que esta haciendo el dedo, dado lo que se ha movido desde que toco. Se decide una vez y no se
 * reconsidera: un scroll que se tuerce no se convierte en un cambio de dia.
 */
export function classifyDrag(dx: number, dy: number): DragKind {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < DECIDE_AFTER && ay < DECIDE_AFTER) return "undecided";
  // Sube mas que avanza (o casi): es scroll. Un swipe tiene que ser claramente horizontal.
  return ax > ay * 1.5 ? "horizontal" : "vertical";
}

/**
 * Hacia donde se va tras el arrastre: `1` el dia siguiente (se arrastro a la izquierda), `-1` el
 * anterior, `0` vuelve a su sitio. Cuenta la distancia (un cuarto de ancho) o un golpe rapido, y
 * un golpe en un sentido no gana a un arrastre en el contrario.
 */
export function swipeDirection(dx: number, velocityX: number, width: number): -1 | 0 | 1 {
  if (width <= 0) return 0;
  const far = Math.abs(dx) > width * SWIPE_FRACTION;
  const fast = Math.abs(velocityX) > FLICK_VELOCITY;
  if (dx < 0 && (far || (fast && velocityX < 0))) return 1;
  if (dx > 0 && (far || (fast && velocityX > 0))) return -1;
  return 0;
}
