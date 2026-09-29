/**
 * The note document format.
 *
 * A note is HTML, and it is HTML because the editor is the same component on
 * Android, iOS and the web: `EnrichedTextInput` produces HTML and that HTML is
 * what we store, so there is no conversion anywhere in the feature. See
 * `docs/architecture/adr/0009-one-native-editor.md`.
 *
 * The format is defined by what the editor accepts, and the editor accepts a
 * closed set of tags. Everything else is rejected here, before the value is
 * stored, because the editor does not sanitise HTML on iOS or Android: this check
 * is the security boundary on mobile, not a nicety. The web implementation does
 * sanitise, which means the two platforms would otherwise disagree about what a
 * valid document is.
 *
 * The parser below is hand written and touches no DOM, so it runs in the API, in
 * Hermes and in the browser from the same file.
 */

import { z } from 'zod';

/** The most HTML a note may hold. Roughly a hundred thousand words. */
export const NOTE_DOCUMENT_MAX_BYTES = 512_000;

/** Wraps a range of characters. */
const INLINE_TAGS = ['b', 'i', 'u', 's', 'code', 'a'] as const;

/** Applies to a whole paragraph. At most one per paragraph. */
const PARAGRAPH_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'codeblock',
] as const;

/** Holds a run of lines, each in its own inner tag. */
const LIST_TAGS = ['ul', 'ol'] as const;

/** Never has a closing tag. */
const VOID_TAGS = ['img', 'br'] as const;

/** The two attributes that say how big a picture is. */
const IMAGE_DIMENSIONS = ['width', 'height'] as const;

/**
 * How wide an image may claim to be, in pixels.
 *
 * A cap, not a rule about pictures: the number is read by the layout and used to
 * size a view, and a note is a field a person types into. 16384 is wider than any
 * screen and taller than any camera, so nothing real is refused and a document
 * that is trying to describe the size of the moon is turned away.
 */
const MAX_IMAGE_EDGE = 16384;
const INLINE_SET: ReadonlySet<string> = new Set<string>([...INLINE_TAGS, 'img', 'br']);
const PARAGRAPH_SET: ReadonlySet<string> = new Set<string>(PARAGRAPH_TAGS);
const LIST_SET: ReadonlySet<string> = new Set<string>([...LIST_TAGS, 'ul']);
const VOID_SET: ReadonlySet<string> = new Set<string>(VOID_TAGS);

/** Tags that carry a closing tag but no attributes at all. */
const ATTRIBUTE_FREE: ReadonlySet<string> = new Set<string>([
  ...INLINE_TAGS.filter((tag) => tag !== 'a'),
  ...PARAGRAPH_TAGS,
  'li',
  'ol',
]);

/**
 * The most attributes a single tag may carry.
 *
 * Two for nearly everything, and four for a picture.
 *
 * The two is a guard against attribute stuffing: there is nothing in a note that
 * needs three, so a fourth is either noise or an attempt. The picture is the
 * exception and always was — `src` says which file, `width` and `height` say
 * its shape, and the editor writes all three on every image it inserts and the
 * native parser writes all three on every read. With the cap at two, **no picture
 * could be saved at all**: the document was refused, the note said "the document
 * is not valid", and the image was left in the text of a note that could not be
 * written. One number, and a feature that looked like it worked.
 */
const MAX_ATTRIBUTES = 2;
const MAX_IMAGE_ATTRIBUTES = 4;

/* ------------------------------------------------------------------ tokens -- */

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'open'; name: string; attributes: Record<string, string>; selfClosing: boolean }
  | { kind: 'close'; name: string };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the five entities the editor emits, and leaves anything else alone. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()];
    if (known !== undefined) return known;
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/**
 * Strips the document wrapper, if there is one.
 *
 * The web build of the editor hands over the whole document — `<html>…</html>` —
 * while the native build hands over the body. That is not a difference in the
 * format, it is a difference in how the two read the same editor's value, and it
 * was found by running the app: every test in this repository passed until then,
 * because the tests wrote the markup by hand and the real editor had never been
 * asked for its output.
 *
 * So the wrapper is removed rather than allowed into the format. Putting `html`
 * on the allow-list would let a document carry a doctype, a `<head>` and a
 * `<script>` for the sake of an implementation detail of one platform.
 *
 * Repeated, because a document that is opened and saved again would otherwise
 * grow a layer per round trip.
 */
