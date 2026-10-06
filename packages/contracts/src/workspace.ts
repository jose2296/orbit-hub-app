import { z } from "zod";

import { iconRefSchema } from "./icons.js";
import { normalizaColor, tagColorSchema } from "./tag-colors.js";
import { emailSchema, isoDateTimeSchema, uuidSchema } from "./common";
import { syncableEntitySchema } from "./api";
import { userSchema } from "./auth";
import { noteDocumentSchema } from "./note-document";

export const membershipRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

/** Numeric rank used by the API for permission comparisons. */
export const membershipRoleRank: Record<MembershipRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export const membershipSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  user: userSchema.pick({
    id: true,
    email: true,
    displayName: true,
    avatarUrl: true,
  }),
  role: membershipRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

/**
 * The named colours a space can be painted with.
 *
 * They live in the contract because the server refuses a colour it does not know
 * and the app cannot draw one that is not here, and neither of them can be a
 * step behind the other.
 *
 * Twelve, and the list used to be eight. A person who wants "the purple one" and
 * gets the indigo one is not choosing a colour, and the answer to that is not to
 * add forty shades — it is the custom colour below, which is unbounded and is
 * the reason this list can stay short enough to pick from on a phone.
 */
export const WORKSPACE_COLORS = [
  "teal",
  "indigo",
  "rose",
  "amber",
  "moss",
  "sky",
  "violet",
  "slate",
  "plum",
  "crimson",
  "forest",
  "copper",
] as const;
export const workspaceColorKeySchema = z.enum(WORKSPACE_COLORS);
export type WorkspaceColorKey = z.infer<typeof workspaceColorKeySchema>;

/**
 * A colour a person made up, as `#RRGGBB`.
 *
 * **It normalises, which is what the line above it claimed all along.** It used to
 * be a `z.string().regex(/^#[0-9A-F]{6}$/)` under a comment saying that normalising
 * here is what stops the app and the API from being the ones deciding whether a
 * string is a colour. A regex does the opposite of that: it **validates** without
 * **normalising**. So `#abc`, `a1b2c3` and `#a1b2c3` were all refused here, all
 * three of which are colours this app draws, and the app's own validators had
 * already accepted them. It now runs the value through `normalizaColor` — the one
 * rule — and answers six digits, uppercase, with the `#`: `#abc` becomes
 * `#AABBCC`, `a1b2c3` becomes `#A1B2C3`. `red` and `javascript:` are still refused,
 * which is the half that was right.
 *
 * **Widening, never narrowing, and that is a decision about who gets hurt.** Stored
 * data is already six digits and uppercase, so nothing that exists moves: the old
 * rule was six digits with the `#` in uppercase, and a value that passes it today
 * passes the new one unchanged. What changes is what is *accepted*, and the test in
 * `apps/api/test/workspaces.test.ts` pins all three halves — `#abc`, `a1b2c3` and
 * `#1F6FEB` stored as `#AABBCC`, `#A1B2C3` and `#1F6FEB`.
 */
export const workspaceColorHexSchema = z.string().transform((value, ctx) => {
  const hex = normalizaColor(value);
  if (hex === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'A custom space colour is a hex of three or six digits',
    });
    return z.NEVER;
  }
  return hex;
});

/**
 * A named colour from the list, or a custom one.
 *
 * Both, because the choice a person makes is "one of these" or "this exact
 * shade", and a model with two fields has to decide which one wins. One field
 * with two shapes has no such question: the string is either a name the app knows
 * or a colour it can draw, and everything downstream asks that first.
 */
export const workspaceColorSchema = z.union([
  workspaceColorKeySchema,
  workspaceColorHexSchema,
]);
export type WorkspaceColor = z.infer<typeof workspaceColorSchema>;

/**
 * How a space's colour is painted, over and above which colours it is.
 *
 * **Two, and there were five.** The complementary and the triadic rotated the
 * hue, which is a lot of cleverness for something whose text has to stay
 * readable on every part of it, and in use the results were bad rather than
 * bold: a triadic on a mid-blue is three colours that do not look like a space
 * of that blue. The split was a hard edge down the middle of a card, which is a
 * thing a design does once and not a thing a person chooses for their own list
 * of films.
 *
 * What is left is the two that are honestly two: the same two colours, drawn in
 * two directions. Everything interesting is in *which two colours*, and that is
 * what `colorTo` is for.
 */
export const WORKSPACE_WASHES = [
  /** The first colour into the second, corner to corner. */
  "diagonal",
  /** The first colour into the second, top to bottom. */
  "vertical",
] as const;
export const workspaceWashSchema = z.enum(WORKSPACE_WASHES);
export type WorkspaceWash = z.infer<typeof workspaceWashSchema>;

/** The shape a wash is drawn in, which is not the same as which one it is. */
export const workspaceWashShapeSchema = z.enum(["diagonal", "vertical"]);
export type WorkspaceWashShape = z.infer<typeof workspaceWashShapeSchema>;

/** Whether a value is one of the names the app offers, and not a custom colour. */
export function isWorkspaceColorKey(value: unknown): value is WorkspaceColorKey {
  return (
    typeof value === "string" &&
    (WORKSPACE_COLORS as readonly string[]).includes(value)
  );
}

