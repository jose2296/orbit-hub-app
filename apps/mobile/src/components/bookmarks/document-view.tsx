import { useMemo, useState } from "react";
import { Image, Linking, View } from "react-native";

import { noteDocumentSchema } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import type { TextVariant } from "@/components/ui/text";
import { useTheme } from "@/theme";

// El tope del contrato (`note-document.ts`, `MAX_IMAGE_EDGE`): ahi no se
// exporta, asi que el lector lo repite. Si cambia alla, se cambia aca.
const MAX_IMAGE_EDGE = 16384;

// Proporcion de reserva para una imagen sin medidas: no es un token porque
// no es un color, un espaciado ni un radio, solo una forma que no deforma.
const FALLBACK_ASPECT_RATIO = 4 / 3;

/* ------------------------------------------------------- modelo de vista -- */

export type ViewInline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "underline" | "strike" | "code"; children: ViewInline[] }
  | { kind: "link"; href: string; children: ViewInline[] }
  | { kind: "break" };

export type ViewBlock =
  | { kind: "paragraph"; inlines: ViewInline[] }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: ViewInline[] }
  | { kind: "quote"; inlines: ViewInline[] }
  | { kind: "codeblock"; text: string }
  | { kind: "list"; ordered: boolean; indent: number; items: ViewInline[][] }
  | { kind: "picture"; uri: string; width: number | null; height: number | null; alt: string };

/* ------------------------------------------------------------- enlaces ---- */

// Solo estos dos esquemas salen del lector. Todo lo demas (`javascript:`,
// relativo, sin esquema, vacio) es un texto mas: un tap nunca ejecuta codigo.
export function safeLinkTarget(href: string | undefined): string | null {
  if (href === undefined) return null;
  const limpio = href.trim();
  if (limpio.length === 0) return null;
  const esquema = limpio.toLowerCase();
  if (esquema.startsWith("http://") || esquema.startsWith("https://")) return limpio;
  return null;
}

// Lo que pasa al tocar un enlace, separado para poder probarlo sin montar
// nada: si no hay destino seguro, no se llama a `open` y no pasa nada.
export function pressLink(href: string, open: (url: string) => void): void {
  const target = safeLinkTarget(href);
  if (target !== null) open(target);
}

/* ------------------------------------------------------------ imagenes ---- */

// Las imagenes del lector son remotas y nada mas: el esquema
// `attachment:<id>` de las notas no aplica aqui, asi que un `src` que no sea
// http(s) no es una imagen rota, es que no hay imagen y se omite entero.
export function safeImageSource(src: string | undefined): string | null {
  if (src === undefined) return null;
  const limpio = src.trim();
  if (limpio.length === 0) return null;
  const esquema = limpio.toLowerCase();
  if (esquema.startsWith("http://") || esquema.startsWith("https://")) return limpio;
  return null;
}

// Las medidas del documento, capadas por arriba. Lo que no sea un entero
// positivo es ausencia de medida, no un cero: un ancho de cero es una caja
// que no se ve y un alto de cero es un divisor por cero esperando turno.
export function resolveImageSize(
  rawWidth: string | undefined,
  rawHeight: string | undefined,
): { width: number | null; height: number | null } {
  const parse = (raw: string | undefined): number | null => {
    if (raw === undefined) return null;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(value, MAX_IMAGE_EDGE);
  };
  return { width: parse(rawWidth), height: parse(rawHeight) };
}

/* --------------------------------------------------------------- guarda ---- */

// La frontera del lector: si el documento no valida, no se adivina. Un
// documento invalido en pantalla es el fallo que esta guarda existe para
// evitar, asi que el componente devuelve nada antes de intentar leer.
export function canRenderDocument(document: unknown): document is string {
  if (typeof document !== "string") return false;
  return noteDocumentSchema.safeParse(document).success;
}

/* ------------------------------------------------------------ tokenizer --- */

