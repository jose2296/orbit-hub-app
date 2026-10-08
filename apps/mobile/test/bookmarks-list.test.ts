import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";

const RAIZ = join(process.cwd(), "src");

function fuente(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8");
}

/**
 * La lista de bookmarks y sus dos entradas en el drawer, leidas en fuente.
 *
 * La pantalla pinta con React Native y cuelga de expo-router, y un test que
 * la montara seria un test de los mocks. Lo que se puede romper aqui es
 * estructural —el molde seguido a medias, un verbo de mas en el drawer, una
 * clave sin traducir— y eso se lee en el texto.
 */

describe("la lista sigue el molde sin inventar patrones", () => {
  const pantalla = fuente(join("app", "(app)", "bookmarks.tsx"));

  it("lee de useBookmarks con los tres filtros de ruta", () => {
    expect(pantalla).toContain("useBookmarks({");
    expect(pantalla).toContain("workspaceId");
    expect(pantalla).toContain("folderId");
    // El filtro por coleccion opcional, para reusar la lista dentro de una
    // coleccion —incluido el "unclassified" del inbox.
    expect(pantalla).toContain("collectionId");
    expect(pantalla).toContain('"unclassified"');
  });

  it("no reordena: el orden lo pone el hook", () => {
    // `updatedAt desc` vive en `sortBookmarks` (Task 1, probado en
    // `use-bookmarks.test.ts`). Un `.sort` aqui seria un segundo criterio
    // compitiendo con el primero, y el molde de notas tampoco ordena.
    expect(pantalla).not.toContain(".sort(");
  });

  it("no tiene pull-to-refresh, igual que el molde", () => {
    expect(pantalla).not.toContain("RefreshControl");
    expect(pantalla).not.toContain("refreshControl");
    expect(pantalla).not.toContain("onRefresh");
  });

  it("cada fila abre el lector con la forma del molde", () => {
    // La forma de `notes.tsx:170-172`, sin grupo en el string. El `chevron` **no**
    // se comprueba aca: es de la fila, que ahora es `components/bookmarks/link-row`
    // y la dibuja una sola vez para las tres pantallas.
    expect(pantalla).toContain('pathname: "/bookmark/[bookmarkId]"');
  });

  it("la fila muestra el estado de extraccion, que es lo que la distingue", () => {
    // Los cuatro estados, cada uno con palabra y con punto, y ahora **en la fila**:
    // son la misma fila para la lista, el inbox y la coleccion, asi que la palabra
    // y el color de un estado tienen un solo sitio. Si el contrato anade un quinto,
    // el `Record` de `link-row.tsx` rompe el typecheck antes que este test.
    const fila = fuente(join("components", "bookmarks", "link-row.tsx"));

    for (const estado of ["pending", "ready", "metadata_only", "failed"]) {
      expect(fila, `el estado ${estado}`).toContain(estado);
    }
    expect(fila).toContain("bookmarks.state.pending");
    expect(fila).toContain("leading={");
    // Y la pantalla monta esa fila y no la suya.
    expect(pantalla).toContain("LinkRow");
  });

  it("el vacio tiene copy propio", () => {
    expect(pantalla).toContain("EmptyState");
    expect(pantalla).toContain('t("bookmarks.empty.title")');
    expect(pantalla).toContain('t("bookmarks.empty.body")');
  });

  it("cada fila lleva su menu al lado, y la hoja la abre la pantalla", () => {
    // La fila compartida es la que pinta los tres puntitos, y la pantalla la que
    // pasa el enlace y cierra. Lo que la pantalla **no** decide es que acciones
    // salen, asi que no escribe ninguna: eso vive en el registro.
    expect(pantalla).toContain("LinkRow");
    expect(pantalla).toContain("onMenu=");
    expect(pantalla).toContain("EntityMenuSheet");
    expect(pantalla).toContain("setMenuAbierto");
    expect(pantalla).toContain("list-menu-");
  });
});

describe("el drawer lleva las dos entradas", () => {
  const menu = fuente(join("components", "layout", "drawer.tsx"));

  it("Bookmarks y Sin clasificar estan en DESTINATIONS con route y path", () => {
    expect(menu).toContain('route: "/(app)/bookmarks"');
    expect(menu).toContain('path: "/bookmarks"');
    expect(menu).toContain('route: "/(app)/unclassified"');
    expect(menu).toContain('path: "/unclassified"');
  });

  it("el inbox lleva badge condicional con testID propio", () => {
    // Calcado de la fila de invitaciones: solo cuando hay algo que contar.
    expect(menu).toContain("useUnclassifiedCount()");
    expect(menu).toContain("sinClasificar > 0");
    expect(menu).toContain('testID="drawer-unclassified-badge"');
  });

  it("el arbol Children sigue intacto", () => {
    // Las colecciones ahi son follow-up declarado: solo entradas de nivel
    // superior en esta tarea.
    expect(menu).toContain("function Children");
    const arbol = menu.slice(menu.indexOf("function Children"));
    expect(arbol).not.toContain("collection");
    expect(arbol).not.toContain("Collection");
  });
});

describe("los strings nuevos estan en las dos lenguas", () => {
  const claves = [
    "bookmarks.title",
    "bookmarks.empty.title",
    "bookmarks.empty.body",
    "bookmarks.state.pending",
    "bookmarks.state.ready",
    "bookmarks.state.metadata_only",
    "bookmarks.state.failed",
    "bookmarks.unclassifiedCount.one",
    "bookmarks.unclassifiedCount.other",
  ] as const;

  it("cada clave existe en es y en en, y ninguna queda vacia", () => {
    for (const clave of claves) {
      expect(dictionaries.es[clave], clave).toBeTruthy();
      expect(dictionaries.en[clave], clave).toBeTruthy();
    }
  });
});