/**
 * Whether a value is a custom `#RRGGBB`, and not one of the names.
 *
 * Wider than it reads, and wider for free: it asks the schema above, and that
 * schema now **normalises** rather than validating with a regex of its own, so a
 * three-digit `#abc` and a lowercase `#aabbcc` are both a custom colour. Before,
 * this would have said no to both.
 */
export function isWorkspaceColorHex(value: unknown): value is string {
  return typeof value === "string" && workspaceColorHexSchema.safeParse(value).success;
}

/**
 * Los anchos de los campos de texto, como datos.
 *
 * Estos números estaban en tres sitios que no se hablaban: el `.max()` de cada
 * esquema de abajo, el `varchar` de `apps/api/src/db/content-schema.ts` y un
 * `.slice()` en el sanitizador de sync. No coincidían, y no era cosmético: un
 * nombre de espacio de 81 caracteres pasaba el 120 del sanitizador y llegaba a la
 * columna de 80 — un **500** con entrada corriente, y `The operation failed` como
 * único mensaje para el móvil. El título de una nota de 121 perdía 80
 * caracteres calladamente y el push respondía `applied`.
 *
 * Exportarlos desde aquí los convierte en la fuente única: el esquema valida con
 * ellos, la API corta con ellos, y la app pinta el contador con ellos. Un test en
 * `apps/api/test/sync-limits.test.ts` lee los `varchar` reales y los compara, así
 * que una migración que cambie un ancho rompe el test en vez de romper producción.
 */
export const WORKSPACE_NAME_MAX = 80;
export const WORKSPACE_DESCRIPTION_MAX = 500;
export const FOLDER_NAME_MAX = 120;
export const LIST_TITLE_MAX = 120;
export const LIST_DESCRIPTION_MAX = 1000;
export const LIST_ITEM_TITLE_MAX = 300;
export const LIST_ITEM_ANNOTATION_MAX = 2000;
export const LIST_ITEM_EXTERNAL_ID_MAX = 120;
/** Una etiqueta, no un título: corta a propósito y se ve corta. */
export const TAG_MAX = 40;
export const NOTE_TITLE_MAX = 200;

export const workspaceSchema = syncableEntitySchema.extend({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
  description: z.string().max(WORKSPACE_DESCRIPTION_MAX).nullable().default(null),
  icon: iconRefSchema.default(null),
  /**
   * The colour this space is painted with, out of the eight the app offers.
   *
   * A key and not a hex value: the person picks from the eight and the app
   * draws them, so there is no colour nobody can read and no need for a colour
   * picker to exist on a phone. A space written before there were colours reads
   * with the default one.
   */
  color: workspaceColorSchema.default("slate"),
  role: membershipRoleSchema,
  memberCount: z.int().min(1),
  /**
   * Whether you are here because somebody shared it rather than because you were
   * made a member.
   *
   * A flag and not a role, and the reason is that a role cannot say it: somebody
   * with a `viewer` grant on a shared space and somebody who was invited as a
   * viewer are the same two words and not the same thing. The first has a person
   * on the other side who can take it back; the second is a membership. The app
   * draws a symbol on the first and says why, and guessing from the role would
   * put that symbol on spaces that are simply not shared.
   */
  shared: z.boolean().default(false),
  /**
   * Which of the two ways this space's colour is painted.
   *
   * A field and not something the app works out from the colours: the whole point
   * of offering a choice is that the person made it, and a derived style is a
   * style that cannot be chosen.
   */
  wash: workspaceWashSchema.default("diagonal"),
  /**
   * The colour the wash ends in, as its own field.
   *
   * A second colour and not a "how much darker" step, because that is what
   * "change the colour of each side" means: the person picks the two ends the way
   * they pick the first one, from the same twelve or from their own hex. A
   * lightness slider is a different product and a worse one — it can only ever
   * make the second end a version of the first, and the pairs worth having are
   * not versions of each other.
   *
   * Null is the honest default and not a copy of `color`: it says "the second
   * end has not been chosen", and the app falls back to the darker version of the
   * first until it has. A row that lies by default is a row somebody has to open
   * the app to check.
   */
  colorTo: workspaceColorSchema.nullable().default(null),
});
export type Workspace = z.infer<typeof workspaceSchema>;

/**
 * What you can do with a node, and whether it is yours or it was handed to you.
 *
 * Two fields and they are not the same question, which is the whole reason they
 * are not one:
 *
 * - `role` is about **the contents**: edit or only look. It is the ceiling logic of
 *   ADR 0031 applied — a grant never lifts you above a space you are already in —
 *   and it is computed by one function on the server, not here and not on the app.
 * - `shared` is about **how you got it**: `false` means you are a member of its
 *   space and it is yours, `true` means somebody handed it to you and you are not a
 *   member. A list three colleagues also have is still `shared: false`: it is in
 *   your space, it is yours, and they were given a copy of the same link.
 *
 * How many *other* people a node reaches is a third thing and is deliberately not
 * here — it changes every time somebody shares it, and it is a question with an
 * endpoint: `GET /shares/:nodeType/:nodeId/reach`.
 *
 * On every syncable entity rather than on a separate call, because the screen that
 * draws the badge is a header, and a header that has to wait for a second request to
 * know whether to draw anything flickers in exactly the place where the answer is
 * most wanted.
 */
export const nodeAccessSchema = z.object({
  role: membershipRoleSchema,
  shared: z.boolean().default(false),
});
export type NodeAccess = z.infer<typeof nodeAccessSchema>;