type Token =
  | { kind: "text"; value: string }
  | { kind: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Las cinco entidades que el editor emite, mas las numericas. Lo demas se
// deja como esta: inventar un caracter es peor que mostrar el codigo.
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()];
    if (known !== undefined) return known;
    let code = Number.NaN;
    if (name.startsWith("#x") || name.startsWith("#X")) {
      code = Number.parseInt(name.slice(2), 16);
    } else if (name.startsWith("#")) {
      code = Number.parseInt(name.slice(1), 10);
    }
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

// Solo los atributos que el lector lee. El resto se ignora al tokenizar: un
// `onclick` o un `style` no llegan ni al arbol, asi que no hay nada que
// filtrar despues.
const ATTR_PATTERN = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;
const WANTED_ATTRS: ReadonlySet<string> = new Set(["href", "src", "width", "height", "alt"]);

// A mano y sin dependencias: el formato es tan chico que un parser completo
// es mas superficie que el problema. No decide que esta permitido, solo
// parte el texto en piezas.
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) {
      const rest = html.slice(index);
      if (rest.length > 0) tokens.push({ kind: "text", value: decodeEntities(rest) });
      break;
    }
    if (open > index) {
      tokens.push({ kind: "text", value: decodeEntities(html.slice(index, open)) });
    }
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      index = close === -1 ? html.length : close + 3;
      continue;
    }
    const end = html.indexOf(">", open);
    if (end === -1) {
      // Un pico sin cerrar es texto, no un tag: se muestra roto antes que
      // tragar lo que viene despues.
      tokens.push({ kind: "text", value: decodeEntities(html.slice(open)) });
      break;
    }
    const inner = html.slice(open + 1, end);
    index = end + 1;
    if (inner.startsWith("/")) {
      tokens.push({ kind: "close", name: inner.slice(1).trim().toLowerCase() });
      continue;
    }
    if (inner.startsWith("!") || inner.startsWith("?")) continue;
    const selfClosing = inner.trimEnd().endsWith("/");
    const body = selfClosing ? inner.slice(0, inner.lastIndexOf("/")) : inner;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(body.trim());
    if (!nameMatch || !nameMatch[1]) {
      // No es un tag (`<3`, `< hola>`): se muestra tal cual, nunca se ejecuta.
      tokens.push({ kind: "text", value: decodeEntities(html.slice(open, end + 1)) });
      continue;
    }
    const name = nameMatch[1].toLowerCase();
    const attrs: Record<string, string> = {};
    const attrText = body.slice(nameMatch[1].length);
    ATTR_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTR_PATTERN.exec(attrText)) !== null) {
      const key = match[1]!.toLowerCase();
      if (!WANTED_ATTRS.has(key) || key in attrs) continue;
      const raw = match[2]!;
      attrs[key] = decodeEntities(
        raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw,
      );
    }
    tokens.push({ kind: "open", name, attrs, selfClosing });
  }
  return tokens;
}

/* ----------------------------------------------------------------- arbol -- */

type TreeNode = string | TreeElement;

interface TreeElement {
  tag: string;
  attrs: Record<string, string>;
  children: TreeNode[];
}

// Los subarboles que nunca se muestran ni como texto: su contenido es codigo
// o estilo, no prosa, y conservarlo seria mostrar basura o algo peor.
const SKIPPED_SUBTREES: ReadonlySet<string> = new Set(["script", "style"]);