export function unwrapDocumentHtml(html: string): string {
  let value = html.trim();
  for (let guard = 0; guard < 3; guard += 1) {
    const next = value
      .replace(/^<!doctype[^>]*>\s*/i, '')
      .replace(/^<html\b[^>]*>/i, '')
      .replace(/<\/html>\s*$/i, '')
      .replace(/^<head\b[^>]*>[\s\S]*?<\/head>\s*/i, '')
      .replace(/^<body\b[^>]*>/i, '')
      .replace(/<\/body>\s*$/i, '')
      .trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

/**
 * Turns markup into tokens.
 *
 * It does not decide what is allowed; it only splits. A tag it cannot read is
 * reported as a `close`, which the walk below then fails on, so an unreadable
 * input is rejected rather than silently skipped.
 */
function tokenize(html: string, problems: DocumentProblem[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open === -1) {
      const rest = html.slice(index);
      if (rest.length > 0) tokens.push({ kind: 'text', value: decodeEntities(rest) });
      break;
    }
    if (open > index) {
      tokens.push({ kind: 'text', value: decodeEntities(html.slice(index, open)) });
    }

    const end = html.indexOf('>', open);
    if (end === -1) {
      problems.push({ path: `offset ${open}`, reason: 'a tag is never closed' });
      break;
    }

    const inner = html.slice(open + 1, end);
    index = end + 1;

    if (inner.startsWith('/')) {
      tokens.push({ kind: 'close', name: inner.slice(1).trim().toLowerCase() });
      continue;
    }

    if (inner.startsWith('!') || inner.startsWith('?')) {
      // A comment, a doctype or a processing instruction. The editor emits none,
      // and a comment is a way to smuggle markup past a naive reader.
      problems.push({ path: `offset ${open}`, reason: 'comments and declarations are not part of the format' });
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([a-zA-Z][-a-zA-Z0-9]*)/.exec(body);
    if (!nameMatch) {
      problems.push({ path: `offset ${open}`, reason: 'this is not a tag' });
      continue;
    }
    // `noUncheckedIndexedAccess` is on, and a group that took part in the match
    // is never missing, so these two are asserted rather than re-checked.
    const tagName = nameMatch[1]!.toLowerCase();

    const attributes: Record<string, string> = {};
    const attributeText = body.slice(nameMatch[1]!.length);
    ATTRIBUTE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTRIBUTE_PATTERN.exec(attributeText)) !== null) {
      const key = match[1]!.toLowerCase();
      const raw = match[2] ?? '';
      const value = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
      if (key in attributes) {
        problems.push({ path: `offset ${open}`, reason: `<${tagName}> repeats the attribute "${key}"` });
        continue;
      }
      attributes[key] = decodeEntities(value);
    }

    tokens.push({ kind: 'open', name: tagName, attributes, selfClosing });
  }

  return tokens;
}

/* -------------------------------------------------------------- validation -- */

/** One thing wrong with a document, and where. */
export interface DocumentProblem {
  /** Where it is, close enough to find by hand: `content[2] > li[0]`. */
  path: string;
  /** What is wrong, in words someone can act on. */
  reason: string;
}

interface Context {
  problems: DocumentProblem[];
}

function fail(context: Context, path: string, reason: string): void {
  // One bad tag can cascade into twenty complaints if every ancestor is
  // reported, so the walk stops descending once something is rejected.
  if (context.problems.length < 50) context.problems.push({ path, reason });
}

function checkAttributes(
  context: Context,
  path: string,
  name: string,
  attributes: Record<string, string>,
  expected: readonly string[],
): boolean {
  const allowed = new Set(expected);
  let ok = true;
  for (const key of Object.keys(attributes)) {
    if (!allowed.has(key)) {
      fail(
        context,
        path,
        `<${name}> does not take "${key}"` +
          (key === 'style' || key === 'class'
            ? '; a note carries no presentation of its own, it takes the theme'
            : ''),
      );
      ok = false;
    }
  }
  const limit = name === 'img' ? MAX_IMAGE_ATTRIBUTES : MAX_ATTRIBUTES;
  if (Object.keys(attributes).length > limit) {
    fail(context, path, `<${name}> has more than ${limit} attributes`);
    ok = false;
  }
  return ok;
}

