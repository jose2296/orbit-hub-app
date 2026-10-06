import { beforeEach, describe, expect, it, vi } from "vitest";

// Lo que el fix cierra, en un solo sitio: la busqueda pinta bookmarks y los
// abre en el lector, y el lector no ofrece abrir-original con URL insegura.
// Los comentarios van en espanol sin tildes, como el resto de la fase.

const { botones, disparos, empujes, estado, capturada } = vi.hoisted(() => ({
  botones: new Map<string, { onPress?: () => void; label?: string }>(),
  disparos: vi.fn(),
  empujes: vi.fn(),
  estado: { bookmark: null as unknown as import("@orbit-hub/contracts").Bookmark | null, isLoading: true },
  capturada: { actual: null as null | (() => unknown) },
}));

vi.mock("react-native", async () => {
  const React = await import("react");
  const View = ({ children, testID }: any) =>
    React.createElement("div", testID ? { "data-testid": testID } : null, children);
  const Text = ({ children, onPress }: any) =>
    React.createElement("span", onPress ? { onClick: onPress } : null, children);
  const Pressable = ({ children, testID, onPress }: any) =>
    React.createElement("button", testID ? { "data-testid": testID, onClick: onPress } : { onClick: onPress }, children);
  const Image = ({ source, testID }: any) =>
    React.createElement("img", { src: source?.uri ?? "", "data-testid": testID ?? undefined });
  return {
    View,
    Text,
    Pressable,
    Image,
    Linking: {
      openURL: (...args: unknown[]) => {
        disparos(...args);
        return Promise.resolve(true);
      },
    },
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

vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ bookmarkId: "b1" }),
  useRouter: () => ({ push: (...args: unknown[]) => empujes(...args), replace: () => {} }),
}));

// El tema real, sin el provider (que pide `expo-sqlite` y no carga en Node).
vi.mock("@/theme", async () => {
  const tokens = await import("../src/theme/tokens");
  const theme = tokens.createTheme("light", "orbit");
  return { useTheme: () => theme };
});

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => (clave: string) => clave,
}));

// El hook real lee `expo-sqlite`: aqui la fila la pone cada test.
vi.mock("@/hooks/use-bookmarks", () => ({
  useBookmark: () => ({ bookmark: estado.bookmark, isLoading: estado.isLoading }),
}));

// La busqueda real tambien lee `expo-sqlite`: aqui solo importa la pantalla.
vi.mock("@/hooks/use-lists", () => ({
  useListItems: () => ({ toggleCompleted: async () => {} }),
  useLocalSearch: () => ({ results: [], grouped: {}, search: async () => {}, isSearching: false }),
}));

vi.mock("@/lib/api/bookmarks", () => ({
  triggerExtract: (...args: unknown[]) => disparos(...args),
}));

// La cabecera se captura en vez de perderse: asi se afirma que el boton de
// abrir-original sale o no sale segun la URL, igual que el del cuerpo.
vi.mock("@/components/ui/header-action", () => ({
  useHeaderAction: (accion: () => unknown) => {
    capturada.actual = accion;
  },
}));

vi.mock("@/components/ui/screen", async () => {
  const React = await import("react");
  return {
    Screen: ({ children }: any) => React.createElement("div", null, children),
  };
});

vi.mock("@/components/ui/card", async () => {
  const React = await import("react");
  return {
    Card: ({ children }: any) => React.createElement("div", null, children),
  };
});

vi.mock("@/components/ui/checkbox", async () => {
  const React = await import("react");
  return {
    Checkbox: () => React.createElement("button", null),
  };
});

vi.mock("@/components/ui/app-icon", async () => {
  const React = await import("react");
  return {
    AppIcon: () => React.createElement("i", null),
  };
});

vi.mock("@/components/ui/empty-state", async () => {
  const React = await import("react");
  return {
    EmptyState: ({ title }: any) => React.createElement("div", null, title),
  };
});

vi.mock("@/components/ui/text", async () => {
  const React = await import("react");
  return {
    AppText: ({ children }: any) => React.createElement("span", null, children),
  };
});

vi.mock("@/components/ui/text-field", async () => {
  const React = await import("react");
  return {
    TextField: () => React.createElement("input", null),
  };
});

// El boton real pide `react-native-reanimated`: aqui solo importa su `onPress`
// por `testID`, para pulsar el abrir-original sin un movil.
vi.mock("@/components/ui/button", async () => {
  const React = await import("react");
  return {
    Button: ({ testID, label, onPress }: any) => {
      if (testID) botones.set(testID, { onPress, label });
      return React.createElement("button", testID ? { "data-testid": testID } : null, label);
    },
  };
});

import { createElement } from "react";

// @ts-expect-error: el modulo existe pero el repo no trae sus tipos.
import { renderToStaticMarkup } from "react-dom/server";

import type { Bookmark, SearchResult } from "@orbit-hub/contracts";

import BookmarkReaderScreen from "../src/app/(app)/bookmark/[bookmarkId]";
import { rutaResultado } from "../src/app/(app)/search";

const BASE: Bookmark = {
  id: "b1",
  version: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-03-04T10:00:00.000Z",
  workspaceId: "w1",
  folderId: null,
  collectionId: null,
  url: "https://ejemplo.test/salsa",
  title: "Salsa brava",
  siteName: "Ejemplo",
  description: "Receta de salsa brava",
  imageUrl: "https://ejemplo.test/salsa.png",
  document: "",
  plainText: "",
  extractionState: "metadata_only",
  extractionError: null,
  tags: [],
  position: 0,
  role: "owner",
  shared: false,
  deletedAt: null,
};