export const folderSchema = syncableEntitySchema
  .extend({
    workspaceId: uuidSchema,
    parentId: uuidSchema.nullable().default(null),
    name: z.string().trim().min(1).max(FOLDER_NAME_MAX),
    icon: iconRefSchema.default(null),
    position: z.number().int().min(0),
  })
  .extend(nodeAccessSchema.shape);
export type Folder = z.infer<typeof folderSchema>;

/**
 * The kinds of list, and they never mix.
 *
 * A list is a films list, a series list, a films and series list, a books list
 * or a tasks list, and it is one of them for good. The reason is the reading:
 * a list of films is a shelf of covers and a list of tasks is a checklist, and
 * a list that is both is a shelf with a checkbox on it, which is neither.
 *
 * `movies_and_series` exists because wanting to see a film and a series is one
 * intention, and splitting it by hand is work the app should not ask for.
 */
export const listKindSchema = z.enum([
  "tasks",
  "movies",
  "series",
  "movies_and_series",
  "books",
]);
export const listKindLabelKey = {
  tasks: "lists.kind.tasks",
  movies: "lists.kind.movies",
  series: "lists.kind.series",
  movies_and_series: "lists.kind.moviesAndSeries",
  books: "lists.kind.books",
} as const satisfies Record<z.infer<typeof listKindSchema>, string>;
export type ListKind = z.infer<typeof listKindSchema>;

/**
 * The icons a row of a list can carry.
 *
 * A list of tasks is also a shopping list, a packing list or a list of repairs,
 * and an icon is what makes a row of "pan" and "tomate" and "papel" readable at a
 * glance without reading it. They are keys and not emojis because an emoji looks
 * different on every device and means something different to everyone.
 *
 * They live here and not in either app so there is one list: the API refuses a
 * key it does not know, and the app cannot draw one it does not have, and
 * neither of them can be a step behind the other.
 */
export {
  EXTRA_BY_CATEGORY,
  EXTRA_KEYWORDS,
  EXTRA_LABELS,
} from "./icons-catalogo-ampliado.js";
export {
  ITEM_ICON_COLORS,
  ITEM_ICONS,
  iconColorSchema,
  iconRefSchema,
  iconSchema,
  isVectorIcon,
  labelOf,
  sanitiseIconRef,
  vectorGlyph,
  vectorIconsOf,
  VECTOR_ICON_CATALOG,
  VECTOR_ICON_CATEGORIES,
  VECTOR_ICON_CATEGORY_LABEL,
  VECTOR_ICON_GLYPHS,
  VECTOR_ICON_KEYWORDS,
} from "./icons.js";
export type { IconRef, IconColor, ItemIconColor, VectorIconCategory } from "./icons.js";

export {
  TAG_HEX,
  tagColorSchema,
  derivedTagColor,
  normalizaColor,
  sanitiseTagColors,
} from "./tag-colors.js";
export type { TagColors } from "./tag-colors.js";

/**
 * The ways a list can be ordered.
 *
 * `manual` is the order the items are in. The rest are how to read them, and
 * none of them change that order.
 */
export const prioritySchema = z.enum(["none", "low", "medium", "high"]);
export type Priority = z.infer<typeof prioritySchema>;

export const listOrderModeSchema = z.enum([
  "manual",
  "alphabetical",
  "alphabetical_desc",
  "created_desc",
  "created_asc",
  "updated_desc",
  "priority",
  /**
   * By when the thing came out, and the two directions.
   *
   * These are for a list of films, series or books, where "which do I want first"
   * is very often "which came out first" and there is no other answer. A shopping
   * list has no release date and does not offer them: the orders are offered by
   * the screens that have something to sort by, not by the contract as a whole.
   *
   * The column is a `varchar(24)`, so these needed no migration — only the
   * contract and the two places that read them.
   */
  "released_asc",
  "released_desc",
]);
export type ListOrderMode = z.infer<typeof listOrderModeSchema>;

/** Whether a row can be dragged under this order. */
export function isManualOrder(mode: ListOrderMode): boolean {
  return mode === "manual";
}

export const listSchema = syncableEntitySchema
  .extend({
    workspaceId: uuidSchema,
    folderId: uuidSchema.nullable().default(null),
    kind: listKindSchema,
    title: z.string().trim().min(1).max(LIST_TITLE_MAX),
    description: z.string().max(LIST_DESCRIPTION_MAX).nullable().default(null),
    icon: iconRefSchema.default(null),
    tags: z.array(z.string().trim().min(1).max(TAG_MAX)).max(20).default([]),
    /**
     * The colours of the labels of this list, and only the ones somebody chose.
     *
     * A label's colour is a property of the **list**, so everyone looking at a
     * shared list sees "Mercadona" in the same colour, and changing it recolours
     * every task that carries it at once. On the task it would mean two tasks
     * with the same label in two colours, and then the colour says nothing.
     *
     * Absent means "nobody chose", and the label falls back to
     * `derivedTagColor(tag)`, which is why existing labels get a colour the moment
     * this ships and why there is no backfill to run. That fallback can be
     * `neutral` — it is one of the twelve — so the key being absent is the only
     * thing that records the choice; the colour itself does not.
     */
    tagColors: tagColorSchema.default({}),
    position: z.number().int().min(0),
    itemCount: z.int().min(0).default(0),
    /**
     * How the items of this list are ordered, and the default is the order the
     * person put them in.
     *
     * It is a property of the list and not of the person, so everyone looking at
     * a shared list sees the same order, which is the only way a list somebody
     * else arranged still means something to you. Changing it never renumbers
     * anything: the manual order is kept and is what the list goes back to, so
     * choosing an order to look at something is not a way of losing it.
     *
     * The drag only exists while this is `manual`, because a row moved under an
     * alphabetical order lands somewhere the order did not ask for.
     */
    orderMode: listOrderModeSchema.default("manual"),
  })
  .extend(nodeAccessSchema.shape);