function allowedAttributesFor(
  name: string,
  attributes: Record<string, string>,
): readonly string[] {
  if (name === 'a') return ['href'];
  // `width` and `height` are the picture's shape, not its presentation. The
  // editor writes them on every image it inserts — `setImage` takes both and the
  // native parser emits them on every `getHTML` — so without them a note with a
  // picture in it cannot be saved at all. They are checked as numbers below,
  // because a note is text and "999999" is not a size a picture can be.
  if (name === 'img') return ['src', 'alt', 'width', 'height'];
  if (name === 'ul') return attributes['data-type'] === 'checkbox' ? ['data-type'] : [];
  if (name === 'li') return ['checked'];
  if (ATTRIBUTE_FREE.has(name)) return [];
  return [];
}

/**
 * Walks the tokens and reports everything outside the format.
 *
 * The severities are not the same on purpose. A document that names a tag the
 * editor does not have, carries an attribute it should not, or does not balance
 * is refused: the first two are how a document gets to run code on a phone that
 * does not sanitise, and the third means content would be lost on the next save.
 *
 * Anything else is allowed, including nesting the editor would lay out
 * differently. Being strict about that costs a person their edit for a document
 * the editor itself produced, and the editor normalises it on the next save
 * anyway. The one exception is text at the very top of the document, because
 * there the editor has to *invent* a paragraph around it, and what it invents is
 * not what the author wrote.
 */
function walk(tokens: Token[], context: Context): void {
  /** Where each open tag is, so a close can be matched against its opener. */
  const stack: Array<{ name: string; path: string; attributes: Record<string, string> }> = [];
  let index = 0;

  const path = (): string => (stack.length === 0 ? 'document' : stack.map((f) => f.name).join(' > '));

  while (index < tokens.length) {
    const token = tokens[index]!;

    if (token.kind === 'text') {
      if (stack.length === 0 && token.value.trim() !== '') {
        fail(
          context,
          'document',
          'text has to be inside a <p> or a heading; the editor wraps a plain line in <p>, and ' +
            'accepting it here would have the editor invent a paragraph the author never wrote',
        );
      }
      index += 1;
      continue;
    }

    if (token.kind === 'close') {
      const open = stack.pop();
      if (!open) {
        fail(context, 'document', `</${token.name}> closes a tag that was never opened`);
      } else if (open.name !== token.name) {
        fail(context, open.path, `</${token.name}> closes <${open.name}>`);
      }
      index += 1;
      continue;
    }

    const { name } = token;
    const here = stack.length === 0 ? 'document' : path();
    const known =
      INLINE_SET.has(name) || PARAGRAPH_SET.has(name) || LIST_SET.has(name) || name === 'li' || name === 'p';

    if (!known) {
      fail(context, here, `<${name}> is not part of the note format`);
      index += 1;
      continue;
    }

    if (!checkAttributes(context, here, name, token.attributes, allowedAttributesFor(name, token.attributes))) {
      index += 1;
      continue;
    }

    if (name === 'a' && !token.attributes['href']) {
      fail(context, here, '<a> needs an href');
    }
    if (name === 'img' && !token.attributes['src']) {
      fail(context, here, '<img> needs a src');
    }
    if (name === 'img') {
      for (const key of IMAGE_DIMENSIONS) {
        const raw = token.attributes[key];
        if (raw === undefined) continue;
        const size = Number(raw);
        if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_EDGE) {
          fail(
            context,
            here,
            `<img> ${key} has to be a whole number of pixels between 1 and ${MAX_IMAGE_EDGE}, and "${raw}" is not`,
          );
        }
      }
    }
    if (name === 'li' && token.attributes['checked'] !== undefined) {
      const owner = stack[stack.length - 1];
      const insideCheckboxList =
        owner !== undefined && owner.name === 'ul' && owner.attributes['data-type'] === 'checkbox';
      if (!insideCheckboxList) {
        fail(
          context,
          here,
          'checked is only valid on a line of a checkbox list, and this one is not in it',
        );
      }
    }

    if (token.selfClosing && !VOID_SET.has(name)) {
      fail(context, here, `<${name}> is not a void tag, so it cannot close itself`);
    }

    if (VOID_SET.has(name)) {
      // `<br>` and `<img>` have no children, so they are never pushed. Both
      // `<br>` and `<br />` are accepted: the editor emits the first and the
      // format is HTML, not XHTML. A stray `</br>` is caught above as a close
      // with no opener.
      index += 1;
      continue;
    }

    stack.push({ name, path: here, attributes: token.attributes });
    index += 1;
  }

  for (const open of stack) {
    fail(context, open.path, `<${open.name}> is never closed`);
  }
}

