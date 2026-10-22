/**
 * Un toque en el texto de un dia abre el editor; un toque en un enlace lo abre a el.
 *
 * En movil el texto va dentro de un contenedor pulsable (para escribir con un toque) y la
 * libreria avisa de un enlace pulsado con su propio evento. Los dos llegan por la misma
 * pulsacion, en un orden que no se puede asumir, asi que el contenedor **espera un instante
 * y pregunta** si algun enlace avisó en ese tiempo, en vez de decidir en el acto.
 */

/** Lo que espera el contenedor antes de decidir si el toque era para escribir. */
export const PRESS_SETTLE_MS = 220;

/** Cuanto tiempo atras cuenta un aviso de enlace como "parte de este mismo toque". */
const SAME_PRESS_MS = 700;

export function shouldEnterEdit(lastLinkPressAt: number, now: number): boolean {
  return now - lastLinkPressAt > SAME_PRESS_MS;
}