export type List = z.infer<typeof listSchema>;

/**
 * One row covers the three list kinds. `externalId` points at the provider
 * record (TMDB / Google Books) and `metadata` keeps the raw provider payload
 * so the app can render offline without calling the provider again.
 */
export const listItemSchema = syncableEntitySchema
  .extend({
  listId: uuidSchema,
  title: z.string().trim().min(1).max(LIST_ITEM_TITLE_MAX),
  position: z.number().int().min(0),
  completed: z.boolean().default(false),
  /**
   * How urgent the row is, in words and not in a number: a number is something
   * to sort by and nothing to read, and "alta" on a shopping list says why you
   * are looking at it.
   */
  priority: z.enum(["none", "low", "medium", "high"]).default("none"),
  /**
   * The icon, as one value.
   *
   * It was three fields — `icon` as a key out of the ones the app offers,
   * `iconStyle` and `iconColor` — and three fields can disagree with each
   * other. As one value they cannot: a system emoji or one of the app's line
   * drawings, with the colour it was given. Null is "nobody chose an icon",
   * which the app knows how to draw.
   */
  icon: iconRefSchema.default(null),
  /**
   * Free labels, so "Mercadona" and "Carrefour" are values and not folders:
   * the same thing to buy in two shops is one item to buy.
   */
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  externalId: z.string().max(LIST_ITEM_EXTERNAL_ID_MAX).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
  /**
   * A short remark on the row itself, in words. "Buy milk, *bring your own*".
   *
   * Named `annotation` and not `notes` on purpose. It was called `notes`, and the
   * name was read as a claim that a note is this column rather than an entity of
   * its own, which is how a note ended up with no table, no attachments and no
   * way to be shared. This is a remark on a row; a note is a document and lives
   * in `noteSchema`. See [ADR 0008](../../docs/architecture/adr/0008-note-entity.md).
   */
  annotation: z.string().max(LIST_ITEM_ANNOTATION_MAX).nullable().default(null),
})
  .extend(nodeAccessSchema.shape);
export type ListItem = z.infer<typeof listItemSchema>;

/**
 * Notes store the HTML the editor produces, validated against the closed tag set
 * it accepts. It was a ProseMirror document when the plan was a block editor on
 * the web too; there is one editor now, so the stored format is exactly what the
 * editor writes and nothing has to be converted. See `./note-document.ts` and
 * `docs/architecture/adr/0009-one-native-editor.md`.
 */
export const noteSchema = syncableEntitySchema
  .extend({
    workspaceId: uuidSchema,
    folderId: uuidSchema.nullable().default(null),
    title: z.string().trim().min(1).max(NOTE_TITLE_MAX),
    document: noteDocumentSchema,
    plainText: z.string().default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    icon: iconRefSchema.default(null),
    attachmentCount: z.int().min(0).default(0),
    /**
     * Where this note sits among the things in its folder when somebody has put
     * them in an order by hand. Zero means not placed, and the browser sorts those
     * last so a note written before the order existed never jumps to the top of
     * somebody's arrangement.
     */
    position: z.number().int().min(0).default(0),
  })
  .extend(nodeAccessSchema.shape);
export type Note = z.infer<typeof noteSchema>;

export const attachmentSchema = z.object({
  id: uuidSchema,
  noteId: uuidSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  /** Object storage key, never a public URL, so access stays authorisable. */
  storageKey: z.string().min(1),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  createdAt: isoDateTimeSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

/* ------------------------------------------------------------- adjuntos ---- */

/**
 * What a note will accept.
 *
 * A list and not a regex at the point of use, because the client asks the server
 * what it will take and the server is the one that has to be believed. `svg` is on
 * the list and is also the reason the list exists: an SVG is a document that runs
 * code, so it is only ever shown as a file and never rendered inside a note.
 */
export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/pdf',
  'text/plain',
] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/** Types the editor will draw inside the document rather than offer as a file. */
export const INLINE_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
] as const;

export function isAllowedAttachmentMime(value: string): boolean {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}

export function isInlineImageMime(value: string): boolean {
  return (INLINE_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** Whether it is a picture at all, which is what picks the size ceiling. */
export function isImageMime(value: string): boolean {
  return value.startsWith('image/');
}

/**
 * The size ceilings, in one place.
 *
 * The server may raise them with configuration, and the client uses these to
 * answer before it sends anything. A number copied into the app would be a number
 * that drifts, and the failure is a person told a file is too big when it is not.
 */
export const ATTACHMENT_MAX_BYTES_DEFAULT = 20 * 1024 * 1024;
export const ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;

/**
 * Step one of an upload: the client says what it has and gets a place to put it.
 *
 * The key comes from the server and the bytes go straight there, so nothing is
 * buffered here. The row does not exist yet: a file nobody finished uploading is
 * not an attachment, it is a row somebody has to clean up.
 */
export const createAttachmentTicketRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120).refine(isAllowedAttachmentMime, {
    message: 'That kind of file is not accepted',
  }),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
});
export type CreateAttachmentTicketRequest = z.infer<
  typeof createAttachmentTicketRequestSchema