/**
 * Everything wrong with a document, in the order it was found.
 *
 * Empty means the document is in the format. The list is capped so a hostile
 * document cannot make the error a thousand lines long.
 */
export function validateNoteDocument(html: string): DocumentProblem[] {
  const context: Context = { problems: [] };

  // Unwrapped first, so calling this on whatever the editor hands over answers
  // the same whether that is the body or the whole document. Validating the
  // wrapper instead would reject a note the editor wrote and never opened.
  const body = unwrapDocumentHtml(html);
  if (body.length === 0) return context.problems;

  const tokens = tokenize(body, context.problems);
  walk(tokens, context);
  return context.problems;
}

/* ----------------------------------------------------------------- schema --- */

/**
 * The stored form of a document: the body, never the wrapper.
 *
 * The pre-processing is the point. A schema is the boundary, and the editor that
 * writes the boundary does not know whether the platform it is on wraps its
 * value. Normalising here means the client, the API and the validator all store
 * and compare the same string, and a note written on the web is byte-for-byte
 * the note you would have written on a phone.
 */
export const noteDocumentSchema = z.preprocess(
  (value) => (typeof value === 'string' ? unwrapDocumentHtml(value) : value),
  z
    .string()
    .max(NOTE_DOCUMENT_MAX_BYTES, 'a note is larger than the format allows')
    .superRefine((body, ctx) => {
      for (const problem of validateNoteDocument(body)) {
        ctx.addIssue({
          code: 'custom',
          message: `${problem.path}: ${problem.reason}`,
        });
      }
    }),
);

/** A note document: HTML, in the format the editor produces. */
export type NoteDocument = z.infer<typeof noteDocumentSchema>;

/* -------------------------------------------------------------- plain text -- */

/** Tags whose opening means a new line of text starts. */
const BLOCK_BREAKS: ReadonlySet<string> = new Set<string>([
  'p',
  ...PARAGRAPH_TAGS,
  ...LIST_TAGS,
  'li',
]);

/**
 * The text of a document, for search and for previews.
 *
 * Stripping tags rather than asking the editor for it, because the same answer
 * has to come out of the API, of the phone and of the browser, and a preview is
 * not worth a round trip to a component.
 */
export function noteDocumentToPlainText(html: string): string {
  const context: Context = { problems: [] };
  const tokens = tokenize(html, context.problems);

  let out = '';
  /** Inside a tag whose contents are code or markup, not prose. */
  let skipping = 0;

  for (const token of tokens) {
    if (token.kind === 'text') {
      // A newline in the source is whitespace, not a line break: in HTML it
      // renders as a space. Letting it through would split a sentence in two
      // and a search for a phrase would stop matching across the wrap.
      if (skipping === 0) out += token.value.replace(/\s+/g, ' ');
      continue;
    }
    if (token.kind === 'open') {
      if (token.name === 'script' || token.name === 'style') skipping += 1;
      if (skipping === 0 && (BLOCK_BREAKS.has(token.name) || token.name === 'br')) out += '\n';
      continue;
    }
    // A close tag.
    if (skipping > 0 && (token.name === 'script' || token.name === 'style')) skipping -= 1;
  }

  // A line break per line, not per tag, and no leading or trailing blank space:
  // this string is compared, indexed and shown in a one-line preview.
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/** A first line to put on a card, with a length it can be relied on to have. */
export const NOTE_PREVIEW_MAX_CHARS = 140;

export function noteDocumentToPreview(html: string): string {
  const text = noteDocumentToPlainText(html).replace(/\n/g, ' · ');
  return text.length <= NOTE_PREVIEW_MAX_CHARS
    ? text
    : `${text.slice(0, NOTE_PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * The line a note shows under its title.
 *
 * A note whose first block is its own heading would otherwise show the same two
 * words twice, in the title and again in the line under it, which reads as a bug
 * to whoever is looking at it. So the title is cut off the front when the body
 * starts with it.
 *
 * This lives here rather than in the app and in the API separately, because the
 * two answers have to be the same string: a list that shows "Salsa · Seis tomates"
 * and a search hit that shows "Seis tomates" are the same note described two ways,
 * and a person who sees both knows one of them is lying.
 */
export function notePreviewBelowTitle(html: string, title: string): string {
  const body = noteDocumentToPreview(html);
  if (body.length === 0) return '';
  const trimmed = title.trim();
  if (trimmed.length > 0 && body.startsWith(trimmed)) {
    return body.slice(trimmed.length).replace(/^[·\s]+/, '');
  }
  return body;
}