function baseHit(over: Partial<SearchResult> & { scope: SearchResult["scope"] }): SearchResult {
  return {
    id: "x1",
    workspaceId: "w1",
    listId: null,
    kind: null,
    title: "Algo",
    subtitle: null,
    completed: null,
    updatedAt: "2026-03-04T10:00:00.000Z",
    ...over,
  } as SearchResult;
}

function pintar(): string {
  return renderToStaticMarkup(createElement(BookmarkReaderScreen));
}

function pintarCabecera(): string {
  const accion = capturada.actual;
  if (!accion) return "";
  return renderToStaticMarkup(createElement(accion as () => null));
}

beforeEach(() => {
  botones.clear();
  disparos.mockReset();
  empujes.mockReset();
  capturada.actual = null;
  estado.bookmark = null;
  estado.isLoading = true;
});

describe("rutaResultado lleva cada hit a su pantalla", () => {
  it("el bookmark va al lector aunque traiga workspaceId", () => {
    // Sin rama propia caia en el fallback del espacio: el tap abria el
    // workspace en vez del lector. Este es el test que muerde.
    const hit = {
      scope: "bookmark",
      id: "b1",
      workspaceId: "w1",
      listId: null,
      kind: null,
      icon: null,
      title: "Salsa brava",
      subtitle: "ejemplo.test",
      completed: null,
      updatedAt: "2026-03-04T10:00:00.000Z",
    } as const;

    expect(rutaResultado(hit)).toBe("/(app)/bookmark/b1");
  });

  it("el resto de alcances no se mueve", () => {
    expect(rutaResultado(baseHit({ scope: "workspace", id: "w1" }))).toBe("/(app)/workspace/w1");
    expect(rutaResultado(baseHit({ scope: "list", id: "l1", listId: "l1" }))).toBe("/list/l1");
    expect(
      rutaResultado(baseHit({ scope: "list_item", id: "i1", listId: "l1" })),
    ).toBe("/list/l1");
    // Un tablero abre como tablero: el hit trae el tipo de la lista.
    expect(
      rutaResultado(baseHit({ scope: "list_item", id: "i1", listId: "b1", kind: "board" })),
    ).toBe("/board/b1");
    expect(rutaResultado(baseHit({ scope: "note", id: "n1" }))).toBe("/(app)/note/n1");
  });

  it("el fallback del espacio sigue para lo que no tiene rama, y nulo si ni eso", () => {
    expect(rutaResultado(baseHit({ scope: "folder", id: "f1", workspaceId: "w9" }))).toBe(
      "/(app)/workspace/w9",
    );
    expect(rutaResultado(baseHit({ scope: "folder", id: "f1", workspaceId: null }))).toBeNull();
  });
});

describe("search.tsx pinta el grupo de bookmarks", () => {
  it("el array a pintar trae bookmarks con la etiqueta de la lista", async () => {
    // Sin esta entrada un query que solo casa en bookmarks pintaba todos los
    // grupos vacios: pantalla en blanco sin `EmptyState`. Se reusa
    // `bookmarks.title` (la misma de lista y drawer), sin copy nuevo.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fuente = readFileSync(join(process.cwd(), "src", "app", "(app)", "search.tsx"), "utf8");

    expect(fuente).toContain("['bookmarks', t('bookmarks.title')]");
    expect(fuente).toContain("bookmark: 'bookmark-outline'");
  });
});

describe("el lector no ofrece abrir-original con URL insegura", () => {
  it("con `javascript:` no hay boton en cuerpo ni en cabecera", () => {
    estado.bookmark = { ...BASE, url: "javascript:alert(1)" };
    estado.isLoading = false;

    pintar();
    const cabecera = pintarCabecera();

    expect(botones.has("bookmark-open-original-body")).toBe(false);
    expect(cabecera).not.toContain("bookmark-open-original");
    expect(disparos).not.toHaveBeenCalled();
  });

  it("sin esquema tampoco hay boton en ningun sitio", () => {
    estado.bookmark = { ...BASE, url: "ejemplo.test/salsa" };
    estado.isLoading = false;

    pintar();
    const cabecera = pintarCabecera();

    expect(botones.has("bookmark-open-original-body")).toBe(false);
    expect(cabecera).not.toContain("bookmark-open-original");
  });

  it("con https hay boton en cuerpo y cabecera, y abre esa URL", () => {
    estado.bookmark = { ...BASE, url: "https://ejemplo.test/salsa" };
    estado.isLoading = false;

    pintar();
    const cabecera = pintarCabecera();

    expect(botones.has("bookmark-open-original-body")).toBe(true);
    expect(cabecera).toContain("bookmark-open-original");

    botones.get("bookmark-open-original-body")?.onPress?.();

    expect(disparos).toHaveBeenCalledWith("https://ejemplo.test/salsa");
  });

  it("la cabecera tambien se oculta en la rama lista con URL insegura", () => {
    estado.bookmark = { ...BASE, extractionState: "ready", url: "javascript:alert(1)" };
    estado.isLoading = false;

    pintar();
    const cabecera = pintarCabecera();

    expect(cabecera).not.toContain("bookmark-open-original");
  });
});
