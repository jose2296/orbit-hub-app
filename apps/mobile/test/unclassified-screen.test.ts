import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bookmark } from "@orbit-hub/contracts";

// El inbox pinta con React Native y cuelga de expo-router, y ninguno de los
// dos existe en Node: se suplen los dos, igual que en
// `bookmark-reader.test.ts`. Los falsos pintan `div`/`span`/`button`, que es
// lo justo para afirmar que las 50 filas salen y en que grupo, sin fingir que
// esto es un movil.
const { estado } = vi.hoisted(() => ({
  estado: {
    bookmarks: [] as Bookmark[],
    isLoading: true,
    espacios: [
      { id: "w1", name: "Casa" },
      { id: "w2", name: "Calle" },
    ],
  },
}));

vi.mock("react-native", async () => {
  const React = await import("react");
  const View = ({ children, testID }: any) =>
    React.createElement("div", testID ? { "data-testid": testID } : null, children);
  const Text = ({ children }: any) => React.createElement("span", null, children);
  const Pressable = ({ children, testID }: any) =>
    React.createElement(
      "button",
      testID ? { "data-testid": testID } : null,
      children,
    );
  const ScrollView = ({ children }: any) =>
    React.createElement("div", null, children);
  const TextInput = () => React.createElement("input", null);
  return {
    View,
    Text,
    Pressable,
    ScrollView,
    TextInput,
    StyleSheet: {
      create: (styles: any) => styles,
      flatten: (style: any) => style,
      hairlineWidth: 1,
    },
    Platform: { OS: "web", select: (spec: any) => spec.web ?? spec.default },
  };
});

vi.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

// El tema real, sin el provider (que pide `expo-sqlite` y no carga en Node).
vi.mock("@/theme", async () => {
  const tokens = await import("../src/theme/tokens");
  const theme = tokens.createTheme("light", "orbit");
  return { useTheme: () => theme };
});

vi.mock("@/lib/i18n", async () => {
  const plural = await import("../src/lib/i18n/plural");
  return {
    // La clave tal cual: lo que importa es que clave sale, no su texto.
    useTranslation: () => (clave: string) => clave,
    pluralKey: plural.pluralKey,
  };
});

// Lo que `/lib/offline` promete y `use-bookmarks` importa: la cache real es
// `expo-sqlite` y en Node no existe. Mismo apunte que en
// `use-bookmarks.test.ts`.
vi.mock("@/lib/offline", () => ({
  getLocalStoreReady: vi.fn(),
  subscribeToLocalStore: vi.fn(() => () => undefined),
}));

// El filtro real y no una lista fija: la pantalla pide
// `collectionId: "unclassified"` y lo que vuelve es lo que la suscripcion
// relee tras cada escritura. Sin el, un test no podria huerfanar filas.
// (`@/lib/offline` ya esta anulado arriba, asi que el original carga sin
// `expo-sqlite`.)
vi.mock("@/hooks/use-bookmarks", async (importOriginal) => {
  const real = (await importOriginal()) as typeof import(
    "../src/hooks/use-bookmarks"
  );
  return {
    useBookmarks: (filtros: any) => ({
      bookmarks: real.applyBookmarkFilters(estado.bookmarks, filtros),
      isLoading: estado.isLoading,
    }),
    useUnclassifiedCount: () =>
      real.selectUnclassifiedBookmarks(estado.bookmarks).length,
  };
});

vi.mock("@/hooks/use-spaces-tree", () => ({
  useSpacesTree: () => ({ spaces: () => estado.espacios }),
}));

// Las acciones tocan la cache: aqui solo importa que la pantalla las llame,
// y eso se lee en fuente (`bookmarks-inbox.test.ts`).
vi.mock("@/lib/bookmarks/actions", () => ({
  deleteBookmarkAction: vi.fn(),
  updateBookmarkAction: vi.fn(),
}));

vi.mock("@/lib/collections/actions", () => ({
  createCollectionAction: vi.fn(),
}));

// La hoja de triage, cerrada en estos tests: lo que se monta es el inbox.
vi.mock("@/components/bookmarks/assign-sheet", () => ({
  AssignSheet: () => null,
}));

// El `Sheet` real pide `react-native-reanimated`: aqui solo importa que la
// confirmacion de borrado exista, y eso se lee en fuente.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: () => null,
  useLastValue: (valor: unknown) => valor,
}));

vi.mock("@/components/ui/button", async () => {
  const React = await import("react");
  return {
    Button: ({ label }: any) => React.createElement("button", null, label),
  };
});

vi.mock("@/components/ui/screen", async () => {
  const React = await import("react");
  return {
    Screen: ({ children }: any) => React.createElement("div", null, children),
  };
});

vi.mock("@/components/ui/empty-state", async () => {
  const React = await import("react");
  return {
    EmptyState: ({ title, description }: any) =>
      React.createElement("div", null, `${title} ${description ?? ""}`),
  };
});

vi.mock("@/components/media/full-title", () => ({
  FullTitleSheet: () => null,
}));