// El lector es tolerante donde el contrato es estricto: el componente ya
// rechazo lo invalido, pero si algo llega igual (un documento viejo, uno
// manipulado), se lee lo que se pueda en vez de romper la pantalla.
function buildTree(tokens: Token[]): TreeNode[] {
  const root: TreeElement = { tag: "", attrs: {}, children: [] };
  const stack: TreeElement[] = [root];
  const skipped: string[] = [];
  for (const token of tokens) {
    if (skipped.length > 0) {
      if (token.kind === "open" && SKIPPED_SUBTREES.has(token.name)) skipped.push(token.name);
      if (token.kind === "close" && skipped[skipped.length - 1] === token.name) skipped.pop();
      continue;
    }
    if (token.kind === "text") {
      stack[stack.length - 1]!.children.push(token.value);
      continue;
    }
    if (token.kind === "close") {
      // Cierra hasta su igual: un cierre huerfano se ignora, no rompe nada.
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth]!.tag === token.name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    if (SKIPPED_SUBTREES.has(token.name)) {
      if (!token.selfClosing) skipped.push(token.name);
      continue;
    }
    const element: TreeElement = { tag: token.name, attrs: token.attrs, children: [] };
    stack[stack.length - 1]!.children.push(element);
    // `img` y `br` no tienen hijos; todo lo demas espera su cierre, y si no
    // llega se queda con lo que junto al final del documento.
    if (!token.selfClosing && token.name !== "img" && token.name !== "br") {
      stack.push(element);
    }
  }
  return root.children;
}

/* -------------------------------------------------------------- bloques --- */

const HEADINGS: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

// Quita los bordes vacios y deja el interior intacto: los espacios entre dos
// elementos (`a <b>b</b>`) son texto de verdad y se quedan.
function compactInlines(inlines: ViewInline[]): ViewInline[] {
  let start = 0;
  let end = inlines.length;
  while (start < end) {
    const first = inlines[start]!;
    if (first.kind !== "text" || first.text.trim() !== "") break;
    start += 1;
  }
  while (end > start) {
    const last = inlines[end - 1]!;
    if (last.kind !== "text" || last.text.trim() !== "") break;
    end -= 1;
  }
  return inlines.slice(start, end);
}

function imageFromAttrs(attrs: Record<string, string>): ViewBlock | null {
  const uri = safeImageSource(attrs["src"]);
  // Sin imagen remota no hay nada que describir en un lector: se omite el
  // nodo entero, con su `alt`.
  if (uri === null) return null;
  const { width, height } = resolveImageSize(attrs["width"], attrs["height"]);
  return { kind: "picture", uri, width, height, alt: attrs["alt"] ?? "" };
}

function inlineFromElement(element: TreeElement): ViewInline[] {
  const children = inlineFromNodes(element.children);
  switch (element.tag) {
    case "b":
      return [{ kind: "bold", children }];
    case "i":
      return [{ kind: "italic", children }];
    case "u":
      return [{ kind: "underline", children }];
    case "s":
      return [{ kind: "strike", children }];
    case "code":
      return [{ kind: "code", children }];
    case "a":
      return [{ kind: "link", href: element.attrs["href"] ?? "", children }];
    case "br":
      return [{ kind: "break" }];
    default:
      return children;
  }
}

// Un truco con marca: `inlineFromNodes` mete la imagen disfrazada de en
// linea, y `pushInlines` la desempaca a bloque. Asi el que recorre en linea
// no necesita saber de bloques, y una imagen entre texto parte el parrafo:
// en nativo una foto no vive dentro de una linea, asi que el parser la eleva
// a bloque en vez de pedirle al render un imposible.
const IMAGE_MARKER: unique symbol = Symbol("image");

function inlineFromNodes(nodes: TreeNode[]): ViewInline[] {
  const out: ViewInline[] = [];
  for (const node of nodes) {
    if (typeof node === "string") {
      if (node.length > 0) out.push({ kind: "text", text: node });
      continue;
    }
    // Un bloque anidado donde se esperaba en linea (un `p` dentro de un
    // `b`): se conserva su texto y se suelta la envoltura.
    if (
      node.tag === "p" ||
      HEADINGS.has(node.tag) ||
      node.tag === "blockquote" ||
      node.tag === "codeblock" ||
      node.tag === "ul" ||
      node.tag === "ol" ||
      node.tag === "li"
    ) {
      out.push(...inlineFromNodes(node.children));
      continue;
    }
    if (node.tag === "img") {
      const picture = imageFromAttrs(node.attrs);
      if (picture !== null) {
        (picture as unknown as Record<symbol, boolean>)[IMAGE_MARKER] = true;
        out.push(picture as unknown as ViewInline);
      }
      continue;
    }
    out.push(...inlineFromElement(node));
  }
  return out;
}

