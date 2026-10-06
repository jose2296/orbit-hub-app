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

  it("borrar usa la hoja compartida, con su papelera por fila", () => {
    // La confirmacion vive en `BookmarkDeleteSheet` (compartida con la
    // lista) y no duplicada aqui: la pantalla solo abre y cierra.
    expect(pantalla).toContain("BookmarkDeleteSheet");
    expect(pantalla).toContain("setABorrar");
    expect(pantalla).toContain("inbox-delete-");
    expect(pantalla).not.toContain("deleteBookmarkAction");
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
    // discrepe es 422. Asi que cada `updateBookmarkAction` de esta hoja solo
    // puede llevar `collectionId`.
    const llamadas = hoja.match(/updateBookmarkAction\(\{[^}]*\}\)/g);
    expect(llamadas?.length).toBeGreaterThan(0);
    for (const llamada of llamadas ?? []) {
      expect(llamada).toContain("collectionId");
      expect(llamada).not.toContain("folderId");
    }
  });

  it("crear la coleccion clasifica sin pedir confirmar otra vez", () => {
    expect(hoja).toContain("createCollectionAction");
  });

  it("el espacio no se pregunta: lo pone el bookmark", () => {
    expect(hoja).toContain("bookmark.workspaceId");
  });
});

describe("la confirmacion de borrado, compartida por inbox y lista", () => {
  const hoja = fuente(join("components", "bookmarks", "delete-sheet.tsx"));

  it("borra con tombstone y doble boton, sin tocar listas", () => {
    // `deleteBookmarkAction` existe desde la Task 3: verificado en
    // `lib/bookmarks/actions.ts`, no asumido del reporte. La fila desaparece
    // sola al releer la suscripcion, la hoja no toca ninguna lista.
    expect(hoja).toContain("deleteBookmarkAction");
    expect(hoja).toContain("bookmarks.deleteConfirm");
    expect(hoja).toContain("bookmarks.deleteBody");
    expect(hoja).toContain('variant="danger"');
    expect(hoja).toContain('variant="ghost"');
    expect(hoja).toContain("common.cancel");
    expect(hoja).toContain("useLastValue");
  });

  it("las dos pantallas la usan y ninguna duplica", () => {
    const inbox = fuente(join("app", "(app)", "unclassified.tsx"));
    const lista = fuente(join("app", "(app)", "bookmarks.tsx"));

    for (const [nombre, pantalla] of [
      ["inbox", inbox],
      ["lista", lista],
    ] as const) {
      expect(pantalla, nombre).toContain("BookmarkDeleteSheet");
      expect(pantalla, nombre).not.toContain("deleteBookmarkAction");
    }
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
