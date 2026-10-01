/**
 * Where you are and where you are going, in the "where does this go" panel.
 *
 * A separate module for the same reason `fileable-spaces.ts` is one: this is the part of
 * the panel that can be checked without rendering React Native, and rendering React
 * Native does not happen in the test environment.
 *
 * The rule it exists to hold up: **looking at a folder is not choosing it.** They were
 * one variable, so tapping a folder to see whether it was the right one put the thing
 * in it. And there was no way back up, so browsing three folders deep left you able to
 * see where you were and not change your mind.
 */
export interface CarpetaDelArbol {
  id: string;
  name: string;
  parentId: string | null;
  workspaceId: string;
}

/** What the panel is showing, and what it would file. They are not the same. */
export interface Recorrido {
  /** The folder the list is looking **inside**. `null` is the root of the space. */
  mirandoEn: string | null;
  /** The folder it would be **filed in**, and the only one that is sent. */
  elige: string | null;
}

export const EN_LA_RAIZ: Recorrido = { mirandoEn: null, elige: null };

/** Switching space throws the whole thing away: a folder id from another space is meaningless. */
export function cambiaDeEspacio(): Recorrido {
  return EN_LA_RAIZ;
}

/** Choosing where to file it. Does not move the list, which stays where you were looking. */
export function eligeCarpeta(actual: Recorrido, carpetaId: string | null): Recorrido {
  return { ...actual, elige: carpetaId };
}

/** Stepping into a folder to see inside it. The choice so far is kept. */
export function entraEn(actual: Recorrido, carpetaId: string): Recorrido {
  return { ...actual, mirandoEn: carpetaId };
}

/**
 * Back out one level, to the top of the space if there is nowhere further to go.
 *
 * `null` when you are already at the root, which is the caller saying there is no
 * "up" row to draw. Note that going up does not change the choice: having looked in
 * `Viajes/2026` and gone back does not un-file it.
 */
export function subeUnNivel(actual: Recorrido, padreDe: (folderId: string) => CarpetaDelArbol | null): Recorrido {
  if (actual.mirandoEn === null) return actual;
  return { ...actual, mirandoEn: padreDe(actual.mirandoEn)?.id ?? null };
}

/** Only the folders worth offering a "look inside" button on. */
export function tieneCarpetasAdentro(
  carpeta: CarpetaDelArbol,
  hijosDe: (workspaceId: string, parentId: string) => CarpetaDelArbol[],
): boolean {
  return hijosDe(carpeta.workspaceId, carpeta.id).length > 0;
}