>;

export const createAttachmentTicketResponseSchema = z.object({
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
  storageKey: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type CreateAttachmentTicketResponse = z.infer<
  typeof createAttachmentTicketResponseSchema
>;

/**
 * Step two: the bytes are in storage and now the file is part of the note.
 *
 * The server checks the key is one it handed out and that the object is really
 * there. A client that confirms a key it was not given gets a 404 rather than a
 * row pointing at somebody else's file.
 */
export const confirmAttachmentRequestSchema = z.object({
  storageKey: z.string().min(1).max(512),
  sizeBytes: z.number().int().positive(),
  /**
   * Repeated on purpose rather than remembered from the ticket.
   *
   * The ticket is about bytes and this is about a row, and a server that trusted
   * what it said half a request ago would have two sources of truth for the same
   * file. Re-sending is three fields, and the values are validated again here the
   * same way they were there — a client cannot describe a file one way to be let
   * in and another way to be stored.
   */
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120).refine(isAllowedAttachmentMime, {
    message: 'That kind of file is not accepted',
  }),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
});
export type ConfirmAttachmentRequest = z.infer<typeof confirmAttachmentRequestSchema>;

export const listAttachmentsResponseSchema = z.object({
  items: z.array(attachmentSchema),
});
export type ListAttachmentsResponse = z.infer<typeof listAttachmentsResponseSchema>;

export const invitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const invitationSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  role: membershipRoleSchema.exclude(["owner"]),
  token: z.string().min(10),
  status: invitationStatusSchema,
  invitedBy: userSchema.pick({ id: true, displayName: true }),
  invitedEmail: emailSchema.nullable().default(null),
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  acceptedAt: isoDateTimeSchema.nullable().default(null),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  icon: iconRefSchema.optional(),
});
export type CreateWorkspaceRequest = z.infer<
  typeof createWorkspaceRequestSchema
>;

export const createFolderRequestSchema = z.object({
  workspaceId: uuidSchema,
  parentId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  icon: iconRefSchema.optional(),
  position: z.number().int().min(0).default(0),
});
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>;

export const createListRequestSchema = z.object({
  workspaceId: uuidSchema,
  folderId: uuidSchema.nullable().default(null),
  kind: listKindSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  icon: iconRefSchema.optional(),
  position: z.number().int().min(0).default(0),
});
export type CreateListRequest = z.infer<typeof createListRequestSchema>;

export const createInvitationRequestSchema = z.object({
  workspaceId: uuidSchema,
  role: membershipRoleSchema.exclude(["owner"]),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});
export type CreateInvitationRequest = z.infer<
  typeof createInvitationRequestSchema
>;

/**
 * Changing somebody's role.
 *
 * `owner` is not a role you can hand out with this: a space has one owner, and
 * handing it over is a different act with different consequences, so it is not
 * offered here rather than refused at the last moment.
 */
export const updateMemberRoleRequestSchema = z.object({
  role: membershipRoleSchema.exclude(["owner"]),
});
export type UpdateMemberRoleRequest = z.infer<
  typeof updateMemberRoleRequestSchema
>;

/* ---------------------------------------------------------------- reads ---- */

/**
 * Reads are REST, writes go through `/sync/push`.
 *
 * A single read path keeps the client simple: every screen loads from the local
 * cache, and the cache is filled either by a pull or by a first load. There is
 * no second write path that could disagree with the sync protocol.
 */