function plainText(nodes: TreeNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node === "string") out += node;
    else if (node.tag === "br") out += "\n";
    else if (!SKIPPED_SUBTREES.has(node.tag)) out += plainText(node.children);
  }
  return out;
}

interface BlockSink {
  blocks: ViewBlock[];
  current: ViewInline[];
}

function flushParagraph(sink: BlockSink): void {
  const inlines = compactInlines(sink.current);
  sink.current = [];
  if (inlines.length > 0) sink.blocks.push({ kind: "paragraph", inlines });
}

// Parte la cola en linea al encontrar una imagen disfrazada (ver
// `IMAGE_MARKER`): el parrafo se cierra, sale la foto, y el texto que sigue
// abre otro parrafo.
function pushInlines(sink: BlockSink, inlines: ViewInline[]): void {
  for (const inline of inlines) {
    if ((inline as unknown as Record<symbol, boolean>)[IMAGE_MARKER] === true) {
      flushParagraph(sink);
      sink.blocks.push(inline as unknown as ViewBlock);
    } else {
      sink.current.push(inline);
    }
  }
}

function listFromElement(element: TreeElement, indent: number): ViewBlock[] {
  const items: ViewInline[][] = [];
  const after: ViewBlock[] = [];
  for (const child of element.children) {
    if (typeof child === "string") continue;
    // Una sublista dentro de un punto va detras de la lista, un nivel mas
    // adentro: el lector no promete el anidado exacto del editor, promete
    // no perder ningun punto.
    if (child.tag === "ul" || child.tag === "ol") {
      after.push(...listFromElement(child, indent + 1));
      continue;
    }
    if (child.tag !== "li") {
      const rest = inlineFromNodes([child]);
      if (compactInlines(rest).length > 0) items.push(compactInlines(rest));
      continue;
    }
    const inlines: ViewInline[] = [];
    for (const grandchild of child.children) {
      if (typeof grandchild !== "string" && (grandchild.tag === "ul" || grandchild.tag === "ol")) {
        after.push(...listFromElement(grandchild, indent + 1));
      } else {
        inlines.push(...inlineFromNodes([grandchild]));
      }
    }
    const compacted = compactInlines(inlines);
    if (compacted.length > 0) items.push(compacted);
  }
  const out: ViewBlock[] = [];
  if (items.length > 0) {
    out.push({ kind: "list", ordered: element.tag === "ol", indent, items });
  }
  out.push(...after);
  return out;
}

function blockFromNode(node: TreeNode, sink: BlockSink, indent: number): void {
  if (typeof node === "string") {
    pushInlines(sink, [{ kind: "text", text: node }]);
    return;
  }
  // Fuera del conjunto (un `div` que sobrevivio, un `sup`, un `figure`): se
  // omite el nodo y se conserva su texto, la misma regla de la reduccion de
  // fase 2. Unwrap, no descartar. Jamas HTML crudo en pantalla.
  switch (node.tag) {
    case "p":
      flushParagraph(sink);
      pushInlines(sink, inlineFromNodes(node.children));
      flushParagraph(sink);
      return;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      flushParagraph(sink);
      const inlines = compactInlines(inlineFromNodes(node.children));
      if (inlines.length > 0) {
        sink.blocks.push({
          kind: "heading",
          level: Number(node.tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
          inlines,
        });
      }
      return;
    }
    case "blockquote":
      flushParagraph(sink);
      pushInlines(sink, inlineFromNodes(node.children));
      {
        const inlines = compactInlines(sink.current);
        sink.current = [];
        if (inlines.length > 0) sink.blocks.push({ kind: "quote", inlines });
      }
      return;
    case "codeblock": {
      flushParagraph(sink);
      const text = plainText(node.children).trim();
      if (text.length > 0) sink.blocks.push({ kind: "codeblock", text });
      return;
    }
    case "ul":
    case "ol":
      flushParagraph(sink);
      sink.blocks.push(...listFromElement(node, indent));
      return;
    case "li":
      // Un punto suelto fuera de su lista: su texto sigue valiendo.
      pushInlines(sink, inlineFromNodes(node.children));
      return;
    case "img": {
      flushParagraph(sink);
      const picture = imageFromAttrs(node.attrs);
      if (picture !== null) sink.blocks.push(picture);
      return;
    }
    case "br":
      pushInlines(sink, [{ kind: "break" }]);
      return;
    case "b":
    case "i":
    case "u":
    case "s":
    case "code":
    case "a":
      pushInlines(sink, inlineFromElement(node));
      return;
    default:
      // Incluye `script` y `style` por si el arbol los trae: `buildTree` ya
      // los vacio, asi que aqui solo llegaria la cascara.
      for (const child of node.children) blockFromNode(child, sink, indent);
  }
}

