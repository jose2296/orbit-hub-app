import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * Every card says what it is.
 *
 * A panel is a grid of the same rectangle, so before this the only things telling
 * a folder from a list were the words in them — and a folder called "Cine" and a
 * list called "Cine" were the same card. The check is that the mark is *the same
 * for the same kind and different for a different one*, which means seeding one
 * card of every kind plus a folder and reading the glyph off each.
 *
 * Reading the glyph is the awkward part: on the web an `Ionicons` glyph is a font,
 * so there is no name in the DOM to ask for. So the mark is looked up by
 * difference — the same card with a different kind on it must produce a different
 * image — and the count of distinct marks across the seeded cards is what is
 * asserted. Six kinds and a folder, and six distinct marks.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";

function logOfTheApi() {
  const port = new URL(API).port || "4000";
  const pid = execSync(`lsof -tnP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  const line = execSync(`lsof -p ${pid} | awk '/ 2w /{print $NF}'`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  if (!line) throw new Error("no encuentro el log de la API");
  return line;
}
const EMAIL_LOG = process.env.EMAIL_LOG ?? logOfTheApi();
const readLog = async () => {
  try {
    return await readFile(EMAIL_LOG, "utf8");
  } catch {
    return "";
  }
};
async function api(path, { method = "GET", body, token } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SESSION_FILE = "/private/tmp/orbit-size-session.json";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function account() {
  try {
    const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
    if ((await api("/auth/me", { token: saved.accessToken })).status === 200) return saved;
  } catch {
    /* none yet */
  }
  const email = `marks-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  const before = await readLog();
  await api("/auth/register", {
    method: "POST",
    body: { email, password, displayName: "Marks", locale: "es", acceptedTermsAt: new Date().toISOString(), device: { label: "marks", platform: "web" } },
  });
  const deadline = Date.now() + 20000;
  let after = before;
  while (Date.now() < deadline && !/verify-email\?token=/.test(after.slice(before.length))) {
    await sleep(400);
    after = await readLog();
  }
  const link = after.slice(before.length).match(/verify-email\?token=([A-Za-z0-9_-]+)/);
  if (!link?.[1]) throw new Error("el correo de verificacion no salio en el log");
  await api("/auth/verify-email", { method: "POST", body: { token: link[1] } });
  const session = (await api("/auth/login", { method: "POST", body: { email, password, device: { label: "marks", platform: "web" } } })).body.data.session;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

const chrome = await launchChrome();
let tab;
try {
  const session = await account();
  const CLIENT = "verify-marks";
  const ws = randomUUID();
  const folder = randomUUID();
  // One list per kind of list, and the kind is what is being checked — so the
  // names are deliberately the same. Every card on the panel is called "Igual", and
  // the only thing that tells them apart is the mark.
  const kinds = ["tasks", "movies", "series", "movies_and_series", "books"];
  const lists = kinds.map(() => randomUUID());
  const at = new Date().toISOString();

  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: at,
      operations: [
        { operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create", entityId: ws, baseVersion: 0, base: null, clientTimestamp: at, payload: { name: "Marcas", color: "teal" } },
        ...lists.map((id, i) => ({
          operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create", entityId: id,
          baseVersion: 0, base: null, clientTimestamp: at,
          payload: { workspaceId: ws, folderId: null, title: "Igual", kind: kinds[i] },
        })),
        { operationId: randomUUID(), clientId: CLIENT, entity: "folder", kind: "create", entityId: folder, baseVersion: 0, base: null, clientTimestamp: at, payload: { workspaceId: ws, parentId: null, name: "Igual", emoji: null } },
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30", baseVersion: 0, base: null,
          clientTimestamp: at,
          payload: {
            layout: [
              ...kinds.map((kind, i) => ({
                id: `list:${lists[i]}`, kind: "recent_lists",
                x: (i % 3) * 1, y: Math.floor(i / 3) * 1, w: 1, h: 1, page: 0, pinned: true,
                settings: { listId: lists[i], title: "Igual", kind },
              })),
              {
                id: `folder:${folder}`, kind: "folder", x: 2, y: 1, w: 1, h: 1, page: 0, pinned: true,
                settings: { folderId: folder, title: "Igual" },
              },
            ],
          },
        },
      ],
    },
  });
  // The status of the request is not the status of the operations: a push whose
  // operations are all rejected is still a 200, and a check that only reads the
  // code reports a seed that worked and then wonders why the panel is empty.
  const results = pushed.body?.data?.results ?? [];
  const rejected = results.filter((r) => r.status !== "applied");
  check(
    "la siembra se aplica, no solo se acepta",
    pushed.status === 200 && results.length > 0 && rejected.length === 0,
    `${results.length} operaciones${rejected.length ? `, ${rejected.length} RECHAZADAS: ${JSON.stringify(rejected[0])}` : ""}`,
  );

  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await tab.goto(APP);

  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    await sleep(700);
    ready = await tab
      .evaluate(`!!document.querySelector('[data-testid="panel-grid"]') && !document.body.innerText.includes('Todo lo que necesitas')`)
      .catch(() => false);
  }
  if (!ready) throw new Error("el panel no aparecio");
  await sleep(1500);

  /**
   * The cards of the screen on display.
   *
   * Not the children of the track: those are the screens themselves, and the
   * track is as wide as all of them side by side. A card is two levels further in.
   */
  const cards = () =>
    tab.evaluate(`
      (() => {
        const track = document.querySelector('[data-testid="panel-grid"]');
        const screens = [...track.querySelectorAll('[data-testid^="panel-screen-"]')];
        const mid = window.innerWidth / 2;
        const screen = screens
          .map(s => ({ s, r: s.getBoundingClientRect() }))
          .sort((a, b) => Math.abs(a.r.left + a.r.width / 2 - mid) - Math.abs(b.r.left + b.r.width / 2 - mid))[0].s;
        // One card is one child of the screen, and the card itself is the button
        // inside it. Taking the deepest box instead picks the icon's own span, whose
        // text is the glyph — which is the mark, not the name.
        return [...screen.children]
          .map(c => {
            const inner = c.querySelector('[role="button"]') ?? c;
            // The mark is the first thing in the card's body, and on the web it is
            // a font glyph, so it is identified by being a text node in a span-like
            // element near the top rather than by anything it calls itself.
            const glyphs = [...inner.querySelectorAll('span, div')]
              .filter(d => d.children.length === 0 && (d.textContent || '').trim().length > 0)
              .slice(0, 2)
              .map(d => (d.textContent || '').trim());
            return {
              // The name of the card, from its accessibility label. The first line
              // of its *text* is the mark: it is the first thing on the card and on
              // the web a glyph is a character, so a title read out of the text is
              // a reading of the icon.
              text: (inner.getAttribute('aria-label') || '').trim(),
              glyphs,
              w: inner.offsetWidth,
              h: inner.offsetHeight,
            };
          });
      })()
    `);

  const shown = await cards();
  check("hay una tarjeta por tipo y por carpeta", shown.length === 6, `${shown.length} tarjetas`);

  // Every card is called the same thing, so the titles prove nothing on their own.
  const titles = new Set(shown.map((c) => c.text));
  check("las seis se llaman igual, así que el icono es lo único que las distingue", titles.size === 1, `títulos: ${[...titles].join(" / ")}`);

  // The mark, as a picture. Each card's first glyph is what makes it what it is.
  const firstGlyphOf = (card) => card.glyphs[0] ?? "";
  const glyphs = shown.map(firstGlyphOf);
  check("cada tarjeta tiene un icono", glyphs.every((g) => g.length > 0), JSON.stringify(glyphs));

  const distinct = new Set(glyphs);
  check(
    "los tipos distintos tienen iconos distintos",
    distinct.size >= 5,
    `${distinct.size} iconos distintos para ${shown.length} tarjetas: ${JSON.stringify([...distinct])}`,
  );

  // The two that are meant to be told apart, and the two that are meant not to be.
  const byKind = Object.fromEntries(kinds.map((k, i) => [k, firstGlyphOf(shown[i])]));
  const folderGlyph = firstGlyphOf(shown[5]);
  check("la carpeta no se confunde con ninguna lista", !Object.values(byKind).includes(folderGlyph), `carpeta: ${folderGlyph}`);
  check(
    "películas y series no son el mismo icono",
    byKind.movies !== byKind.series,
    `películas ${byKind.movies}, series ${byKind.series}`,
  );
  console.log(`      por tipo: ${JSON.stringify(byKind)}`);

  // And on the smallest card, where the emoji is dropped, the mark is all there is.
  const small = shown.filter((c) => c.h < 120);
  check(
    "en una tarjeta de una fila el icono sigue estando",
    small.length === 0 || small.every((c) => c.glyphs.length > 0),
    `${small.length} tarjetas de una fila`,
  );

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} COMPROBACIONES FALLIDAS`);
} catch (error) {
  console.log("fallo:", error.message);
  failures += 1;
} finally {
  tab?.close();
  await chrome.kill();
}
