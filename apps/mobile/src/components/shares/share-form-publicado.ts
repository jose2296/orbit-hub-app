import { createContext, useContext } from "react";

/**
 * Lo que el **formulario de compartir** le publica a la hoja que lo contiene.
 *
 * Existe por una razon muy concreta, y es el mismo motivo por el que
 * `header-action.tsx` existe: el boton de enviar vive en `ShareNodeForm` —que es
 * quien tiene el estado del formulario— y el Guardar del panel vive **arriba**, en
 * otro componente. Un contexto no fluye hacia arriba, asi que el hijo no puede
 * leer nada del padre: lo que hace es **publicar** y el padre lo pinta.
 *
 * Y **es el mismo patron que ya usa la app**: el hijo publica y el padre pinta, al
 * reves de que el padre declare el slot y el hijo lo rellene —que es lo que hace
 * que el layout gane siempre.
 */
export interface ShareFormPublicado {
  /** Sends it. The footer button calls this and nothing else. */
  enviar: () => void;
  /** Says why the button is off, or `undefined` when it is not. */
  motivo: string | undefined;
  /** Whether a send is in flight. */
  enviando: boolean;
}

/**
 * El canal por el que el formulario publica, y **solo el canal**.
 *
 * El contexto lleva la funcion `publicar` y no lo publicado, a proposito: si
 * llevara lo publicado, el wrapper leeria el contexto **por encima** del Provider
 * —que es donde el esta— y siempre obtendria `null`. El wrapper guarda lo
 * publicado en su propio estado, y el formulario lo escribe por aqui.
 */
export const ShareFormContexto = createContext<{
  publicar: (publicado: ShareFormPublicado | null) => void;
}>({ publicar: () => {} });

/** The publish channel, for the form to say what the footer's Save should do. */
export function useShareFormCanal(): (
  publicado: ShareFormPublicado | null,
) => void {
  return useContext(ShareFormContexto).publicar;
}