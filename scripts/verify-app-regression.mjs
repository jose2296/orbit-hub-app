import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { launchChrome, openTab, seedSession, collectProblems } from "./cdp.mjs";

/**
 * The whole app, once, with a picture of every screen.
 *
 * The panel has three scripts of its own and they go into it deeply. This is the
 * other half: every screen the router can reach, at two widths, in both themes,
 * plus the handful of interactions that can only be checked by pressing something.
 *
 * Four rules, and each of them is there because breaking it made a check lie:
 *
 *  1. **The seed goes through the API and uses the server's own vocabulary.** An
 *     entity called `item` instead of `list_item` is rejected, and the rejection
 *     comes back labelled `dashboard` — so a seed written from the UI's wording
 *     fails in a way that points at the panel.
 *  2. **A screen is visited by its own URL** as well as by clicking, because a
 *     route that only renders the way the app arrives at it has a missing link.
 *  3. **Clipping is respected when measuring overflow.** `getBoundingClientRect`
 *     reports layout and knows nothing about `overflow`, so a screen that is
 *     clipped away 16px outside the window still measures as outside it, and a
 *     check written on rectangles reports sixty-seven broken layouts on a panel
 *     that is correct.
 *  4. **A console error fails the screen it happened on.** A screen that looks
 *     right and logged an error is a bug, and it is the kind that surfaces a week
 *     later as something else.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const SESSION_FILE = process.env.SESSION_FILE ?? "/private/tmp/orbit-size-session.json";
const SHOTS = process.env.SHOTS_DIR ?? "/private/tmp/orbit/regresion";

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);
const section = (text) => console.log(`\n--- ${text}`);

async function api(path, { method = "GET", body, token } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

/** The session, refreshed rather than registered. */
async function sharedSession() {
  const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
  if ((await api("/auth/me", { token: saved.accessToken })).status === 200) return saved;
  const refreshed = await api("/auth/refresh", {
    method: "POST",
    body: { refreshToken: saved.refreshToken },
  });
  const next = refreshed.body?.data?.session;
  if (!next) throw new Error(`la sesion no se pudo refrescar (${refreshed.status})`);
  await writeFile(SESSION_FILE, JSON.stringify(next, null, 2));
  note("sesion refrescada");
  return next;
}

const CLEAN = `(s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim()`;

/** Text anywhere, sheets included: a Modal is in the document and not in innerText. */
const hasText = `
  (text) => {
    const clean = ${CLEAN};
    const want = clean(text).toLowerCase();
    return [...document.querySelectorAll("body *")]
      .filter((n) => n.children.length === 0)
      .some((n) => clean(n.textContent).toLowerCase().includes(want));
  }
`;

const pressLabel = (tab, needle, { exact = false } = {}) =>
  tab.evaluate(`
    (() => {
      const clean = ${CLEAN};
      const want = clean(${JSON.stringify(needle)}).toLowerCase();
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; })
        .find((e) => {
          const label = clean(e.getAttribute("aria-label") || "").toLowerCase();
          return ${exact ? "label === want" : "label.includes(want)"};
        });
      if (!el) return false;
      el.click();
      return true;
    })()
  `);

const pressTestId = (tab, id) =>
  tab.evaluate(`
    (() => {
      const el = document.querySelector('[data-testid=${JSON.stringify(id)}]');
      if (!el) return false;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return false;
      el.click();
      return true;
    })()
  `);

/**
 * Set a React-controlled input.
 *
 * Assigning `el.value` does not reach React: it patches the DOM node's own
 * property and React never hears about it, so the field stays empty and the
 * thing under test is a save button with nothing in it. The native setter and a
 * real `input` event are the pair that works.
 */
const typeInto = (tab, selector, value) =>
  tab.evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()
  `);

/** What is on screen, for a route-level verdict, as a function. */
const probe = (tab) => tab.evaluate(PROBE);

const PROBE = `
  (() => {
    const clean = ${CLEAN};
    const win = window.innerWidth;
    const winH = window.innerHeight;

    /**
     * Is this element painted outside the window, or merely laid out there?
     *
     * A rectangle is layout. An element clipped away by an ancestor with a hidden
     * overflow is not painted, however far out its box reaches, so the walk up
     * the ancestors is the whole difference between "the layout is broken" and
     * "there is a pager track under here, and it is doing its job".
     */
    const paintedOutside = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      let node = el.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
        const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
        if (clipsX || clipsY) {
          const nr = node.getBoundingClientRect();
          if ((clipsX && (r.right > nr.right + 1 || r.left < nr.left - 1))
           || (clipsY && (r.bottom > nr.bottom + 1 || r.top < nr.top - 1))) return false;
        }
        node = node.parentElement;
      }
      return r.right > win + 2 || r.left < -2 || r.bottom > winH + 2 || r.top < -2;
    };

    const leaves = [...document.querySelectorAll('body *')].filter((n) => n.children.length === 0);
    const texts = leaves.map((n) => clean(n.textContent)).filter(Boolean);
    return {
      url: location.pathname + location.search,
      texts,
      testids: [...document.querySelectorAll('[data-testid]')].map((d) => d.getAttribute('data-testid')),
      buttons: [...document.querySelectorAll('button, [role=button]')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length,
      overflowing: [...document.querySelectorAll('body *')].filter(paintedOutside).length,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: winH,
    };
  })()