export const listWorkspacesResponseSchema = z.object({
  items: z.array(workspaceSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListWorkspacesResponse = z.infer<
  typeof listWorkspacesResponseSchema
>;

export const listFoldersResponseSchema = z.object({
  items: z.array(folderSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListFoldersResponse = z.infer<typeof listFoldersResponseSchema>;

export const workspaceMemberSchema = z.object({
  user: userSchema.pick({
    id: true,
    email: true,
    displayName: true,
    avatarUrl: true,
  }),
  role: membershipRoleSchema,
  joinedAt: isoDateTimeSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const listWorkspaceMembersResponseSchema = z.object({
  items: z.array(workspaceMemberSchema),
});
export type ListWorkspaceMembersResponse = z.infer<
  typeof listWorkspaceMembersResponseSchema
>;

export const listInvitationsResponseSchema = z.object({
  items: z.array(invitationSchema),
});
export type ListInvitationsResponse = z.infer<
  typeof listInvitationsResponseSchema
>;

/**
 * What accepting an invitation gives back.
 *
 * The workspace, so the app lands on it instead of making the person look for
 * it, and whether they were already a member: accepting a link twice is not an
 * error, it is somebody clicking twice.
 */
export const acceptInvitationResponseSchema = z.object({
  workspace: workspaceSchema,
  alreadyMember: z.boolean().default(false),
});
export type AcceptInvitationResponse = z.infer<
  typeof acceptInvitationResponseSchema
>;

/** The invitation behind a link, before deciding about it. */
export const previewInvitationResponseSchema = z.object({
  workspace: z.object({
    id: uuidSchema,
    name: z.string(),
    icon: iconRefSchema.default(null),
    color: workspaceColorSchema,
  }),
  role: membershipRoleSchema.exclude(["owner"]),
  invitedBy: z.string(),
  /** Who it was addressed to, or null when the link can be used by anybody. */
  invitedEmail: z.string().nullable().default(null),
  /** Whether the person reading it is the one it was sent to. */
  isForYou: z.boolean(),
  alreadyMember: z.boolean(),
  expiresAt: isoDateTimeSchema,
});
export type PreviewInvitationResponse = z.infer<
  typeof previewInvitationResponseSchema
>;

/** How many screens of widgets the dashboard can have. */
export const DASHBOARD_PAGES = 8;

/** Dashboard widget grid. Mirrors the JSON stored in `dashboard_layouts`. */
export const dashboardWidgetSchema = z.object({
  id: z.string().min(1).max(64),
  /**
   * What the card is.
   *
   * `folder` is here because a folder is a place you can jump to, exactly like a
   * list is, and the panel shows places. The kinds that are not a thing anybody
   * pins — `tasks`, `stats`, `calendar`, `quick_actions` — are what the panel
   * started life with, before it showed the person's own lists; they are still
   * accepted so that a layout written then is not emptied out of everything, and
   * nothing creates them.
   */
  kind: z.enum([
    "recent_lists",
    "recent_notes",
    "folder",
    "tasks",
    "quick_actions",
    "calendar",
    "stats",
  ]),
  x: z.number().int().min(0).max(23),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
  /**
   * Which screen of the panel this card is on.
   *
   * A phone cannot show twenty-four rows of cards, and a card that does not fit
   * is a card nobody can reach. So the panel has as many screens as the person
   * needs and the card carries which one it is on, the way it carries how big it
   * is. It has a default, so a layout written before there were screens reads
   * with every card on the first one instead of failing to parse.
   */
  page: z.number().int().min(0).max(DASHBOARD_PAGES - 1).default(0),
  pinned: z.boolean().default(false),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;

export const dashboardLayoutSchema = z.object({
  userId: uuidSchema,
  layout: z.array(dashboardWidgetSchema).max(24),
  version: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
});
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

/* ---------------------------------------------------------------- lists ---- */

/** Search across everything the caller can see. One endpoint, one query. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  workspaceId: uuidSchema.optional(),
  kind: listKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/* --------------------------------------------------------------- compartir -- */

/**
 * What can be shared. Six node types, and a note is one of them.
 *
 * It used to say here that a note is the `notes` column of an item and so is
 * never a node of its own. That was a decision about sharing written as a claim
 * about the data model, and Phase 4 made it false: a note is a document, and
 * `list_items` has a short plain-text `annotation`. See
 * [ADR 0008](../../docs/architecture/adr/0008-note-entity.md).
 */
/**
 * What can be shared. Five node types, and a note is one of them.
 *
 * It used to be six, with `note_template` at the end, and it was a promise the
 * other side of the codebase never kept — which is worse than not offering it.
 *
 * **Why it goes.** A template is not shareable to a person, and three separate
 * facts say so:
 *
 * - `toEntityName` in the sync repository returns `null` for it, so **revoking a
 *   template share produced no tombstone**: the device that had it kept showing it
 *   forever. There was no way to take it back.
 * - Templates already have their own mechanism — a `scope` of personal, workspace
 *   or public, with its own `share()` — which hands one to a space or to everybody
 *   and never to a single person. Two mechanisms for one thing, one of them
 *   half-built.
 * - And there is no answer to where the recipient files it. A note has a place
 *   because it has a space and a folder; a template is in no tree at all.
 *
 * So it is out of the enum and out of the database CHECK. If it is ever wanted it
 * is another ADR, with a tombstone and a place to put it. See
 * [ADR 0032](../../docs/architecture/adr/0032-personas.md).
 */
export const shareNodeTypeSchema = z.enum([
  'workspace',
  'folder',
  'list',
  'list_item',
  'note',
]);
export type ShareNodeType = z.infer<typeof shareNodeTypeSchema>;

/**
 * editor or viewer, and deliberately not owner.
 *
 * There is one owner per space and it is not given away here. Somebody who can
 * edit fifty items still cannot decide that a sixth person sees them, and adding
 * an owner to a grant would put a second owner on a thing that already has one.
 */
export const shareRoleSchema = z.enum(['editor', 'viewer']);
export type ShareRole = z.infer<typeof shareRoleSchema>;

export const shareSchema = z.object({
  id: uuidSchema,
  nodeType: shareNodeTypeSchema,
  nodeId: uuidSchema,
  role: shareRoleSchema,
  /** The name of the thing, so the inbox does not need a second request. */
  title: z.string(),
  /** The space it lives in, which is not yours. */
  workspaceId: uuidSchema,
  /** Who shared it, so the inbox can say who. Null if that account is gone. */
  ownerName: z.string().nullable().default(null),
  /** Where it is filed in your tree, or null while it is still in the inbox. */
  placedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type Share = z.infer<typeof shareSchema>;

export const shareListResponseSchema = z.object({ items: z.array(shareSchema) });
export type ShareListResponse = z.infer<typeof shareListResponseSchema>;

/**
 * What has arrived at you, with the date it arrived.
 *
 * Deliberately **not** `shareSchema`: this one has no `nodeId`, no `workspaceId` and
 * no `placedAt`, because none of them answer "has something new arrived". It exists to
 * be counted, so it carries the least that a count needs — and a whole space is in it,
 * which `Share` cannot be, since a space is not something you file.
 */
export const incomingShareSchema = z.object({
  id: uuidSchema,
  nodeType: shareNodeTypeSchema,
  title: z.string(),
  ownerName: z.string().nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type IncomingShare = z.infer<typeof incomingShareSchema>;

export const incomingSharesResponseSchema = z.object({
  items: z.array(incomingShareSchema),
});
export type IncomingSharesResponse = z.infer<typeof incomingSharesResponseSchema>;

export const createShareRequestSchema = z.object({
  nodeType: shareNodeTypeSchema,
  nodeId: uuidSchema,
  /** Who it is for. By id when they are already in the app, by mail otherwise. */
  granteeUserId: uuidSchema.optional(),
  granteeEmail: z.string().max(254).optional(),
  role: shareRoleSchema,
});
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;

/** Where a received thing is filed, in your own tree. */
export const placeShareRequestSchema = z.object({
  shareId: uuidSchema,
  workspaceId: uuidSchema,
  /** Null is the root of the space, which is a place and not "nowhere". */
  folderId: uuidSchema.nullable().default(null),
  position: z.number().int().min(0).optional(),
});
export type PlaceShareRequest = z.infer<typeof placeShareRequestSchema>;

/**
 * Who a delete is about to hit, and how many.
 *
 * The count is in the answer and not just the list because the sentence the
 * confirmation needs is "this disappears from three places", and a screen that has
 * to count a list of people to write a sentence is a screen that will write the
 * wrong one.
 */
export const shareReachSchema = z.object({
  count: z.number().int().nonnegative(),
  people: z.array(z.object({ userId: uuidSchema, email: z.string(), role: shareRoleSchema })),
});
export type ShareReach = z.infer<typeof shareReachSchema>;

export const searchResultSchema = z.object({
  /**
   * What the hit belongs to, so the app can route to the right screen.
   *
   * `note` is here because a note is searched by what is written inside it, not
   * by its title, and a search that finds "salsa" and cannot open the recipe it
   * found is worse than not searching notes at all.
   */
  scope: z.enum(["workspace", "folder", "list", "list_item", "note"]),
  id: uuidSchema,
  workspaceId: uuidSchema.nullable().default(null),
  listId: uuidSchema.nullable().default(null),
  kind: listKindSchema.nullable().default(null),
  title: z.string(),
  subtitle: z.string().nullable().default(null),
  /**
   * Whether a row is already done, and `null` for anything that is not a row.
   *
   * It is in the hit and not looked up afterwards because the point of finding
   * something is to act on it: a shopping list is searched to tick off the milk
   * or to ask for it again, and a hit that cannot be ticked is a screen you have
   * to leave and come back from.
   */
  completed: z.boolean().nullable().default(null),
  updatedAt: isoDateTimeSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  items: z.array(searchResultSchema),
  nextCursor: z.string().nullable().default(null),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const listListsQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  folderId: uuidSchema.optional(),
  kind: listKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListListsQuery = z.infer<typeof listListsQuerySchema>;

export const listListsResponseSchema = z.object({
  items: z.array(listSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListListsResponse = z.infer<typeof listListsResponseSchema>;

export const listItemsQuerySchema = z.object({
  completed: z
    .enum(["true", "false", "any"])
    .default("any")
    .transform((value) => (value === "any" ? undefined : value === "true")),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).optional(),
});
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;

export const listItemsResponseSchema = z.object({
  items: z.array(listItemSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListItemsResponse = z.infer<typeof listItemsResponseSchema>;

/* ------------------------------------------------------------ plantillas ---- */

/**
 * A template is a document you can copy.
 *
 * It is the same format as a note and validated the same way, so a template can
 * never produce a note the editor cannot open. There is no second format and no
 * second editor: saving a note as a template is saving a note.
 */
/**
 * Who a template belongs to.
 *
 * - `personal` is the only scope that carries no space. A personal template is a
 *   shape the person wrote, it is stored with `workspaceId: null`, and it follows
 *   them into every space and onto every device. One that needed a space would be
 *   a thing the space holds for them, and it would vanish when they leave.
 * - `workspace` is a space's, and everybody in the space can use it. Editing it is
 *   an editor's right, because a team template only its author may repair is a
 *   template the team cannot maintain.
 * - `public` is the catalogue anybody can read. Nothing in this app creates one
 *   yet: publishing needs somebody to decide what is allowed in a catalogue
 *   everybody sees, and that decision has not been made.
 */
export const noteTemplateScopeSchema = z.enum(['personal', 'workspace', 'public']);
export type NoteTemplateScope = z.infer<typeof noteTemplateScopeSchema>;

export const noteTemplateSchema = syncableEntitySchema.extend({
  /**
   * The space it belongs to, or `null` for the ones that are not in a space: the
   * public catalogue and a personal template that follows its author.
   */
  workspaceId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(300).default(""),
  icon: z.string().max(40).default('document-text-outline'),
  scope: noteTemplateScopeSchema.default('workspace'),
  document: noteDocumentSchema,
  /** Denormalised like a note's, for the one line a picker shows. */
  plainText: z.string().default(""),
  /**
   * Only for the templates that ship with the app. A stable key is what makes an
   * update replace the built-in instead of adding a second copy of it, and it is
   * what makes a built-in recognisable as one on a device that has been offline
   * for a release.
   */
  builtInKey: z.string().max(60).nullable().default(null),
  /** Who made it. Null for a public one, which has no single author. */
  createdBy: uuidSchema.nullable().default(null),
});
export type NoteTemplate = z.infer<typeof noteTemplateSchema>;

export const createNoteTemplateRequestSchema = z.object({
  workspaceId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(300).optional(),
  icon: z.string().max(40).optional(),
  scope: noteTemplateScopeSchema.default('workspace'),
  document: noteDocumentSchema,
});
export type CreateNoteTemplateRequest = z.infer<typeof createNoteTemplateRequestSchema>;

export const listNoteTemplatesQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  /**
   * The built-in ones are offered to everybody, including somebody who has not
   * opened a space yet, so they are not scoped to one. Absent means yes: a picker
   * that opened without the catalogue would look empty, and the reason would be
   * invisible from the screen.
   */
  includeBuiltIn: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  scope: noteTemplateScopeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListNoteTemplatesQuery = z.infer<typeof listNoteTemplatesQuerySchema>;

export const listNoteTemplatesResponseSchema = z.object({
  items: z.array(noteTemplateSchema),
});
export type ListNoteTemplatesResponse = z.infer<typeof listNoteTemplatesResponseSchema>;

/**
 * Changing a template.
 *
 * The same shape as `updateNoteRequestSchema`, and every field optional for the
 * same reason: the name and the document are two separate things people change,
 * and a body that made both mandatory would mean resending the whole document to
 * correct a typo in the title — which is a document that has to be validated, has
 * to be sent, and can be out of date by the time it arrives.
 *
 * `scope` is deliberately absent. Moving a template between a person and a space
 * changes who can see it, which is not a change to the template but a change to
 * who is allowed to have it, and there is a copy for that: save it again.
 */
export const updateNoteTemplateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(300).optional(),
    icon: z.string().max(40).optional(),
    /** Validated against the editor's tag set, on the way in. */
    document: noteDocumentSchema.optional(),
    expectedVersion: z.number().int().min(0),
  })
  .refine((body) => {
    const { expectedVersion: _version, ...changes } = body;
    return Object.keys(changes).length > 0;
  }, { message: 'Nothing to change', path: ['expectedVersion'] });
export type UpdateNoteTemplateRequest = z.infer<typeof updateNoteTemplateRequestSchema>;

/**
 * Giving a template to somebody else, or taking it back.
 *
 * A separate verb and not a field on `updateNoteTemplateRequestSchema`, because
 * it is a different question with different rules. A rename is about the words; a
 * share is about who may read them, and the answer has to be the server's — a
 * client that could set `scope` by itself would be a client that could publish
 * somebody else's recipe to the whole app.
 *
 * Only the author may share. Not an editor of the space: a colleague who can fix
 * a typo in the team's template has no business moving it into their own space.
 */
export const shareNoteTemplateRequestSchema = z
  .object({
    scope: z.enum(['personal', 'workspace']),
    /** Required for `workspace`, and refused for `personal`. */
    workspaceId: uuidSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.scope === 'workspace' && !body.workspaceId) {
      ctx.addIssue({
        code: 'custom',
        message: 'A shared template needs a space',
        path: ['workspaceId'],
      });
    }
    if (body.scope === 'personal' && body.workspaceId) {
      ctx.addIssue({
        code: 'custom',
        message: 'A personal template belongs to its author, not to a space',
        path: ['workspaceId'],
      });
    }
  });
export type ShareNoteTemplateRequest = z.infer<typeof shareNoteTemplateRequestSchema>;

export const deleteNoteTemplateResponseSchema = z.object({
  id: uuidSchema,
  deleted: z.literal(true),
});
export type DeleteNoteTemplateResponse = z.infer<typeof deleteNoteTemplateResponseSchema>;

/* ------------------------------------------------------------------ notas ---- */

export const createNoteRequestSchema = z.object({
  workspaceId: uuidSchema,
  folderId: uuidSchema.nullable().default(null),
  title: z.string().trim().min(1).max(NOTE_TITLE_MAX),
  /** Validated against the editor's tag set. A document that fails is never stored. */
  document: noteDocumentSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** Optional, and absent means "the end of the folder's order". */
  position: z.number().int().min(0).optional(),
});
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;

/**
 * Changing a note.
 *
 * `document` and `title` are optional so an edit can be one or the other, and
 * `expectedVersion` is what makes a second device's save lose to the first
 * instead of overwriting it. The document is validated here rather than in the
 * route, so the client and the server agree on what a note may contain.
 */
export const updateNoteRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folderId: uuidSchema.nullable().optional(),
  document: noteDocumentSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** Moving a note within its folder's order, and nothing else. */
  position: z.number().int().min(0).optional(),
  expectedVersion: z.number().int().min(0),
});
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;

export const listNotesQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  folderId: uuidSchema.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

export const listNotesResponseSchema = z.object({
  items: z.array(noteSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ListNotesResponse = z.infer<typeof listNotesResponseSchema>;