// El documento ya validado, convertido en bloques para pintar. Solo lee:
// no ejecuta nada, no carga nada, no guarda nada.
export function parseDocumentForView(document: string): ViewBlock[] {
  const sink: BlockSink = { blocks: [], current: [] };
  for (const node of buildTree(tokenize(document))) {
    blockFromNode(node, sink, 0);
  }
  flushParagraph(sink);
  return sink.blocks;
}

// Todo el texto visible, para probar que nada se pierde por el camino.
export function documentViewText(blocks: ViewBlock[]): string {
  const inlineText = (inlines: ViewInline[]): string =>
    inlines
      .map((inline) => {
        switch (inline.kind) {
          case "text":
            return inline.text;
          case "break":
            return "\n";
          case "link":
          case "bold":
          case "italic":
          case "underline":
          case "strike":
          case "code":
            return inlineText(inline.children);
        }
      })
      .join("");
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
        case "heading":
        case "quote":
          return inlineText(block.inlines);
        case "codeblock":
          return block.text;
        case "list":
          return block.items.map((item) => inlineText(item)).join("\n");
        case "picture":
          return block.alt;
      }
    })
    .join("\n");
}

/* --------------------------------------------------------------- pintar --- */

const HEADING_VARIANTS: Record<number, TextVariant> = {
  1: "title",
  2: "heading",
  3: "bodyLarge",
  4: "bodyStrong",
  5: "callout",
  6: "caption",
};

function InlineView({ inline }: { inline: ViewInline }) {
  const theme = useTheme();
  switch (inline.kind) {
    case "text":
      return <AppText variant="body">{inline.text}</AppText>;
    case "break":
      return <AppText variant="body">{"\n"}</AppText>;
    case "bold":
      return (
        <AppText variant="body" style={{ fontWeight: "700" }}>
          {inline.children.map((child, index) => (
            <InlineView key={index} inline={child} />
          ))}
        </AppText>
      );
    case "italic":
      return (
        <AppText variant="body" style={{ fontStyle: "italic" }}>
          {inline.children.map((child, index) => (
            <InlineView key={index} inline={child} />
          ))}
        </AppText>
      );
    case "underline":
      return (
        <AppText variant="body" style={{ textDecorationLine: "underline" }}>
          {inline.children.map((child, index) => (
            <InlineView key={index} inline={child} />
          ))}
        </AppText>
      );
    case "strike":
      return (
        <AppText variant="body" style={{ textDecorationLine: "line-through" }}>
          {inline.children.map((child, index) => (
            <InlineView key={index} inline={child} />
          ))}
        </AppText>
      );
    case "code":
      return (
        <AppText
          variant="body"
          style={{
            backgroundColor: theme.colors.surfaceSunken,
            borderRadius: theme.radius.sm,
            paddingHorizontal: theme.spacing.xs,
          }}
        >
          {inline.children.map((child, index) => (
            <InlineView key={index} inline={child} />
          ))}
        </AppText>
      );
    case "link": {
      const target = safeLinkTarget(inline.href);
      // Sin destino seguro el enlace es texto: se pinta igual que el resto
      // y no lleva `onPress`, asi que no hay toque que probar.
      if (target === null) {
        return (
          <AppText variant="body">
            {inline.children.map((child, index) => (
              <InlineView key={index} inline={child} />
            ))}
          </AppText>
        );
      }
      return (
        <AppText
          variant="body"
          style={{ color: theme.colors.accent }}
          onPress={() =>
            pressLink(inline.href, (url) => {
              void Linking.openURL(url);
            })
          }
        >
          {inline.children.map((child, index) => (
            <InlineView key={index} inline={child} />
          ))}
        </AppText>
      );
    }
  }
}