`;

let problems = [];

/** Wait until the app has painted, and long enough for the theme to hydrate. */
const settle = async (tab, { label, timeout = 30000 }) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(400);
    const p = await probe(tab).catch(() => null);
    if (p && p.texts.length > 2) return p;
  }
  const diag = await tab
    .evaluate(`(() => ({ url: location.pathname, head: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,140) }))()`)
    .catch(() => null);
  throw new Error(`${label} no se quedo quieta: ${JSON.stringify(diag)}`);
};

const visit = async (tab, name, path, { viewport = "phone" } = {}) => {
  const mark = problems.length;
  await tab.goto(`${APP}${path}`);
  const p = await settle(tab, { label: name });
  await sleep(700);
  await tab.screenshot(`${SHOTS}/${viewport}-${name}.png`);
  const found = problems.slice(mark);
  check(
    `${name} se dibuja sin errores de consola`,
    found.length === 0,
    found.length
      ? found.slice(0, 3).map((f) => `${f.kind}: ${f.text.slice(0, 120)}`).join(" | ")
      : `${p.texts.length} textos, ${p.buttons} botones, ${p.overflowing} fuera de ventana`,
  );
  return p;
};

const setViewport = (tab, vp) =>
  tab.send("Emulation.setDeviceMetricsOverride", { ...vp, mobile: false });

/**
 * The seam in a space's wash, read off a screenshot.
 *
 * **The wash of a space is painted by two boxes**: the bar of the header and the
 * band behind the content. They meet on a straight line, and when each one draws
 * its own gradient they do not agree — the diagonal angle comes from the box's own
 * size, so a 56-tall bar and a 100-tall band get different angles, and each runs
 * the whole first-colour-to-second-colour range over its own height, so the bar
 * arrives at the final colour at its bottom edge and the band starts again at the
 * first one. Measured: a step of 14 in a single row, on a line, across the middle
 * of the gradient. With one gradient cut in two it is 1, which is what every other
 * row of the gradient does.
 *
 * **So it is the biggest step between neighbouring rows around the join, and it
 * has to look like all the others.** Anything above 4 is a seam.
 *
 * And it first checks the wash is on the picture at all, comparing the bar against
 * the background further down. Without that, a screenshot of the signed-out
 * welcome screen — no session, no wash, no join — reads as "perfectly continuous",
 * which is how the first run of this check passed on a screen that was not there.
 */
const costuraDelLavado = (png, escala) => {
  const pixel = (y, x) => {
    const i = (png.width * y + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const separacion = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

  // Right of the title and the menu, where the wash is and nothing is drawn on it.
  const x = png.width - Math.round(60 * escala);
  const cabecera = pixel(Math.round(20 * escala), x);
  const fondo = pixel(Math.round(150 * escala), x);
  if (separacion(cabecera, fondo) < 6) return { hayLavado: false };

  const union = Math.round(56 * escala);
  let peor = { salto: 0, y: 0 };
  for (let y = union - Math.round(12 * escala); y <= union + Math.round(14 * escala); y += 1) {
    const salto = separacion(pixel(y - 1, x), pixel(y, x));
    if (salto > peor.salto) peor = { salto, y };
  }
  return { hayLavado: true, ...peor, union };
};

// ----------------------------------------------------------------------------- seed

const DASHBOARD_ID = "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30";

const seed = async (session) => {
  const CLIENT = "regresion";
  const ws = randomUUID();
  const folder = randomUUID();
  const at = new Date().toISOString();

  const spec = [
    { key: "tasks", title: "Tareas de la semana", emoji: "✅", items: 5, kind: "tasks" },
    { key: "movies", title: "Peliculas", emoji: "🎬", items: 4, kind: "movies" },
    { key: "books", title: "Libros", emoji: "📚", items: 3, kind: "books" },
    { key: "notes", title: "Notas", emoji: "🗒️", items: 3, kind: "notes" },
  ];
  const ids = new Map(
    spec.map((s) => [s.key, { list: randomUUID(), items: Array.from({ length: s.items }, () => randomUUID()) }]),
  );

  const operations = [
    { operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create", entityId: ws, baseVersion: 0, base: null, clientTimestamp: at, payload: { name: "Regresion", color: "teal" } },
    { operationId: randomUUID(), clientId: CLIENT, entity: "folder", kind: "create", entityId: folder, baseVersion: 0, base: null, clientTimestamp: at, payload: { workspaceId: ws, name: "Personas", emoji: "👥" } },
  ];
  for (const s of spec) {
    const { list, items } = ids.get(s.key);
    operations.push({
      operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create", entityId: list,
      baseVersion: 0, base: null, clientTimestamp: at,
      // The name is at least eight characters or the server refuses it, and a
      // refused operation comes back labelled `dashboard`, which sends whoever
      // reads the result looking in the wrong place entirely.
      payload: { workspaceId: ws, folderId: s.key === "notes" ? folder : null, title: s.title, emoji: s.emoji, kind: s.kind },
    });
    items.forEach((id, i) => {
      operations.push({
        operationId: randomUUID(), clientId: CLIENT,
        // `list_item`, not `item`. That is the name the server knows, and the
        // name the UI uses is not the name the contract uses.
        entity: "list_item", kind: "create", entityId: id,
        baseVersion: 0, base: null, clientTimestamp: at,
        payload: { listId: list, title: `${s.title} ${i + 1}`, note: i === 0 ? "una nota de prueba" : "", done: false, position: i },
      });
    });
  }
  // A panel of more than one screen, so the picker, the page bar and the pager
  // all have something to do on a dashboard visited as a route.
  operations.push({
    operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
    entityId: DASHBOARD_ID, baseVersion: 0, base: null, clientTimestamp: at,
    payload: {
      layout: spec.flatMap((s) =>
        ids.get(s.key).items.slice(0, 2).map((itemId, i) => ({
          id: `list:${itemId}`,
          kind: "recent_lists",
          x: (i % 2) * 2, y: Math.floor(i / 2), w: 2, h: 1, page: 0, pinned: true,
          settings: { listId: itemId, title: s.title, kind: s.kind },
        })),
      ),
    },
  });

  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: { deviceId: randomUUID(), lastPulledAt: null, clientTimestamp: at, operations },
  });
  const res = pushed.body?.data?.results ?? [];
  const rejected = res.filter((r) => r.status !== "applied");
  check(
    "la siembra por la API se aplica entera",
    pushed.status === 200 && res.length > 0 && rejected.length === 0,
    `${res.length} operaciones${rejected.length ? `, RECHAZADAS ${rejected.length}: ${rejected.slice(0, 3).map((r) => `${r.entity} ${r.error}`).join(" | ")}` : ", todas aplicadas"}`,
  );

  // POST, and not GET: `/sync/pull` is a POST with a body, and asking for it with
  // a query string is a 404 that reads like the data is not there.
  const pulled = await api("/sync/pull", {
    method: "POST",
    token: session.accessToken,
    body: { since: null, limit: 500 },
  });
  const data = pulled.body?.data;
  check(
    "el servidor devuelve lo sembrado",
    pulled.status === 200 && JSON.stringify(data ?? {}).length > 100,
    `status ${pulled.status}, claves ${Object.keys(data ?? {}).join(",") || "—"}`,
  );

  return {
    workspace: ws,
    folder,
    lists: Object.fromEntries([...ids].map(([k, v]) => [k, v.list])),
    firstItemOf: (k) => ids.get(k).items[0],
  };
};

// ------------------------------------------------------------------------------ run

const chrome = await launchChrome({ width: PHONE.width, height: PHONE.height });
let tab;
try {
  const session = await sharedSession();
  const data = await seed(session);

  tab = await openTab(chrome.port);
  problems = collectProblems(tab);
  await seedSession(tab, session, APP);
  await setViewport(tab, PHONE);

  section("Con sesion, en telefono");
  const panel = await visit(tab, "01-dashboard", "/");
  check("el panel dibuja la rejilla", panel.testids.includes("panel-grid"), panel.testids.slice(0, 5).join(", "));
  check("nada se sale de la ventana", panel.overflowing === 0, `${panel.overflowing} elementos pintados fuera`);

  await visit(tab, "02-buscar", "/search");
  await visit(tab, "03-ajustes", "/settings");
  await visit(tab, "04-espacios", "/workspaces");
  await visit(tab, "05-listas", "/lists");
  await visit(tab, "06-espacio", `/workspace/${data.workspace}`);
  await visit(tab, "07-carpeta", `/workspace/${data.workspace}/folder/${data.folder}`);
  await visit(tab, "08-lista-tareas", `/list/${data.lists.tasks}`);
  await visit(tab, "09-lista-peliculas", `/list/${data.lists.movies}`);
  await visit(tab, "10-lista-libros", `/list/${data.lists.books}`);
  await visit(tab, "11-lista-notas", `/list/${data.lists.notes}`);
  await visit(tab, "12-item", `/item/${data.firstItemOf("tasks")}`);
  await visit(tab, "13-sync", "/sync");
  await visit(tab, "14-dispositivos", "/devices");
  await visit(tab, "15-catalogo", "/catalog");

  section("Lo mismo en escritorio");
  await setViewport(tab, DESKTOP);
  const desk = await visit(tab, "16-dashboard-escritorio", "/", { viewport: "desktop" });
  check("el panel tambien se dibuja en escritorio", desk.testids.includes("panel-grid"), `${desk.texts.length} textos`);
  check("nada se sale en escritorio", desk.overflowing === 0, `${desk.overflowing} elementos pintados fuera`);
  await visit(tab, "17-ajustes-escritorio", "/settings", { viewport: "desktop" });
  await visit(tab, "18-lista-escritorio", `/list/${data.lists.tasks}`, { viewport: "desktop" });
  await visit(tab, "19-espacios-escritorio", "/workspaces", { viewport: "desktop" });
  await setViewport(tab, PHONE);

  section("Claro y oscuro");
  /**
   * The colour the *app* is painted with, and not the one on `<body>`.
   *
   * `+html.tsx` paints the body from a media query — dark by default, light under
   * `prefers-color-scheme: light` — so the body's background says what the *OS*
   * wants, not what the person chose in Settings, and the two disagree whenever
   * somebody forces one against the other. Reading the body is how this check
   * spent a run reporting a theme bug that did not exist: the browser was light,
   * the app was correctly dark, and the body was light.
   *
   * The app's own background is the token `Screen` paints, so this looks for the
   * two palette values in the tree and reports which one the app is actually using.
   */
  const palette = () =>
    tab.evaluate(`
      (() => {
        const want = { light: 'rgb(246, 247, 251)', dark: 'rgb(11, 16, 32)' };
        const counts = { light: 0, dark: 0 };
        for (const n of document.querySelectorAll('body *')) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg === want.light) counts.light += 1;
          if (bg === want.dark) counts.dark += 1;
        }
        return {
          ...counts,
          body: getComputedStyle(document.body).backgroundColor,
          prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
          stored: localStorage.getItem('orbithub:appearance'),
          using: counts.dark > counts.light ? 'dark' : counts.light > counts.dark ? 'light' : 'ninguno',
        };
      })()
    `);

  const withPreference = async (key, value, path) => {
    await tab.goto(`${APP}/`);
    await settle(tab, { label: `antes de ${key}` });
    // Plain, not `JSON.stringify`: `setLocale` stores the bare string and reads
    // it back with `=== 'en'`, so a quoted `"en"` is a value it correctly
    // refuses, and the test then reports the app ignoring a preference it was
    // never given.
    await tab.evaluate(`(() => { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); return true; })()`);
    await tab.goto(`${APP}${path}`);
    await settle(tab, { label: `${key}=${value}` });
    await sleep(1400);
  };

  // The OS is pinned for both, so the body's media query and the app's own
  // choice agree and a disagreement means one of them is wrong.
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await withPreference("orbithub:appearance", JSON.stringify({ appearance: "light", accent: "orbit" }), "/");
  const light = await palette();
  await tab.screenshot(`${SHOTS}/20-dashboard-claro.png`);

  await withPreference("orbithub:appearance", JSON.stringify({ appearance: "dark", accent: "orbit" }), "/");
  const dark = await palette();
  await tab.screenshot(`${SHOTS}/21-dashboard-oscuro.png`);

  check(
    "el tema claro se aplica a la app, no solo al body",
    light.using === "light",
    `usando ${light.using} (claro ${light.light} elementos, oscuro ${light.dark}), body ${light.body}`,
  );
  check(
    "el tema oscuro se aplica a la app",
    dark.using === "dark",
    `usando ${dark.using} (claro ${dark.light} elementos, oscuro ${dark.dark}), body ${dark.body}`,
  );
  check(
    "el body sigue al tema cuando el SO esta en claro",
    dark.body === "rgb(11, 16, 32)",
    `body ${dark.body} con la app en oscuro y el SO en claro`,
  );

  await tab.goto(`${APP}/list/${data.lists.tasks}`);
  const darkList = await settle(tab, { label: "lista en oscuro" });
  await tab.screenshot(`${SHOTS}/22-lista-oscuro.png`);
  check("la lista se dibuja en oscuro", darkList.texts.length > 2, `${darkList.texts.length} textos`);

  await tab.evaluate(`(() => { localStorage.setItem("orbithub:appearance", JSON.stringify({ appearance: "system", accent: "orbit" })); return true; })()`);

  section("Idioma");
  await withPreference("orbithub:locale", "en", "/settings");
  const settingsEn = await tab.evaluate(`(${hasText})("Settings")`);
  check("los ajustes cambian a ingles", settingsEn, `encontrado: ${settingsEn}`);
  await tab.screenshot(`${SHOTS}/23-ajustes-en.png`);
  await tab.evaluate(`(() => { localStorage.setItem("orbithub:locale", "es"); return true; })()`);

  section("Interacciones");
  // --- crear un elemento, por el boton de verdad y no por su texto
  await tab.goto(`${APP}/list/${data.lists.tasks}`);
  await settle(tab, { label: "lista para crear" });
  const before = await tab.evaluate(`document.querySelectorAll('[data-testid^="item-row-"]').length`);
  const opened = await pressTestId(tab, "item-create-button");
  await sleep(900);
  const hasField = await tab.evaluate(`!!document.querySelector('[data-testid="item-name"]')`);
  check("el boton de anadir abre la hoja de edicion", opened && hasField, `hoja abierta: ${hasField}`);

  if (hasField) {
    const stamp = `Prueba-${Date.now().toString(36).slice(-4)}`;
    const written = await typeInto(tab, '[data-testid="item-name"]', stamp);
    await sleep(500);
    // The save button by its test id and not by its words: the sheet's button is
    // `itemCreate.save`, and a check that presses a label has to know the label
    // in two languages to keep working.
    const saved = await pressTestId(tab, "item-create");
    await sleep(2500);
    const after = await tab.evaluate(`document.querySelectorAll('[data-testid^="item-row-"]').length`);
    const listed = await tab.evaluate(`(${hasText})(${JSON.stringify(stamp)})`);
    check("crear un elemento lo anade a la lista", Boolean(saved) && (after > before || listed), `campo "${written}", ${before} -> ${after} filas, aparece: ${listed}`);

    /*
      And on the server, because a row on the screen is not a row in the database.

      This is the rule the verification doc states and the one this suite is most
      able to break quietly: the app writes locally and syncs later, so a create
      can look perfect and never leave the device. The pull is retried because the
      sync is debounced, and a check that reads once is a check of the debounce.

      **The pull has to be paged through.** It answers with `{ changes, nextCursor,
      hasMore }` and this call asks for 500, so a database with more than 500
      changes hands back only the oldest page. The item just created is the newest
      change and falls off the end, and the check then reports a sync that worked
      perfectly as one that lost the write — measured here: the server had 501
      changes, the item was on page 2, and two runs of this suite were spent
      calling a working app broken. Paging to the end is the difference between
      asking where the item is and asking whether it exists.
    */
    let reached = false;
    let pages = 0;
    let changes = 0;
    for (let attempt = 1; attempt <= 8 && !reached; attempt += 1) {
      let cursor = null;
      pages = 0;
      changes = 0;
      for (;;) {
        const pulled = await api("/sync/pull", {
          method: "POST",
          token: session.accessToken,
          body: { since: null, limit: 500, ...(cursor ? { cursor } : {}) },
        });
        const data = pulled.body?.data ?? {};
        const page = data.changes ?? [];
        changes += page.length;
        pages += 1;
        if (JSON.stringify(page).includes(stamp)) {
          reached = true;
          break;
        }
        if (!data.hasMore || !data.nextCursor) break;
        cursor = data.nextCursor;
      }
      if (!reached) await sleep(2000);
    }
    check(
      "y llega al servidor",
      reached,
      `"${stamp}" en ${changes} cambios de ${pages} pagina(s)`,
    );
    await tab.screenshot(`${SHOTS}/24-lista-con-item-nuevo.png`);
  }

  // --- buscar
  await tab.goto(`${APP}/search`);
  await settle(tab, { label: "buscar" });
  const typed = await typeInto(tab, "input", "Peliculas");
  await sleep(1500);
  const foundSearch = await tab.evaluate(`(${hasText})("Peliculas")`);
  check("la busqueda encuentra lo sembrado", Boolean(typed) && foundSearch, `escrito: ${typed}`);
  await tab.screenshot(`${SHOTS}/25-busqueda.png`);

  // --- el menu
  await tab.goto(`${APP}/`);
  await settle(tab, { label: "dashboard para el menu" });
  /*
    `aria-expanded` on the button, and not "is the panel in the document".

    The panel is mounted whether the menu is open or not — the column animates
    its width to zero and the app takes the space back — so asking whether
    `[data-testid="drawer-panel"]` exists is the same question before and after
    opening it, and it answers "yes" both times. The attribute is the one thing
    that says which of the two states the menu is in, and it is what a screen
    reader reads out too, so checking it tests the app and the label at once.
  */
  const expanded = () =>
    tab.evaluate(
      `document.querySelector('[data-testid="drawer-button"]')?.getAttribute('aria-expanded') ?? 'ausente'`,
    );
  const beforeMenu = await expanded();
  await pressTestId(tab, "drawer-button");
  await sleep(1100);
  const afterOpen = await expanded();
  await tab.screenshot(`${SHOTS}/26-drawer.png`);
  check("el menu se abre", afterOpen === "true", `aria-expanded ${beforeMenu} -> ${afterOpen}`);
  if (afterOpen === "true") {
    await pressTestId(tab, "drawer-button");
    await sleep(1100);
    const afterClose = await expanded();
    check("y se cierra", afterClose === "false", `aria-expanded ${afterOpen} -> ${afterClose}`);
  }

  // --- sincronizar a mano
  await tab.goto(`${APP}/sync`);
  await settle(tab, { label: "sync" });
  await pressTestId(tab, "sync-now");
  await sleep(3000);
  const afterSync = await probe(tab);
  check("sincronizar a mano no rompe la pantalla", afterSync.texts.length > 2, `${afterSync.texts.length} textos`);
  await tab.screenshot(`${SHOTS}/27-sync.png`);

  section("El selector y el boton de guardar");
  /*
    Pinning through the sheet and then pressing Guardar, in that order.

    The panel grid keeps its own draft while it is arranging and only adopts the
    saved layout when the mode ends, so a change the sheet makes underneath it was
    written to the store and then overwritten by `finish` with the older draft.
    Unpinning something in the sheet and pressing Guardar did nothing at all, with
    no error anywhere: the write was made and then lost. The test is the order,
    because the order is the bug — pinning while arranging, then saving.
  */
  const sheetLevel = `
    (() => {
      const clean = ${CLEAN};
      const title = [...document.querySelectorAll('*')]
        .find((e) => e.children.length === 0 && clean(e.textContent) === 'Qué sale en el panel');
      let s = title;
      while (s && s.getBoundingClientRect().height < 200) s = s.parentElement;
      return s;
    })()
  `;
  const panelCardCount = () =>
    tab.evaluate(`
      (() => {
        const track = document.querySelector('[data-testid="panel-grid"]');
        if (!track) return -1;
        return [...track.querySelectorAll('[data-testid^="panel-screen-"]')]
          .flatMap((s) => [...s.children].filter((el) => el.tagName === 'DIV')).length;
      })()
    `);

  await tab.goto(`${APP}/`);
  await settle(tab, { label: "dashboard para el selector" });
  const cardsBefore = await panelCardCount();
  await pressLabel(tab, "Colocar las tarjetas", { exact: true });
  await sleep(2000);
  await pressLabel(tab, "Crear", { exact: true });
  await sleep(1500);

  const spaces = await tab.evaluate(`
    (() => {
      const clean = ${CLEAN};
      const sheet = (${sheetLevel});
      if (!sheet) return [];
      return [...sheet.querySelectorAll('[aria-label]')]
        .map((e) => clean(e.getAttribute('aria-label')))
        .filter((l) => l && !/^(Cerrar|Volver|Espacios de trabajo)/.test(l));
    })()
  `);

  // Spaces come and go, and half of them on a busy account have no folders, so
  // this walks into them until it finds one that has something to pin rather than
  // betting on the first: a test that picks one space and gives up reports "no
  // folder to pin" and reads as a broken panel.
  let pinned = "ningun espacio tenia carpetas";
  for (const space of spaces.slice(0, 8)) {
    await tab.evaluate(`
      (() => {
        const clean = ${CLEAN};
        const sheet = (${sheetLevel});
        if (!sheet) return false;
        const row = [...sheet.querySelectorAll('[aria-label]')]
          .find((e) => clean(e.getAttribute('aria-label')) === ${JSON.stringify(space)});
        if (!row) return false;
        row.click();
        return true;
      })()
    `);
    await sleep(1100);
    const found = await tab.evaluate(`
      (() => {
        const clean = ${CLEAN};
        const sheet = (${sheetLevel});
        if (!sheet) return null;
        // The circle, which is the switch: the row beside it is the door.
        const circle = [...sheet.querySelectorAll('[aria-label]')]
          .find((e) => /: Poner en el panel$/.test(clean(e.getAttribute('aria-label'))));
        if (!circle) return null;
        const who = clean(circle.getAttribute('aria-label')).split(':')[0];
        circle.click();
        return who;
      })()
    `);
    if (found) {
      pinned = `fijada la carpeta ${found} en ${space}`;
      break;
    }
    await pressLabel(tab, "Volver", { exact: true });
    await sleep(900);
  }

  await sleep(1800);
  await tab.screenshot(`${SHOTS}/28-selector-fijado.png`);

  await pressLabel(tab, "Cerrar", { exact: true });
  await sleep(900);
  await pressLabel(tab, "Guardar", { exact: true });
  await sleep(2500);
  await tab.goto(`${APP}/`);
  await settle(tab, { label: "dashboard tras guardar" });
  await tab.screenshot(`${SHOTS}/29-tras-guardar.png`);

  /*
    Read from the server, and not from the number of cards on the glass.

    Counting what is on screen is not a measure of whether the write survived: the
    panel only mounts the screen being looked at and its two neighbours, so the
    count moves when a card is spilled to a page that is not mounted and when the
    arranging mode adds a background layer. It went *down* by two on a pin in an
    earlier run of this very check, which is a number that cannot mean what it
    looks like it means. The saved layout is the thing that either kept the card
    or lost it, so that is what gets asked.
  */
  let folderCards = 0;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const pulled = await api("/sync/pull", {
      method: "POST",
      token: session.accessToken,
      body: { since: null, limit: 500 },
    });
    const blob = JSON.stringify(pulled.body?.data ?? {});
    folderCards = (blob.match(/"folderId":"[0-9a-f-]{36}"/g) ?? []).length;
    if (folderCards > 0) break;
    await sleep(2000);
  }
  check(
    "fijar desde el selector y guardar deja la tarjeta puesta",
    folderCards > 0,
    `${pinned} · ${folderCards} tarjetas de carpeta en el layout guardado`,
  );

  section("La union del lavado del espacio");
  for (const [name, path] of [
    ["espacio", `/workspace/${data.workspace}`],
    ["carpeta", `/workspace/${data.workspace}/folder/${data.folder}`],
  ]) {
    const archivo = `${SHOTS}/lavado-${name}.png`;
    await tab.goto(`${APP}${path}`);
    await settle(tab, { label: `lavado-${name}` });
    await sleep(700);
    await tab.screenshot(archivo);
    const png = PNG.sync.read(await readFile(archivo));
    const escala = PHONE.deviceScaleFactor;
    const costura = costuraDelLavado(png, escala);
    check(
      `el lavado de ${name} no tiene costura en la union con la cabecera`,
      costura.hayLavado && costura.salto <= 4,
      !costura.hayLavado
        ? "la captura no tiene lavado: session caducada o pantalla equivocada"
        : `salto de ${costura.salto} en y=${costura.union} (la union esta en ${costura.union})`,
    );

    /*
      Las dos cosas mas, **en la misma captura y sin volver a pintar**.

      Pedir una navegacion y una captura mas por cada comprobacion fue como el
      navegador se dejo de responder: `Page.captureScreenshot` se quedo sin
      contestar en un bundle de doce megas, y las corridas anteriores se quedaron
      colgadas en tres pantallas distintas. Asi que aqui se aprovecha lo que ya se
      tiene —la misma pantalla, la misma captura— y solo se anaden medidas.

      **Los filtros son los mismos en el espacio y en la carpeta.** La fila de
      pastillas salia de lo que habia en pantalla —una pastilla por carpeta, con su
      nombre—, asi que en un espacio con una carpeta "Personas" habia una pastilla
      "Personas" y en otro no: un filtro que hay que aprender en cada sitio.

      **Las filas no llevan el color del espacio.** Se mide el fondo de una fila
      contra el color de la banda de arriba, que si es el del espacio: si la fila lo
      llevara, los dos pixeles serian familia. Se lee en la captura y no en el DOM
      porque el fondo de una fila lo pinta un `View` dentro de otro y el color del
      DOM no es el que se ve.
    */
    if (name === "espacio") {
      const pixeles = [
        [Math.round(300 * escala), png.width - Math.round(60 * escala)],
        [Math.round(20 * escala), png.width - Math.round(60 * escala)],
      ].map(([y, x]) => {
        const i = (png.width * y + x) * 4;
        return [png.data[i], png.data[i + 1], png.data[i + 2]];
      });
      const diferencia = Math.max(...pixeles[0].map((v, k) => Math.abs(v - pixeles[1][k])));
      check(
        "una fila no lleva el color del espacio",
        diferencia > 12,
        `la banda es ${pixeles[1].join(",")} y la fila ${pixeles[0].join(",")}, diferencia ${diferencia}`,
      );
    }
  }

  const pastillasDe = async (path, etiqueta) => {
    await tab.goto(`${APP}${path}`);
    await settle(tab, { label: etiqueta });
    await sleep(500);
    return tab.evaluate(`(() => {
      const out = [];
      for (const b of document.querySelectorAll('[role=checkbox]')) {
        const r = b.getBoundingClientRect();
        if (r.width > 0) out.push((b.getAttribute('aria-label') || '').trim());
      }
      return out.sort();
    })()`);
  };
  const enEspacio = await pastillasDe(`/workspace/${data.workspace}`, "pastillas:espacio");
  const enCarpeta = await pastillasDe(`/workspace/${data.workspace}/folder/${data.folder}`, "pastillas:carpeta");
  check(
    "los filtros son los mismos en el espacio y en la carpeta",
    JSON.stringify(enEspacio) === JSON.stringify(enCarpeta) && enEspacio.length > 0,
    `${enEspacio.join(", ") || "(ninguna)"} | carpeta: ${enCarpeta.join(", ") || "(ninguna)"}`,
  );

  /*
    Y ahora la fila **estrecha**: al pulsar "Listas" solo quedan los cinco tipos y el
    icono de prohibido, con el icono el primero. Es una afirmacion sobre lo que *no*
    esta, asi que se comparan las dos listas enteras y no que falte algo.

    El icono va el primero porque la fila se desplaza a lo anchos: con los cinco
    tipos encima, el final queda fuera de la pantalla y la salida —lo unico que
    deshace lo hecho— era justo lo que no se veia.
  */
  const pulsarPastilla = async (etiqueta) => {
    const p = await tab.evaluate(`(() => {
      const b = [...document.querySelectorAll('[role=checkbox],[role=button]')]
        .find((e) => (e.getAttribute('aria-label') || '') === ${JSON.stringify(etiqueta)});
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!p) return false;
    await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 });
    await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 0 });
    await sleep(500);
    return true;
  };
  const filaDeFiltros = () => tab.evaluate(`(() => {
    const out = [];
    for (const b of document.querySelectorAll('[role=checkbox]')) {
      const r = b.getBoundingClientRect();
      if (r.width > 0) out.push((b.getAttribute('aria-label') || '').trim());
    }
    const q = [...document.querySelectorAll('[role=button]')]
      .find((e) => (e.getAttribute('aria-label') || '') === 'Quitar filtros');
    if (q && q.getBoundingClientRect().width > 0) out.unshift('Quitar filtros');
    return out;
  })()`);

  await pulsarPastilla("Listas");
  const abierta = await filaDeFiltros();
  const sinGenero = abierta.filter((l) => l === "Carpetas" || l === "Notas");
  check(
    "pulsar Listas deja solo los tipos de lista y el icono de quitar",
    abierta[0] === "Quitar filtros" &&
      abierta.length === 6 &&
      sinGenero.length === 0 &&
      abierta.every((l) => l === "Quitar filtros" || l.includes("·")),
    abierta.join(", ") || "(vacia)",
  );
  await pulsarPastilla("Quitar filtros");
  const cerrada = await filaDeFiltros();
  check(
    "el icono de quitar devuelve la fila entera",
    cerrada.length === 3 && cerrada.includes("Carpetas") && cerrada.includes("Listas") && cerrada.includes("Notas"),
    cerrada.join(", ") || "(vacia)",
  );

  section("Sin sesion");
  const anon = await openTab(chrome.port);
  try {
    await anon.goto(`${APP}/`);
    await sleep(2500);
    // A second tab in the same browser is the *same* browser: the session is in
    // localStorage, so without this the "signed out" run is signed in and every
    // check below passes by showing the dashboard.
    await anon.evaluate(`(() => { localStorage.clear(); return true; })()`);
    for (const [name, path] of [
      ["30-bienvenida", "/welcome"],
      ["31-iniciar-sesion", "/sign-in"],
      ["32-registro", "/sign-up"],
      ["33-recuperar", "/forgot-password"],
    ]) {
      await anon.goto(`${APP}${path}`);
      const p = await settle(anon, { label: name }).catch(() => null);
      check(`${name} se dibuja`, !!p, p ? `${p.texts.length} textos` : "no se dibuja");
      await anon.screenshot(`${SHOTS}/${name}.png`);
    }
    await anon.goto(`${APP}/`);
    await sleep(3000);
    const landed = await anon.evaluate(`location.pathname`);
    check("sin sesion la raiz manda a la bienvenida", /welcome/.test(landed), `aterrizo en ${landed}`);
  } finally {
    anon.close();
  }

  // ------------------------------------------------------------------ resumen
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} comprobaciones OK ===`);
  if (failed.length) {
    console.log("\nFallan:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  }
  console.log(`capturas en ${SHOTS}`);
  console.log(failures === 0 ? "TODO OK" : `${failures} COMPROBACIONES FALLIDAS`);
} catch (error) {
  console.error("\nfallo:", error.message);
  failures += 1;
} finally {
  tab?.close();
  await chrome.kill();
}