import { createElement } from "react";

// @ts-expect-error: el modulo existe pero el repo no trae sus tipos.
import { renderToStaticMarkup } from "react-dom/server";

import UnclassifiedScreen, { agruparHuerfanos } from "../src/app/(app)/unclassified";

const BASE: Bookmark = {
  id: "b1",
  version: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-03-04T10:00:00.000Z",
  workspaceId: "w1",
  folderId: null,
  collectionId: null,
  url: "https://ejemplo.test/salsa",
  title: "Salsa brava",
  siteName: null,
  description: null,
  imageUrl: null,
  document: "",
  plainText: "",
  extractionState: "ready",
  extractionError: null,
  tags: [],
  position: 0,
  role: "editor",
  shared: false,
  deletedAt: null,
};

/** 50 huerfanos de dos espacios: borrar una coleccion los deja asi. */
function cincuentaHuerfanos(): Bookmark[] {
  return Array.from({ length: 50 }, (_, i) => ({
    ...BASE,
    id: `huerfano-${i}`,
    // Mitad y mitad, intercalados: el agrupado no puede salir del orden de
    // la lista, solo juntar lo del mismo espacio.
    workspaceId: i % 2 === 0 ? "w1" : "w2",
    title: `Enlace ${i}`,
    updatedAt: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
  }));
}

function pintar(): string {
  return renderToStaticMarkup(createElement(UnclassifiedScreen));
}

beforeEach(() => {
  estado.bookmarks = [];
  estado.isLoading = true;
});

describe("agruparHuerfanos, con filas fabricadas", () => {
  it("50 huerfanos de dos espacios dan dos grupos que suman 50", () => {
    const grupos = agruparHuerfanos(cincuentaHuerfanos());

    expect(grupos.map((grupo) => grupo.workspaceId)).toEqual(["w1", "w2"]);
    expect(grupos[0]?.bookmarks).toHaveLength(25);
    expect(grupos[1]?.bookmarks).toHaveLength(25);
  });

  it("no reordena dentro del grupo: manda el orden de entrada", () => {
    const grupos = agruparHuerfanos(cincuentaHuerfanos());

    expect(grupos[0]?.bookmarks.map((b) => b.id)[0]).toBe("huerfano-0");
    expect(grupos[1]?.bookmarks.map((b) => b.id)[0]).toBe("huerfano-1");
  });

  it("sin filas no hay grupos", () => {
    expect(agruparHuerfanos([])).toEqual([]);
  });
});

describe("el inbox pinta lo que le dan", () => {
  it("cargando no pinta filas", () => {
    estado.bookmarks = cincuentaHuerfanos();
    estado.isLoading = true;

    expect(pintar()).not.toContain("inbox-delete-");
  });

  it("50 huerfanos salen sin crash, con su papelera cada uno", () => {
    estado.bookmarks = cincuentaHuerfanos();
    estado.isLoading = false;
    const html = pintar();

    // Una papelera por fila: si alguna fila rompiera al pintar, el render
    // entero cae y este numero no llega a 50.
    const papeleras = html.match(/inbox-delete-huerfano-\d+/g) ?? [];
    expect(papeleras).toHaveLength(50);
  });

  it("los grupos llevan el nombre del espacio y el contador su clave", () => {
    estado.bookmarks = cincuentaHuerfanos();
    estado.isLoading = false;
    const html = pintar();

    expect(html).toContain("Casa");
    expect(html).toContain("Calle");
    expect(html).toContain("bookmarks.unclassifiedCount.other");
    expect(html).toContain("place.unclassified");
  });

  it("sin filas sale el vacio con su copy", () => {
    estado.bookmarks = [];
    estado.isLoading = false;
    const html = pintar();

    expect(html).toContain("bookmarks.inbox.empty.title");
    expect(html).toContain("bookmarks.inbox.empty.body");
    expect(html).not.toContain("inbox-delete-");
  });

  it("borrar la coleccion huerfana 50 filas y el re-render las muestra", () => {
    // Fase 1: 50 enlaces colocados en una coleccion. El inbox pide
    // `collectionId: "unclassified"`, asi que no hay nada que mostrar.
    estado.bookmarks = cincuentaHuerfanos().map((bookmark) => ({
      ...bookmark,
      collectionId: "c1",
    }));
    estado.isLoading = false;
    expect(pintar()).not.toContain("inbox-delete-");

    // Fase 2: el efecto de borrar la coleccion. Sus filas pasan a null y la
    // suscripcion del hook relee: el mismo render, con los datos nuevos, y
    // las 50 filas aparecen agrupadas sin crash. Esto es la Review Focus #4,
    // la transicion y no la foto.
    estado.bookmarks = estado.bookmarks.map((bookmark) => ({
      ...bookmark,
      collectionId: null,
    }));
    const html = pintar();

    const papeleras = html.match(/inbox-delete-huerfano-\d+/g) ?? [];
    expect(papeleras).toHaveLength(50);
    expect(html).toContain("Casa");
    expect(html).toContain("Calle");
  });
});
