import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bookmark } from "@orbit-hub/contracts";

// La pantalla pinta con React Native y cuelga de expo-router, y ninguno de
// los dos existe en Node: se suplen los dos, igual que en
// `document-view.test.ts`. El `View`/`Text`/`Image`/`Pressable` falsos pintan
// `div`/`span`/`img`/`button`, que es lo justo para afirmar que rama sale y
// que botones hay, sin fingir que esto es un movil.
const { botones, disparo, estado } = vi.hoisted(() => ({
  botones: new Map<string, { onPress?: () => void; label?: string }>(),
  disparo: vi.fn(),
  estado: { bookmark: null as Bookmark | null, isLoading: true },
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
    Linking: { openURL: async () => true },
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
  useRouter: () => ({ replace: () => {} }),
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

// Sin red simulada: el disparo es un apunte, y lo que importa es cuando se
// llama y con que id, no lo que la red contesta.
vi.mock("@/lib/api/bookmarks", () => ({
  triggerExtract: (...args: unknown[]) => disparo(...args),
}));

vi.mock("@/components/ui/header-action", () => ({
  useHeaderAction: () => {},
}));

vi.mock("@/components/ui/screen", async () => {
  const React = await import("react");
  return {
    Screen: ({ children }: any) => React.createElement("div", null, children),
  };
});

// El boton real pide `react-native-reanimated`: aqui solo importa su `onPress`
// por `testID`, para pulsar el reintentar sin un movil.
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

import { dictionaries } from "@/lib/i18n/dictionaries";

import BookmarkReaderScreen, {
  disparoSiPendiente,
  ramaLector,
} from "../src/app/(app)/bookmark/[bookmarkId]";

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
  extractionState: "pending",
  extractionError: null,
  tags: [],
  position: 0,
  role: "owner",
  shared: false,
  deletedAt: null,
};

// Doce tags del formato, calcado del ejemplo largo de `document-view.test.ts`.
const DOC_DOCE: string =
  "<h1>La salsa</h1>" +
  "<p>Un <b>texto</b> con <i>cursiva</i>, <u>subrayado</u>, <s>tachado</s>, " +
  "<code>codigo</code> y un <a href=\"https://ejemplo.test\">enlace</a>.<br/>Sigue aqui.</p>" +
  "<blockquote>Una cita.</blockquote>" +
  "<h2>Ingredientes</h2>" +
  "<ul><li>Tomate</li><li>Ajo</li></ul>" +
  "<h3>Pasos</h3>" +
  "<ol><li>Mezclar</li><li>Servir</li></ol>";

function pintar(): string {
  return renderToStaticMarkup(createElement(BookmarkReaderScreen));
}

beforeEach(() => {
  botones.clear();
  disparo.mockReset();
  estado.bookmark = null;
  estado.isLoading = true;
});

describe("ramaLector, con filas fabricadas", () => {
  it("cargando o sin fila es esqueleto", () => {
    expect(ramaLector(null, true)).toBe("esqueleto");
    expect(ramaLector(null, false)).toBe("esqueleto");
    expect(ramaLector({ ...BASE, extractionState: "ready" }, true)).toBe("esqueleto");
  });

  it("cada estado tiene su rama y son distintas", () => {
    expect(ramaLector({ ...BASE, extractionState: "pending" }, false)).toBe("pendiente");
    expect(ramaLector({ ...BASE, extractionState: "ready" }, false)).toBe("lista");
    expect(ramaLector({ ...BASE, extractionState: "metadata_only" }, false)).toBe("metadata");
    expect(ramaLector({ ...BASE, extractionState: "failed" }, false)).toBe("fallida");
  });
});

describe("disparoSiPendiente", () => {
  it("dispara una vez por id y solo en pendiente", () => {
    const disparados = new Set<string>();
    const pendiente = { ...BASE, extractionState: "pending" as const };

    disparoSiPendiente(pendiente, disparados);
    disparoSiPendiente(pendiente, disparados);

    expect(disparo).toHaveBeenCalledTimes(1);
    expect(disparo).toHaveBeenCalledWith("b1");
  });

  it("sin fila o fuera de pendiente no llama a la red", () => {
    disparoSiPendiente(null, new Set());
    disparoSiPendiente({ ...BASE, extractionState: "ready" }, new Set());
    disparoSiPendiente({ ...BASE, extractionState: "failed" }, new Set());
    disparoSiPendiente({ ...BASE, extractionState: "metadata_only" }, new Set());

    expect(disparo).not.toHaveBeenCalled();
  });
});

describe("la pantalla pinta cada rama", () => {
  it("cargando: esqueleto a11y-hidden y nada mas", () => {
    const html = pintar();

    expect(html).toContain("bookmark-skeleton");
    expect(html).not.toContain("Salsa brava");
  });

  it("pendiente: titulo y host si se conocen, mas esqueleto", () => {
    estado.bookmark = { ...BASE, extractionState: "pending" };
    estado.isLoading = false;

    const html = pintar();

    expect(html).toContain("Salsa brava");
    expect(html).toContain("ejemplo.test");
    expect(html).toContain("bookmark-pending-skeleton");
    expect(html).toContain("bookmarks.reader.pendingBody");
  });

  it("lista: portada, titulo, host, fecha y el documento de doce tags", () => {
    estado.bookmark = { ...BASE, extractionState: "ready", document: DOC_DOCE };
    estado.isLoading = false;

    const html = pintar();

    expect(html).toContain("bookmark-cover");
    expect(html).toContain("Salsa brava");
    expect(html).toContain("ejemplo.test");
    // El texto del documento sale en pantalla: es la rama que lo distingue.
    expect(html).toContain("La salsa");
    expect(html).toContain("Una cita.");
    expect(html).toContain("Mezclar");
  });

  it("lista sin documento: avisa que el texto viene con el pull, no un hueco", () => {
    estado.bookmark = { ...BASE, extractionState: "ready", document: "" };
    estado.isLoading = false;

    const html = pintar();

    expect(html).toContain("Salsa brava");
    expect(html).toContain("bookmarks.reader.waitingText");
  });

  it("metadata_only: portada, metadata y abrir-original, sin reintentar", () => {
    estado.bookmark = { ...BASE, extractionState: "metadata_only" };
    estado.isLoading = false;

    const html = pintar();

    expect(html).toContain("bookmark-cover");
    expect(html).toContain("Salsa brava");
    expect(html).toContain("Receta de salsa brava");
    expect(html).toContain("bookmarks.reader.metadataBody");
    expect(botones.has("bookmark-open-original-body")).toBe(true);
    // Reintentar no arregla un `metadata_only`: no hay boton que lo ofrezca.
    expect(botones.has("bookmark-retry")).toBe(false);
    expect(html).not.toContain("bookmark-retry");
  });

  it("fallida: enlace, motivo corto y reintentar que llama a triggerExtract", () => {
    estado.bookmark = {
      ...BASE,
      extractionState: "failed",
      extractionError: "timeout en el fetch",
    };
    estado.isLoading = false;

    const html = pintar();

    expect(html).toContain("https://ejemplo.test/salsa");
    expect(html).toContain("timeout en el fetch");
    const reintentar = botones.get("bookmark-retry")?.onPress;
    expect(reintentar).toBeDefined();

    reintentar?.();

    // El servidor hace no-op si ya esta `ready`: reintentar es siempre seguro.
    expect(disparo).toHaveBeenCalledTimes(1);
    expect(disparo).toHaveBeenCalledWith("b1");
  });
});

describe("el share aterriza en el lector", () => {
  it("save.tsx navega al detalle con el id, una sola vez y sin TODO", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fuente = readFileSync(
      join(process.cwd(), "src", "app", "share", "save.tsx"),
      "utf8",
    );

    expect(fuente).toContain('pathname: "/bookmark/[bookmarkId]"');
    expect(fuente).toContain("bookmarkId: id");
    expect(fuente).toContain("clearShare()");
    expect(fuente).not.toContain("TODO(fase-4)");
    expect(fuente).not.toContain("highlight");
  });
});

describe("los strings nuevos estan en las dos lenguas", () => {
  const claves = [
    "bookmarks.reader.openOriginal",
    "bookmarks.reader.pendingBody",
    "bookmarks.reader.waitingText",
    "bookmarks.reader.failedBody",
    "bookmarks.reader.metadataBody",
  ] as const;

  it("cada clave existe en es y en, y ninguna queda vacia", () => {
    for (const clave of claves) {
      expect(dictionaries.es[clave], clave).toBeTruthy();
      expect(dictionaries.en[clave], clave).toBeTruthy();
    }
  });
});
