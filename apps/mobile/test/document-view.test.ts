import { describe, expect, it, vi } from "vitest";

// El componente pinta con React Native y lee el tema, y ninguno de los dos
// existe en Node: se suplen los dos. El `View`/`Text`/`Image` falsos pintan
// `div`/`span`/`img`, que es lo justo para afirmar que texto sale y que Code
// nunca se ejecuta, sin fingir que esto es un movil.
vi.mock("react-native", async () => {
  const React = await import("react");
  const View = ({ children, testID }: any) =>
    React.createElement("div", testID ? { "data-testid": testID } : null, children);
  const Text = ({ children, onPress }: any) =>
    React.createElement("span", onPress ? { onClick: onPress } : null, children);
  const Image = ({ source, accessibilityLabel }: any) =>
    React.createElement("img", { src: source?.uri ?? "", alt: accessibilityLabel ?? "" });
  return {
    View,
    Text,
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

// El tema real, sin el provider (que pide `expo-sqlite` y no carga en Node).
// Los tokens son numeros y colores puros, asi que el test lee los mismos
// que la app.
vi.mock("@/theme", async () => {
  const tokens = await import("../src/theme/tokens");
  const theme = tokens.createTheme("light", "orbit");
  return { useTheme: () => theme };
});

import { createElement } from "react";

// `react-dom` esta instalado pero sin sus tipos (`@types/react-dom` no es
// dependencia): la linea de abajo es `any` por eso, y no se pide un paquete
// nuevo por una sola firma.
// @ts-expect-error: el modulo existe pero el repo no trae sus tipos.
import { renderToStaticMarkup } from "react-dom/server";

import {
  canRenderDocument,
  DocumentView,
  documentViewText,
  parseDocumentForView,
  pressLink,
  resolveImageSize,
  safeImageSource,
  safeLinkTarget,
} from "../src/components/bookmarks/document-view";

function markup(document: string): string {
  return renderToStaticMarkup(createElement(DocumentView, { document }));
}

describe("DocumentView", () => {
  it("un div con texto se muestra como texto, sin crash", () => {
    // Un `div` no es del formato y el schema lo rechaza, asi que el
    // componente devuelve nada; el parser, en cambio, conserva el texto
    // (unwrap, no descartar) por si algo asi llega igual.
    const blocks = parseDocumentForView("<div><p>Hola dentro del div</p></div>");
    expect(documentViewText(blocks)).toContain("Hola dentro del div");
    expect(canRenderDocument("<div><p>Hola dentro del div</p></div>")).toBe(false);
    expect(markup("<div><p>Hola dentro del div</p></div>")).toBe("");
  });

  it("un script no se ejecuta ni se muestra", () => {
    const blocks = parseDocumentForView(
      "<p>Antes</p><script>alert(1)</script><p>Despues</p>",
    );
    const text = documentViewText(blocks);
    expect(text).toContain("Antes");
    expect(text).toContain("Despues");
    expect(text).not.toContain("alert");
    expect(markup("<p>Antes</p><script>alert(1)</script><p>Despues</p>")).toBe("");
  });

  it("una imagen rota muestra placeholder y no rompe la pantalla", () => {
    const html = markup(
      '<p>Foto:</p><img src="https://ejemplo.com/foto.png" alt="Una foto" width="800" height="600"/>',
    );
    // La caja siempre esta (es el placeholder silencioso) y la foto va
    // dentro: si no carga, queda la caja y nada mas.
    expect(html).toContain("document-image-placeholder");
    expect(html).toContain("https://ejemplo.com/foto.png");
    // Y las medidas del documento se capan, nunca se pasan tal cual.
    expect(resolveImageSize("99999", "10")).toEqual({ width: 16384, height: 10 });
    expect(resolveImageSize(undefined, undefined)).toEqual({ width: null, height: null });
  });

  it('un a[href="javascript:"] no hace nada al tocarlo', () => {
    expect(safeLinkTarget("javascript:alert(1)")).toBeNull();
    expect(safeLinkTarget("  JAVASCRIPT:alert(1)  ")).toBeNull();
    const open = vi.fn();
    pressLink("javascript:alert(1)", open);
    expect(open).not.toHaveBeenCalled();
    // El texto del enlace se sigue leyendo: lo inerte es el toque, no la
    // palabra.
    const html = markup('<p>Lee <a href="javascript:alert(1)">esto</a> aqui.</p>');
    expect(html).toContain("esto");
  });

  it("un a[href] relativo no se abre", () => {
    expect(safeLinkTarget("/notas/1")).toBeNull();
    expect(safeLinkTarget("notas/1")).toBeNull();
    expect(safeLinkTarget("#ancla")).toBeNull();
    expect(safeLinkTarget("")).toBeNull();
    const open = vi.fn();
    pressLink("/notas/1", open);
    pressLink("notas/1", open);
    expect(open).not.toHaveBeenCalled();
    // Solo http(s) sale del lector.
    pressLink("https://ejemplo.com/x", open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://ejemplo.com/x");
  });

  it("doce tags exactos renderizan sin perdidas", () => {
    const document =
      "<h1>El titulo</h1>" +
      '<p>Un <b>texto</b> con <i>cursiva</i>, <u>subrayado</u>, <s>tachado</s>, ' +
      '<code>codigo</code> y un <a href="https://ejemplo.com">enlace</a>.<br/>Sigue aqui.</p>' +
      "<blockquote>Una cita.</blockquote>" +
      "<codeblock>let x = 1;</codeblock>" +
      "<ul><li>Primero</li><li>Segundo</li></ul>" +
      "<ol><li>Uno</li><li>Dos</li></ol>" +
      '<img src="https://ejemplo.com/foto.png" alt="Una foto" width="800" height="600"/>';
    // b i u s code a h1 p br blockquote codeblock ul ol img: el documento es
    // del formato y el lector lo acepta.
    expect(canRenderDocument(document)).toBe(true);
    const html = markup(document);
    for (const texto of [
      "El titulo",
      "texto",
      "cursiva",
      "subrayado",
      "tachado",
      "codigo",
      "enlace",
      "Sigue aqui",
      "Una cita",
      "let x = 1;",
      "Primero",
      "Segundo",
      "Uno",
      "Dos",
      "https://ejemplo.com/foto.png",
    ]) {
      expect(html).toContain(texto);
    }
  });

  it("una imagen sin src remoto se omite entera", () => {
    // El esquema `attachment:<id>` de las notas no aplica al lector: sin
    // foto remota no hay nada que describir, y el `alt` se va con ella.
    const blocks = parseDocumentForView(
      '<p>Antes</p><img src="attachment:abc" alt="Nada que ver" width="1" height="1"/><p>Despues</p>',
    );
    expect(blocks.some((block) => block.kind === "picture")).toBe(false);
    expect(documentViewText(blocks)).not.toContain("Nada que ver");
    expect(safeImageSource("attachment:abc")).toBeNull();
  });

  it("un documento invalido no se muestra", () => {
    expect(canRenderDocument("<p>sin cerrar")).toBe(false);
    expect(canRenderDocument(42)).toBe(false);
    expect(markup("<p>sin cerrar")).toBe("");
  });
});
