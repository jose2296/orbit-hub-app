import type { SharedPayload } from "./share-intent";
import { sacarUrlDelTexto } from "./share-intent";

// Donde la pagina /share-target guarda lo que el service worker dejo en la
// query (title/text/url). El SW no tiene localStorage, asi que pasa el share
// por la URL; la pagina lo consume una sola vez al guardarlo aqui y despues
// manda este almacen, para que recargar no duplique ni pierda.
export const CLAVE_SHARE_WEB = "orbithub:pending-share-web";

// Lo que expo-router entrega en useLocalSearchParams para title/text/url: un
// string, varias veces el mismo param, o nada.
export interface QueryShareWeb {
  title?: string | string[] | null;
  text?: string | string[] | null;
  url?: string | string[] | null;
}

function primero(valor: string | string[] | null | undefined): string {
  if (Array.isArray(valor)) return (valor[0] ?? "").trim();
  return (valor ?? "").trim();
}

// Dice si la URL trae query de share que consumir. La pagina lo usa para
// elegir: con query se parsea y se guarda; sin ella se lee el almacen.
export function hayQueryShare(query: QueryShareWeb): boolean {
  return (
    primero(query.title).length > 0 ||
    primero(query.text).length > 0 ||
    primero(query.url).length > 0
  );
}

// Query -> payload. El orden es url, texto y titulo: lo primero que traiga
// una URL gana. La extraccion es `sacarUrlDelTexto` de la fase 3, importada
// y no copiada: dos copias de "donde esta la URL en este texto" divergen en
// silencio. El titulo que mando el navegador manda sobre el resto del texto.
export function parsearQueryShare(query: QueryShareWeb): SharedPayload | null {
  const titulo = primero(query.title);
  const texto = primero(query.text);
  const url = primero(query.url);
  const candidatos = [url, texto, titulo].filter((c) => c.length > 0);
  for (const crudo of candidatos) {
    const hallado = sacarUrlDelTexto(crudo);
    if (!hallado) continue;
    const resto = hallado.resto.length > 0 ? hallado.resto : null;
    return {
      url: hallado.url,
      title: titulo.length > 0 ? titulo : resto,
      text: crudo === url ? (texto.length > 0 ? texto : null) : crudo,
    };
  }
  return null;
}

// El trozo de localStorage que la pagina necesita, con el almacen inyectado
// para poder probarse en Node. Sin almacen (nativo, o prerender del export)
// todo es no-op o null: la pagina pinta "nada que guardar".
export interface AlmacenWeb {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

function almacenPorDefecto(): AlmacenWeb | null {
  try {
    const local = (globalThis as unknown as { localStorage?: AlmacenWeb })
      .localStorage;
    return local ?? null;
  } catch {
    return null;
  }
}

export function guardarShareWeb(
  payload: SharedPayload,
  almacen: AlmacenWeb | null = almacenPorDefecto(),
): void {
  if (!almacen) return;
  try {
    almacen.setItem(CLAVE_SHARE_WEB, JSON.stringify(payload));
  } catch {
    // Cuota llena o acceso negado: el share se pierde al recargar, pero la
    // pagina sigue pintando la hoja con el payload en memoria.
  }
}

// Lee el pendiente o null si no hay nada, el JSON esta roto o no trae una
// url valida. Nunca revienta: un almacen corrupto es "nada que guardar".
export function leerShareWeb(
  almacen: AlmacenWeb | null = almacenPorDefecto(),
): SharedPayload | null {
  if (!almacen) return null;
  let crudo: string | null = null;
  try {
    crudo = almacen.getItem(CLAVE_SHARE_WEB);
  } catch {
    return null;
  }
  if (!crudo) return null;
  try {
    const parsed = JSON.parse(crudo) as Partial<SharedPayload>;
    if (typeof parsed.url !== "string" || parsed.url.trim().length === 0) {
      return null;
    }
    return {
      url: parsed.url,
      title: typeof parsed.title === "string" ? parsed.title : null,
      text: typeof parsed.text === "string" ? parsed.text : null,
    };
  } catch {
    return null;
  }
}

export function borrarShareWeb(
  almacen: AlmacenWeb | null = almacenPorDefecto(),
): void {
  if (!almacen) return;
  try {
    almacen.removeItem(CLAVE_SHARE_WEB);
  } catch {
    // Si no se pudo borrar, el pendiente sigue ahi y la pagina lo muestra
    // de nuevo: molesto pero nunca una perdida silenciosa.
  }
}
