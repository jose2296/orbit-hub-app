import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";

const RAIZ = join(process.cwd(), "src");

function fuente(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8");
}

/**
 * El inbox y su triage, leidos en fuente.
 *
 * La pantalla pinta con React Native y cuelga de la cache, y un test que la
 * montara seria un test de los mocks (dicho en `bookmarks-list.test.ts` y
 * vale aqui). Lo que se puede romper —el filtro equivocado, el contador de
 * otra fuente, un `folderId` mandado a mano que el servidor devuelve con 422—
 * se lee en el texto.
 */

describe("el inbox es una vista agrupada por espacio", () => {
  const pantalla = fuente(join("app", "(app)", "unclassified.tsx"));

  it("pide los sin-coleccion cruzando espacios", () => {
    // Sin filtro de espacio: cruzando espacios, que es lo que hace que sea
    // una vista y no un lugar. El regex mira solo la llamada al hook, porque
    // `bookmark.workspaceId` aparece en el resto del archivo y es de otra
    // cosa (el triage, que si necesita saber de que espacio es cada fila).
    const llamada = pantalla.match(/useBookmarks\(\{[^}]*\}\)/);
    expect(llamada?.[0]).toContain('"unclassified"');
    expect(llamada?.[0]).not.toContain("workspaceId");
  });

  it("el contador sale de la misma fuente que el badge del drawer", () => {
    // El drawer cuenta con `useUnclassifiedCount()` sin argumento; si esta
    // pantalla contara de otra forma, los dos numeros difieren.
    expect(pantalla).toContain("useUnclassifiedCount()");
  });

  it("agrupa por espacio sin reordenar", () => {
    expect(pantalla).toContain("agruparHuerfanos");
    // El orden lo pone el hook (`updatedAt desc`). Un `.sort` aqui seria un
    // segundo criterio compitiendo con el primero.
    expect(pantalla).not.toContain(".sort(");
  });

  it("tocar una fila abre el triage sin salir", () => {
    expect(pantalla).toContain("AssignSheet");
    expect(pantalla).toContain("setAClasificar");
  });

  it("borrar pasa por el menu del registro, no por una hoja propia", () => {
    // La fila ofrece los tres puntitos y la hoja decide que sale: renombrar y
    // eliminar, con el cuerpo de confirmacion en `DeletePage`. La pantalla solo
    // abre y cierra el menu, asi que no escribe ninguna accion ni ninguna
    // confirmacion —y esa es la parte que se puede duplicar sin que nadie lo note.
    expect(pantalla).toContain("EntityMenuSheet");
    expect(pantalla).toContain("menuCtxDeBookmark");
    expect(pantalla).toContain("handlersDeBookmark");
    expect(pantalla).toContain("setMenuAbierto");
    expect(pantalla).toContain("inbox-menu-");
  });

  it("el vacio tiene copy propio", () => {
    expect(pantalla).toContain("EmptyState");
    expect(pantalla).toContain('t("bookmarks.inbox.empty.title")');
    expect(pantalla).toContain('t("bookmarks.inbox.empty.body")');
  });
});

describe("el triage manda solo la coleccion", () => {
  const hoja = fuente(join("components", "bookmarks", "assign-sheet.tsx"));

  it("es hoja nueva que reusa el picker, no un modo del guardar", () => {
    // Decision escrita en el componente: adaptar `ShareSaveSheet` (guard de
    // doble-guardado, `onSaved` con navegacion) a reasignar es mas friccion
    // que una hoja chica. Si convergen, fusionar es borrar una.
    expect(hoja).toContain("PlacePicker");
    expect(hoja).not.toContain("share-intent");
    // La decision escrita en el comentario nombra a `ShareSaveSheet` para
    // explicar por que no se reusa: lo que no puede haber es importarla.
    expect(hoja).not.toMatch(/from.*[Ss]hare[Ss]ave/);
  });

  it("ninguna llamada de clasificar menciona folderId", () => {
    // El `folderId` lo deriva el servidor de la coleccion: mandarlo y que
    // discrepa es 422. Asi que cada `updateBookmarkAction` de esta hoja solo
    // puede llevar `collectionId`.
    //
    // `workspaceId` si aparece, y solo cuando el espacio cambio: no es una
    // clasificacion, es una mudanza, y el servidor la valida en el destino.
    // Partiendo del marcador y no con un regex sobre el objeto: `[^}]*` se corta
    // en la primera llave, y el spread condicional de `workspaceId` tiene una
    // dentro. Asi que se recorta hasta el `});` que cierra cada llamada.
    const trozos = hoja.split("updateBookmarkAction({").slice(1);
    expect(trozos.length).toBeGreaterThan(0);
    for (const trozo of trozos) {
      const llamada = trozo.slice(0, trozo.indexOf("});"));
      expect(llamada).toContain("collectionId");
      expect(llamada).not.toContain("folderId");
      // Y si manda espacio, lo manda condicional —no un valor fijo—, porque un
      // guardar que no mudara no tiene por que parecer una mudanza en el diff.
      if (llamada.includes("workspaceId")) {
        expect(llamada).toMatch(/espacioId !== bookmark\.workspaceId/);
      }
    }
  });

  it("crear la coleccion clasifica sin pedir confirmar otra vez", () => {
    expect(hoja).toContain("createCollectionAction");
  });

  it("el espacio no se pregunta: lo pone el bookmark", () => {
    expect(hoja).toContain("bookmark.workspaceId");
  });
});

describe("los strings nuevos estan en las dos lenguas", () => {
  const claves = [
    "bookmarks.inbox.empty.title",
    "bookmarks.inbox.empty.body",
    "bookmarks.assign.title",
    "bookmarks.assign.hint",
    "bookmarks.assign.confirm",
    "bookmarks.delete.title",
    "bookmarks.deleteConfirm",
    "bookmarks.deleteBody",
  ] as const;

  it("cada clave existe en es y en, y ninguna queda vacia", () => {
    for (const clave of claves) {
      expect(dictionaries.es[clave], clave).toBeTruthy();
      expect(dictionaries.en[clave], clave).toBeTruthy();
    }
  });

  it("el espanol no lleva tildes", () => {
    const tildes = /[áéíóúÁÉÍÓÚñÑ]/;
    for (const clave of claves) {
      expect(dictionaries.es[clave], clave).not.toMatch(tildes);
    }
  });
});