// Una imagen que no carga deja su caja y nada mas: ni crash, ni texto de
// error, ni reintento. La caja es el placeholder silencioso.
function DocImage({ uri, width, height, alt }: { uri: string; width: number | null; height: number | null; alt: string }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const sized = width !== null && height !== null;
  return (
    <View
      testID="document-image-placeholder"
      style={[
        sized ? { width, height } : { width: "100%", aspectRatio: FALLBACK_ASPECT_RATIO },
        {
          backgroundColor: theme.colors.surfaceSunken,
          borderRadius: theme.radius.md,
          overflow: "hidden",
          maxWidth: "100%",
        },
      ]}
    >
      {failed ? null : (
        <Image
          source={{ uri }}
          accessibilityLabel={alt}
          resizeMode="contain"
          onError={() => setFailed(true)}
          style={sized ? { width, height } : { width: "100%", height: "100%" }}
        />
      )}
    </View>
  );
}

function BlockView({ block }: { block: ViewBlock }) {
  const theme = useTheme();
  switch (block.kind) {
    case "paragraph":
      return (
        <AppText variant="body">
          {block.inlines.map((inline, index) => (
            <InlineView key={index} inline={inline} />
          ))}
        </AppText>
      );
    case "heading":
      return (
        <AppText variant={HEADING_VARIANTS[block.level] ?? "bodyStrong"}>
          {block.inlines.map((inline, index) => (
            <InlineView key={index} inline={inline} />
          ))}
        </AppText>
      );
    case "quote":
      return (
        <View
          style={{
            backgroundColor: theme.colors.surfaceSunken,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          }}
        >
          <AppText variant="body" style={{ fontStyle: "italic" }}>
            {block.inlines.map((inline, index) => (
              <InlineView key={index} inline={inline} />
            ))}
          </AppText>
        </View>
      );
    case "codeblock":
      return (
        <View
          style={{
            backgroundColor: theme.colors.surfaceSunken,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          }}
        >
          <AppText variant="body">{block.text}</AppText>
        </View>
      );
    case "list":
      return (
        <View style={{ gap: theme.spacing.xs, paddingLeft: theme.spacing.md }}>
          {block.items.map((item, index) => (
            <View key={index} style={{ flexDirection: "row", gap: theme.spacing.xs }}>
              <AppText variant="body" style={{ color: theme.colors.textMuted }}>
                {block.ordered ? `${index + 1}.` : "•"}
              </AppText>
              <AppText variant="body" style={{ flexShrink: 1 }}>
                {item.map((inline, inner) => (
                  <InlineView key={inner} inline={inline} />
                ))}
              </AppText>
            </View>
          ))}
        </View>
      );
    case "picture":
      return <DocImage uri={block.uri} width={block.width} height={block.height} alt={block.alt} />;
  }
}

export interface DocumentViewProps {
  document: string;
}

// El lector sin editor: solo lee el formato de documento, con los tokens del
// tema y sin ejecutar nada. Si el documento no valida, nada: un documento
// invalido en pantalla es el fallo que la guarda existe para evitar.
export function DocumentView({ document }: DocumentViewProps) {
  const theme = useTheme();
  const valid = canRenderDocument(document);
  const blocks = useMemo(() => (valid ? parseDocumentForView(document) : []), [document, valid]);
  if (!valid) return null;
  return (
    <View style={{ gap: theme.spacing.md }}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </View>
  );
}
