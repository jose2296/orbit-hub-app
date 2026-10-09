import { describe, expect, it } from "vitest";

import { ACCIONES, ORDEN_POR_KIND } from "@/lib/menus/registry";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { src } from "./menus-test-helpers";

const INBOX = "src/app/(app)/unclassified.tsx";
const ADAPTADOR = "src/lib/menus/bookmark.ts";

describe("entrar a ver un enlace sin clasificar", () => {
  it("la fila del inbox lleva al lector, y no directo al sheet de clasificar", () => {
    const hoja = src(INBOX);
    // El pedido era literal: "que pueda entrar a dentro a verlos porque si no se
    // que es no puedo clasificarlos". Antes la fila abria `AssignSheet` de una, y
    // clasificar era a ciegas: no se veia el titulo, ni el sitio, ni el texto.
    expect(hoja).toMatch(/pathname: "\/bookmark\/\[bookmarkId\]"/);
    expect(hoja).toMatch(/params: \{ bookmarkId: bookmark\.id \}/);
  });

  it("clasificar esta en el menu de la fila, que es donde estÃ¡ la informacion", () => {
    // La fila dice el titulo y el sitio: ahi se puede clasificar con datos. En el
    // lector hacia falta montar la hoja del triage, y esa cadena rompe los dos
    // tests que renderizan el lector sin stubs de hoja — que es la senal de que
    // no era su sitio.
    expect(ORDEN_POR_KIND.bookmark).toContain("classify");
    expect(ACCIONES.classify?.destino).toEqual({ tipo: "hoja", handler: "clasificar" });
  });

  it("la accion solo la ofrece un enlace, y ninguna otra entidad", () => {
    // `classify` es de `bookmark` y de nadie mas: es la unica entidad que puede
    // quedar fuera de un sitio. Por kind y no por capacidad, porque la capacidad
    // la decide la pantalla y cualquier pantalla con un enlace puede clasificarlo.
    for (const kind of Object.keys(ORDEN_POR_KIND) as (keyof typeof ORDEN_POR_KIND)[]) {
      const declara = ORDEN_POR_KIND[kind].includes("classify");
      expect(declara, kind).toBe(kind === "bookmark");
    }
  });

  it("el handler es opcional: sin el, la fila no se ofrece", () => {
    // La fila de la lista no clasifica porque un enlace de la lista ya esta
    // clasificado. Una accion opcional que no llega es una fila que no se ofrece,
    // no un boton que falla — y por eso el adaptador mete el handler con un
    // spread condicional, no con un valor fijo.
    const adaptador = src(ADAPTADOR);
    expect(adaptador).toMatch(/\.\.\.\(clasificar \? \{ clasificar \} : \{\}\)/);
    // Y el inbox SI lo pasa, que es la pantalla donde clasificar tiene sentido.
    const hoja = src(INBOX);
    expect(hoja).toMatch(/handlersDeBookmark\(\s*menuAbierto,\s*menuAbierto/);
  });

  it("el copy de clasificar existe en los dos idiomas", () => {
    expect(dictionaries.es["bookmarks.classify"]).toBeTruthy();
    expect(dictionaries.en["bookmarks.classify"]).toBeTruthy();
    expect(dictionaries.es["bookmarks.classify"]).not.toBe(
      dictionaries.en["bookmarks.classify"],
    );
  });

  it("el lector NO monta la hoja del triage", () => {
    // Y esta es la razon por la que clasificar no quedo en el lector: montarla ahi
    // rompia `bookmark-final-fix` y `bookmark-reader`, que lo renderizan sin stubs
    // de la cadena de hojas.
    const lector = src("src/app/(app)/bookmark/[bookmarkId].tsx");
    expect(lector).not.toMatch(/assign-sheet/);
  });
});
