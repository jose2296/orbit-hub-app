import { clearSharedPayloads, getSharedPayloads } from "expo-sharing";

import { triggerExtract } from "@/lib/api/bookmarks";

export type UrlCompartida = {
  url: string;
  resto: string;
};

// Saca la primera URL de un texto compartido y deja el resto como titulo
// posible. Funcion pura a proposito: no toca nativo y se prueba sin movil.
export function sacarUrlDelTexto(texto: string): UrlCompartida | null {
  const hallada = /https?:\/\/[^\s]+/.exec(texto);
  if (!hallada) return null;
  // El dedo suele arrastrar el punto o la coma que cierra la frase.
  const url = hallada[0].replace(/[.,;:!?)\]]+$/u, '');
  const resto = texto.replace(hallada[0], '').trim().replace(/\s+/gu, ' ');
  return { url, resto };
}

// Lo que la Task 4 entrega y la hoja pinta. La URL ya viene extraida por
// sacarUrlDelTexto; title es lo que la persona escribio o lo que venia en el
// texto, y text el texto crudo por si hace falta.
export interface SharedPayload {
  url: string;
  title: string | null;
  text: string | null;
}

// Donde cae el enlace, tal cual lo resolvio el picker: la coleccion manda, y
// si se creo en el momento ya trae su carpeta.
export interface SharePlace {
  workspaceId: string | null;
  folderId: string | null;
  collectionId: string | null;
}

// El id del bookmark ya creado para este payload, o null si aun no se guardo.
// Una sola ranura y no un mapa: la hoja se abre para un share cada vez y se
// resetea al abrirse, asi que nunca hay dos payloads vivos a la vez.
let savedForPayload: string | null = null;

/** Deja el guard como nuevo. La hoja lo llama al abrirse para otro share. */
export function resetShareGuard(): void {
  savedForPayload = null;
}

// Lo que llego de fuera y todavia no se guardo, o null si no hay nada.
// Lee el primer payload del modulo nativo y saca la URL con
// `sacarUrlDelTexto`: vale para el arranque en frio (la ruta recien montada)
// y para el caliente (la ruta re-lee al enfocarse). Solo lee: limpiar es
// trabajo de `clearShare` despues de guardar, nunca de aqui. Si se limpiara
// al leer y el guardado fallara, el enlace se perderia para siempre.
export function takePendingShare(): SharedPayload | null {
  const [primero] = getSharedPayloads();
  if (!primero) return null;
  const parsed = sacarUrlDelTexto(primero.value);
  if (!parsed) return null;
  return {
    url: parsed.url,
    title: parsed.resto.length > 0 ? parsed.resto : null,
    text: primero.value,
  };
}

// Borra el payload nativo y deja el guard como nuevo. Se llama despues de
// guardar (`onSaved`), nunca al montar: reabrir la ruta sin haber guardado
// tiene que encontrar el enlace todavia ahi.
export function clearShare(): void {
  clearSharedPayloads();
  resetShareGuard();
}

// Guarda el enlace compartido en el destino del picker.
//
// El titulo viaja tal cual: si va vacio, el servidor lo rellena con el del
// enlace (fase 1, `title` default `''`). Nunca se inventa uno en el cliente.
//
// Doble defensa contra el doble tap: la hoja deshabilita el boton con
// `saving`, y aqui la segunda llamada devuelve el id ya creado sin volver a
// crear. El gesto rapido atraviesa una sola, asi que hacen falta las dos.
export async function createBookmarkFromShare(
  payload: SharedPayload,
  place: SharePlace,
  title: string,
): Promise<string> {
  if (savedForPayload !== null) return savedForPayload;
  if (!place.workspaceId) throw new Error("falta el espacio donde guardar");
  // Import perezoso a proposito: este modulo tambien trae `sacarUrlDelTexto`,
  // que se prueba en Node sin nativo, y el actions tira de expo-crypto. El
  // mock del test lo sigue viendo igual.
  const { createBookmarkAction } = await import("./actions");
  const id = await createBookmarkAction({
    workspaceId: place.workspaceId,
    folderId: place.folderId,
    collectionId: place.collectionId,
    url: payload.url,
    title,
    tags: [],
  });
  savedForPayload = id;
  void triggerExtract(id);
  return id;
}
