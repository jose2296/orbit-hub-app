import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchChrome, openTab, collectProblems } from "./cdp.mjs";

/**
 * Is the menu the same menu on a desktop and on a phone, and does the hamburger
 * collapse it?
 *
 * It used to be two menus. A phone got `DrawerPanel`, with the whole file tree in
 * it; a wide screen got `SideDrawer`, which was three destinations, a flat list of
 * the spaces and a sync row. Every folder, list and item was reachable only on a
 * phone — the one place you cannot have a sidebar — and the hamburger on a desktop
 * was a button whose `onPress` set a flag nobody read, because on a desktop the
 * column could not be closed at all.
 *
 * So this checks the three claims the change makes, in a real browser, because
 * all three are about pixels:
 *
 *   1. the same rows, in the same order, on a 1280 screen and on a 430 one
 *   2. the file tree is reachable on a desktop, which is the thing that was missing
 *   3. the hamburger collapses and reopens it on both, and the app takes the space
 *      back on a desktop and is pushed on a phone
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";

/**
 * Where the API writes the verification mail.
 *
 * Found off the process that is listening, and not configured: a path written
 * down here goes stale on the next restart and the script then fails with "the
 * mail never came" while the API is sitting there perfectly healthy.
 */
const EMAIL_LOG = process.env.EMAIL_LOG ?? logOfTheApi();

function logOfTheApi() {
  const port = new URL(API).port || "4000";
  const pid = execSync(`lsof -tnP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  if (!pid) throw new Error(`nada escuchando en el puerto ${port} de la API`);
  const line = execSync(`lsof -p ${pid} | awk '/ 2w /{print $NF}'`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  if (!line) throw new Error(`no encuentro donde escribe la API del puerto ${port}`);
  return line;
}

const notes = [];
let failures = 0;

/**
 * A picture of each state, because "the same menu" is a claim about how it looks
 * and the numbers above only say where the edges are.
 */
const SHOTS = join(
  process.env.SHOT_DIR ??
    "/private/var/folders/wt/77gxhnd159q9gwd8j1qxqbdc0000gn/T/opencode",
  "drawer",
);
mkdirSync(SHOTS, { recursive: true });

async function shot(tab, name) {
  const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
  const file = join(SHOTS, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  note(`captura: ${file}`);
}

function check(name, ok, detail = "") {
  const line = `${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`;
  notes.push(line);
  // Printed as it happens, not only at the end: this script drives a real browser
  // for a minute and a half, and a run that stops answering tells you nothing
  // about which of the twenty checks it got to.
  console.log(line);
  if (!ok) failures += 1;
}

function note(text) {
  notes.push(`      ${text}`);
  console.log(`      ${text}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readLog() {
  try {
    return await readFile(EMAIL_LOG, "utf8");
  } catch {
    return "";
  }
}

/** Waits for the API to write something new, rather than sleeping and hoping. */
async function waitForLog(before, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = await readLog();
    if (now.length > before.length && pattern.test(now.slice(before.length))) return now;
    await sleep(400);
  }
  return readLog();
}

async function api(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    // The headers too: a 429 carries a `Retry-After`, and a check that reports
    // "rate limited" without saying for how long is a check you cannot act on.
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

/**
 * The window, at a size.
 *
 * `Emulation.setDeviceMetricsOverride` and not a new tab: a resize is exactly
 * what this change reacts to — `useIsWide` listens for it — and a check that
 * measured a second tab would never ask the question.
 */
async function resize(tab, width, height) {
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(900);
}

/**
 * Where the app is, and what the menu is saying.
 *
 * Measured off the DOM box of `drawer-app` and not off a flag in React: the whole
 * claim is about whether the screen was given the space, and a state variable
 * would agree with itself no matter what it drew.
 */
const GEOMETRY = `
  (() => {
    const app = document.querySelector('[data-testid="drawer-app"]');
    const panel = document.querySelector('[data-testid="drawer-panel"]');
    const r = app ? app.getBoundingClientRect() : null;
    return {
      appX: r ? Math.round(r.x) : null,
      appWidth: r ? Math.round(r.width) : null,
      window: window.innerWidth,
      panel: panel
        ? (panel.innerText || '').replace(/\\s+/g, ' ').trim()
        : null,
      expanded: document
        .querySelector('[data-testid="drawer-button"]')
        ?.getAttribute('aria-expanded'),
    };
  })()
`;

async function geometry(tab) {
  // With a deadline, because a renderer that has stopped answering is a result
  // and not a hang: an infinite render loop looks exactly like a slow page from
  // here, and the difference is the whole answer.
  return Promise.race([
    tab.evaluate(GEOMETRY),
    sleep(15000).then(() => {
      throw new Error("el navegador dejo de responder: hay un bucle de render");
    }),
  ]);
}

/** The hamburger, clicked the way a person clicks it. */
async function pressHamburger(tab) {
  await tab.evaluate(`
    (() => {
      const b = document.querySelector('[data-testid="drawer-button"]');
      if (!b) throw new Error('no hay boton de menu');
      b.click();
      return true;
    })()
  `);
  // The column takes 260 ms to come in and 200 to go out, plus a frame.
  await sleep(1000);
}

/**
 * Clicks the **arrow** that opens a branch, and not the row next to it.
 *
 * Both are `[role=button]` in the same row and both carry the name of the thing:
 * the row is the folder and the arrow is the disclosure, and matching on the name
 * alone finds the row and navigates into the folder instead of opening it. Which
 * is not a subtle difference to a reader of a failure — the check after this one
 * looks for the list inside the folder and never finds it.
 */
async function pressToggle(tab, name) {
  // The value of the evaluate, not a `sleep`: "did the arrow exist" is the
  // question, and a helper that answers with `undefined` turns every failure
  // into "the tree did not open", which is a different bug with the same
  // evidence.
  const found = await tab.evaluate(`
    (() => {
      const name = ${JSON.stringify(name.toLowerCase())};
      const panel = document.querySelector('[data-testid="drawer-panel"]');
      if (!panel) throw new Error('no hay panel');
      const el = [...panel.querySelectorAll('[role=button]')].find((e) => {
        const label = (e.getAttribute('aria-label') || '').toLowerCase();
        const rect = e.getBoundingClientRect();
        return (
          rect.width > 0 && rect.height > 0 &&
          label.includes(name) &&
          /ver lo que hay en|ocultar lo que hay en|see what is in|hide what is in/.test(label)
        );
      });
      if (!el) return false;
      el.click();
      return true;
    })()
  `);
  await sleep(700);
  return found === true;
}

const chrome = await launchChrome({ width: 1280, height: 900 });
let tab;

try {
  // ------------------------------------------------------------------ seed
  /**
   * One account for the whole life of the script, and a login before a register.
   *
   * Registering a new account on every run is what a throwaway script does, and
   * it runs out: the API allows a handful of registrations per IP per fifteen
   * minutes, so the fourth run of the day reports "rate_limited" and looks like
   * the drawer is broken. Signing in first makes the script re-runnable, which is
   * the only property worth having in a check that lives in the repo.
   *
   * The password is fixed and the account is a local dev one, so it is not a
   * secret and there is nothing here worth leaking.
   */
  const email = process.env.DRAWER_EMAIL ?? "drawer-verify@orbithub.test";
  const password = "a-very-long-password";
  const device = { label: "verify script", platform: "web" };

  /**
   * The session, kept between runs.
   *
   * The API allows seven logins per IP per fifteen minutes, and a check that
   * needs a fresh one every time stops being a check and becomes something you
   * run once and then wait an hour. The tokens last far longer than that, so
   * they are cached and the login is only paid for when the cache has gone.
   */
  const CACHE = join(SHOTS, "sesion.json");
  let session = null;
  try {
    session = JSON.parse(readFileSync(CACHE, "utf8")).session ?? null;
  } catch {
    session = null;
  }
  if (session) note(`sesion del cache: ${session.user.email}`);

  if (!session) {
    const intento = await api("/auth/login", {
      method: "POST",
      body: { email, password, device },
    });

    /**
     * A 429 is not "the account is missing".
     *
     * Falling through to `/auth/register` on any login failure is what turns a
     * rate limit into a confusing report: the register then fails too, and the
     * message says the account cannot be created when in fact the account is
     * fine and the window has not elapsed. So the two are told apart here, and
     * the 429 is reported as the 429 it is, with the number of seconds the API
     * itself asked for.
     */
    if (intento.status === 429) {
      const retry = intento.headers?.get?.("retry-after") ?? "?";
      throw new Error(
        `la API ha limitado las entradas (429) y pide ${retry}s. ` +
          "Espera ese tiempo y vuelve a lanzarlo; la cuenta existe y no hay que " +
          "volver a crearla.",
      );
    }

    session = intento.body?.data?.session ?? null;
  }

  if (!session) {
    // The mark in the log is taken *before* registering: after registering the
    // token is already there and "wait for something new" waits forever.
    const logBefore = await readLog();

    const registered = await api("/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        displayName: "Drawer",
        locale: "es",
        acceptedTermsAt: new Date().toISOString(),
        device,
      },
    });
    if (registered.status !== 201) {
      throw new Error(
        `registro fallo: ${JSON.stringify(registered.body)}. ` +
          "Si dice rate_limited, la API admite pocas cuentas por IP: " +
          "espera la ventana o borra la cuenta de " +
          "`drawer-verify@orbithub.test` de la base local.",
      );
    }

    const logAfter = await waitForLog(logBefore, /verify-email\?token=/, 15000);
    const link = logAfter.slice(logBefore.length).match(/verify-email\?token=([A-Za-z0-9_-]+)/);
    if (!link?.[1]) throw new Error("el correo de verificacion no salio en el log de la API");

    const verified = await api("/auth/verify-email", { method: "POST", body: { token: link[1] } });
    check("la cuenta se verifica", verified.status === 200, `status ${verified.status}`);

    const login = await api("/auth/login", { method: "POST", body: { email, password, device } });
    if (login.status !== 200) throw new Error(`login fallo: ${JSON.stringify(login.body)}`);
    session = login.body.data.session;
  } else {
    note(`sesion reutilizada: ${email}`);
  }
  note(`sesion: ${session.user.email}`);

  // Cached *after* the account exists, so the next run never logs in again.
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(
    join(SHOTS, "sesion.json"),
    JSON.stringify({ session, at: Date.now() }, null, 2),
  );

  const token = session.accessToken;
  const ahora = new Date().toISOString();

  /**
   * The tree, pushed fresh on every run.
   *
   * A fixed id per branch, not a random one, and not because the data has to be
   * stable — because a random id every run means a second space every run, and
   * after four runs the menu is a list of ten leftovers and the check that
   * compares it against a screenshot is comparing against a different list each
   * time. Naming them is what makes the fixture a fixture.
   */
  const casa = "11111111-1111-4111-8111-111111111111";
  const cine = "22222222-2222-4222-8222-222222222222";
  const carpeta = "33333333-3333-4333-8333-333333333333";
  const lista = "44444444-4444-4444-8444-444444444444";
  const op = (entity, entityId, payload) => ({
    operationId: randomUUID(),
    clientId: "verify-drawer",
    entity,
    kind: "create",
    entityId,
    baseVersion: 0,
    payload,
    base: null,
    clientTimestamp: ahora,
  });

  const pushed = await api("/sync/push", {
    method: "POST",
    token,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [
        op("workspace", casa, { name: "Casa", emoji: "🏠", color: "teal" }),
        op("workspace", cine, { name: "Cine", emoji: "🎬", color: "rose" }),
        // A folder inside the space, and a list inside the folder: two levels of
        // tree, which is the depth at which the old wide drawer was just a list of
        // spaces.
        op("folder", carpeta, { workspaceId: casa, parentId: null, name: "Papeles" }),
        op("list", lista, { workspaceId: casa, folderId: carpeta, title: "Compra", kind: "tasks" }),
      ],
      clientTimestamp: ahora,
    },
  });
  check("la siembra por la API se acepta", pushed.status === 200, `status ${pushed.status}`);

  // -------------------------------------------------------------- the browser
  tab = await openTab(chrome.port);
  const problems = collectProblems(tab);

  await tab.goto(`${APP}/`);

  /**
   * Wipe the app's own storage before the session is planted.
   *
   * The menu is drawn from the *local* store, not from the API, and the local
   * store is not keyed by account. So a profile that has already been used by
   * another account still holds that account's spaces, and the menu lists them
   * next to the ones this run seeded — which made the first run of this script
   * compare a panel of ten spaces against a panel of ten spaces and call it a
   * match, when what it had actually proven was that both screens showed the
   * same pile of leftovers.
   *
   * A verification that inherits its fixtures is not verifying the thing.
   */
  const borrado = await tab.evaluate(`
    (() => {
      let n = 0;
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('orbithub:')) { localStorage.removeItem(k); n += 1; }
      }
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith('orbithub:')) sessionStorage.removeItem(k);
      }
      if (window.indexedDB?.databases) {
        // Reported, not deleted: there is no way to do it synchronously and a
        // half-cleared database is worse than a reported one.
      }
      return n;
    })()
  `);
  note(`claves de orbithub borradas del perfil: ${borrado}`);

  await tab.evaluate(`
    (() => {
      localStorage.setItem("orbithub:access-token", ${JSON.stringify(session.accessToken)});
      localStorage.setItem("orbithub:refresh-token", ${JSON.stringify(session.refreshToken)});
      localStorage.setItem("orbithub:session-meta", JSON.stringify({
        expiresIn: ${JSON.stringify(session.expiresIn)},
        issuedAt: Date.now(),
        user: ${JSON.stringify(session.user)},
      }));
      return true;
    })()
  `);
  await tab.goto(`${APP}/`);

  // Wait for the app to be signed in and the home panel to be drawn, rather than
  // sleeping: the drawer is not in the document at all until the session exists.
  const deadline = Date.now() + 60000;
  let arrived = false;
  while (Date.now() < deadline) {
    arrived = await tab
      .evaluate("!!document.querySelector('[data-testid=\"drawer-button\"]')")
      .catch(() => false);
    if (arrived) break;
    await sleep(600);
  }
  check("la app entra con la sesion puesta", arrived);
  if (!arrived) throw new Error("no llego la app firmada");

  const real = problems.filter(
    (p) => !/favicon|React DevTools|source-?map|shares\/inbox/i.test(p.text),
  );
  check(
    "sin errores de consola, excepciones ni respuestas 4xx/5xx",
    real.length === 0,
    real.slice(0, 4).map((p) => `[${p.kind}] ${p.text.slice(0, 160)}`).join(" | "),
  );

  // What the hamburger actually publishes about itself.
  const atributos = await tab.evaluate(`
    (() => {
      const b = document.querySelector('[data-testid="drawer-button"]');
      if (!b) return null;
      return {
        tag: b.tagName,
        role: b.getAttribute('role'),
        ariaLabel: b.getAttribute('aria-label'),
        ariaExpanded: b.getAttribute('aria-expanded'),
        describedBy: b.getAttribute('aria-describedby'),
        all: [...b.attributes].map(a => a.name + '=' + a.value.slice(0, 40)),
      };
    })()
  `);
  note(`boton: ${JSON.stringify(atributos)}`);
  check("el boton dice si esta abierto", atributos?.ariaExpanded !== null, `aria-expanded=${atributos?.ariaExpanded}`);

  // ------------------------------------------------------- 1. the wide screen
  await resize(tab, 1280, 900);
  const wide = await geometry(tab);
  note(`ancho: app en ${wide.appX}, mide ${wide.appWidth}, ventana ${wide.window}`);
  note(`aria-expanded: ${wide.expanded}`);

  /**
   * One panel and one app, and not two of each.
   *
   * The bug this is here for is the shape of the bug itself: the layout used to
   * render one of two, and a shell that forks per screen is very easy to write as
   * "two, one of which is hidden" by accident. Two panels in the document means
   * two menus being drawn, two trees being read, and one of them at a width
   * nobody chose.
   */
  const cuantos = await tab.evaluate(`
    (() => ({
      panels: document.querySelectorAll('[data-testid="drawer-panel"]').length,
      apps: document.querySelectorAll('[data-testid="drawer-app"]').length,
      botones: document.querySelectorAll('[data-testid="drawer-button"]').length,
    }))()
  `);
  note(`en el documento: ${JSON.stringify(cuantos)}`);
  check("hay un solo panel y una sola app", cuantos.panels === 1 && cuantos.apps === 1, JSON.stringify(cuantos));
  check("y un solo boton de menu en la pantalla", cuantos.botones === 1, `${cuantos.botones} botones`);

  check("el panel esta en el sitio en una pantalla ancha", wide.panel !== null);
  check(
    "empieza abierto, y la app empieza a la derecha de el",
    wide.appX === 288,
    `la app empieza en ${wide.appX} y deberia en 288`,
  );
  check(
    "la columna se lleva su parte y la app el resto",
    wide.appWidth === 1280 - 288,
    `la app mide ${wide.appWidth} de 1280-288`,
  );
  check("el boton dice que esta abierto", wide.expanded === "true", `aria-expanded=${wide.expanded}`);

  // -------------------------------------------------- 2. the tree, on a desktop
  // The claim that was not true before: a wide screen showed a flat list of
  // spaces, so the lists and the folders were simply not there to click.
  const opened = await pressToggle(tab, "Casa");
  if (!opened) {
    const labels = await tab.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="drawer-panel"]');
        if (!panel) return ['no hay panel'];
        return [...panel.querySelectorAll('[role=button]')].map((e) => {
          const r = e.getBoundingClientRect();
          return e.getAttribute('aria-label') + ' [' + Math.round(r.width) + 'x' + Math.round(r.height) + ']';
        });
      })()
    `);
    note(`botones del panel: ${JSON.stringify(labels)}`);
  }
  check("la flecha de un espacio abre en una pantalla ancha", opened);

  const conArbol = await pressToggle(tab, "Papeles");
  check("la flecha de una carpeta abre en una pantalla ancha", conArbol);

  const arbol = await geometry(tab);
  check(
    "una lista dentro de una carpeta se ve en una pantalla ancha",
    (arbol.panel ?? "").includes("Compra"),
    (arbol.panel ?? "").slice(0, 160),
  );
  check("y la carpeta tambien", (arbol.panel ?? "").includes("Papeles"));
  check("y el otro espacio tambien", (arbol.panel ?? "").includes("Cine"));

  const panelAncho = arbol.panel;
  await shot(tab, "ancho-abierto");

  // ------------------------------------------------- 3. the hamburger, wide
  await pressHamburger(tab);
  const collapsed = await geometry(tab);
  note(`colapsado: app en ${collapsed.appX}, mide ${collapsed.appWidth}`);
  check(
    "la hamburguesa colapsa la columna en una pantalla ancha",
    collapsed.appX === 0,
    `la app empieza en ${collapsed.appX} y deberia en 0`,
  );
  check(
    "y la app se queda con todo el ancho",
    collapsed.appWidth === 1280,
    `la app mide ${collapsed.appWidth}`,
  );
  check(
    "y el boton dice que esta cerrado",
    collapsed.expanded === "false",
    `aria-expanded=${collapsed.expanded}`,
  );
  await shot(tab, "ancho-colapsado");

  await pressHamburger(tab);
  const reopened = await geometry(tab);
  check("y la vuelve a abrir", reopened.appX === 288, `la app empieza en ${reopened.appX}`);

  // ------------------------------------------------------- 4. the phone
  await resize(tab, 430, 932);
  const phoneClosed = await geometry(tab);
  note(`movil cerrado: app en ${phoneClosed.appX}, mide ${phoneClosed.appWidth}`);
  check(
    "al estrecha a movil el menu se cierra solo",
    phoneClosed.appX === 0,
    `la app empieza en ${phoneClosed.appX}`,
  );
  check("y el boton lo dice", phoneClosed.expanded === "false", `aria-expanded=${phoneClosed.expanded}`);

  await pressHamburger(tab);
  const phoneOpen = await geometry(tab);
  note(`movil abierto: app en ${phoneOpen.appX}, mide ${phoneOpen.appWidth}`);
  // The push: the app keeps its own width and is displaced to the right, so the
  // strip of app left behind is the same strip it always was.
  check(
    "la hamburguesa empuja la app en un movil",
    phoneOpen.appX === 284,
    `la app empieza en ${phoneOpen.appX} y deberia en 284 (0.66 de 430)`,
  );
  check(
    "y la app no se encoge: se sale por la derecha",
    phoneOpen.appWidth === 430,
    `la app mide ${phoneOpen.appWidth} de 430`,
  );

  const panelMovil = phoneOpen.panel;
  await shot(tab, "movil-abierto");

  // ------------------------------------------- 5. the same menu, both screens
  check(
    "el menu es el mismo en las dos pantallas, palabra por palabra",
    panelMovil !== null && panelMovil === panelAncho,
    panelMovil === null
      ? "el panel del movil no se leyo"
      : `movil ${panelMovil.length} caracteres, ancho ${panelAncho?.length}`,
  );
  if (panelMovil !== panelAncho) {
    note(`  movil: ${JSON.stringify(panelMovil?.slice(0, 300))}`);
    note(`  ancho: ${JSON.stringify(panelAncho?.slice(0, 300))}`);
  }

  // ------------------------------------------------------- 6. the light theme
  // The column carries its own surface and its own right-hand edge now, and both
  // of those are theme tokens. A menu that only works against a dark background
  // is a menu that does not work.
  await tab.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await resize(tab, 1280, 900);
  await tab.goto(`${APP}/`);

  // Waiting for the panel to exist is not waiting for the screen to be drawn: the
  // panel is mounted from the first frame, before the spaces have been read, and
  // a screenshot taken then shows a menu with no chevrons in it and a hamburger
  // that has not been laid out yet — which looks exactly like a broken menu and
  // is not one.
  const deadlineLight = Date.now() + 45000;
  let listo = false;
  while (Date.now() < deadlineLight) {
    listo = await tab
      .evaluate(`
        (() => {
          const b = document.querySelector('[data-testid="drawer-button"]');
          if (!b) return false;
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && b.textContent.trim().length > 0;
        })()
      `)
      .catch(() => false);
    if (listo) break;
    await sleep(600);
  }
  const dentro = await tab.evaluate(`
    (() => {
      const b = document.querySelector('[data-testid="drawer-button"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const hijos = [...b.querySelectorAll('*')].map((e) => e.tagName + '.' + (e.className || '').toString().slice(0, 30));
      return { html: b.innerHTML.slice(0, 260), rect: [Math.round(r.width), Math.round(r.height)], hijos };
    })()
  `);
  note(`boton en claro: ${JSON.stringify(dentro)}`);
  check("el boton se pinta en claro", listo);

  // The spaces arrive from the local store, so the chevrons are the last thing
  // to be there. A menu that is checked before they land is a menu checked
  // against nothing.
  const conArbolClaro = await (async () => {
    for (let i = 0; i < 25; i += 1) {
      const hay = await tab
        .evaluate(`
          !!document.querySelector('[data-testid="drawer-panel"] [aria-expanded]')
        `)
        .catch(() => false);
      if (hay) return true;
      await sleep(600);
    }
    return false;
  })();
  check("el arbol de espacios llega en claro", conArbolClaro);
  await sleep(600);

  const claro = await tab.evaluate(`
    (() => {
      const panel = document.querySelector('[data-testid="drawer-panel"]');
      const app = document.querySelector('[data-testid="drawer-app"]');
      if (!panel || !app) return null;
      const p = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      return {
        appX: Math.round(app.getBoundingClientRect().x),
        panelWidth: Math.round(p.width),
        background: cs.backgroundColor,
        borderRight: cs.borderRightColor,
        borderWidth: cs.borderRightWidth,
      };
    })()
  `);
  note(`claro: ${JSON.stringify(claro)}`);
  check("la columna tambien esta en su sitio en claro", claro?.appX === 288, `app en ${claro?.appX}`);
  check("el panel es opaco, no transparente sobre la app", !!claro?.background && !/rgba\(0, 0, 0, 0\)/.test(claro.background), claro?.background);
  check("y tiene su propio borde derecho", Number.parseFloat(claro?.borderWidth ?? "0") > 0, `borde ${claro?.borderWidth} ${claro?.borderRight}`);
  await shot(tab, "claro-abierto");

  await pressHamburger(tab);
  const claroCerrado = await geometry(tab);
  check("y colapsa igual en claro", claroCerrado.appX === 0, `app en ${claroCerrado.appX}`);
  await shot(tab, "claro-colapsado");

  // ---------------------------------------------------- 7. the folder rows
  // Both screens the folder row is drawn in: the space itself, and inside a
  // folder. The row used to carry a 📁 emoji in the circle where every list row
  // carries a stroked glyph, so a picture of the two is the only way to see that
  // a folder and a list look like the same kind of row.
  //
  // Taken here and not in a script of their own because the API allows a handful
  // of registrations *and* logins per IP per fifteen minutes, and a check that
  // needs its own session is a check that cannot be run twice in an afternoon.
  // This one already has a session and already knows which space is which.
  await tab.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await tab.goto(`${APP}/`);
  for (let i = 0; i < 60; i += 1) {
    const hay = await tab
      .evaluate("!!document.body.innerText.includes('Papeles')")
      .catch(() => false);
    if (hay) break;
    await sleep(600);
  }

  for (const [nombre, texto] of [
    ["carpeta-espacio", "Papeles"],
    ["carpeta-dentro", "Compra"],
  ]) {
    await tab.goto(`${APP}/workspace/${casa}`);
    if (nombre === "carpeta-dentro") {
      // Into the folder first: the row with the list in it is inside it, and
      // navigating straight to the list would miss the folder above it.
      await tab.evaluate(`
        (() => {
          const e = [...document.querySelectorAll('[role=button]')]
            .find((b) => b.getAttribute('aria-label') === 'Papeles');
          if (e) e.click();
          return !!e;
        })()
      `);
      await sleep(1500);
    }

    let llego = false;
    for (let i = 0; i < 40; i += 1) {
      llego = await tab
        .evaluate(`!!document.body.innerText.includes(${JSON.stringify(texto)})`)
        .catch(() => false);
      if (llego) break;
      await sleep(600);
    }
    check(`la pantalla de ${nombre} se dibuja`, llego);
    if (llego) {
      await sleep(900);
      await shot(tab, nombre);
    }
  }

  /**
   * The leading tile of a row is a line icon and not a picture.
   *
   * Read off the rendered font, because that is the difference and nothing else
   * is: `ionicons` is a font and a 📁 is a glyph of a colour font, and the two
   * are indistinguishable in the source once the emoji is a string in a
   * fallback.
   */
  const glifos = await tab.evaluate(`
    (() => {
      const fila = [...document.querySelectorAll('[role=button]')]
        .find((e) => e.getAttribute('aria-label') === 'Compra');
      if (!fila) return null;
      return [...fila.querySelectorAll('*')]
        .map((e) => ({
          texto: (e.textContent || '').trim().slice(0, 3),
          fuente: e.style?.fontFamily || '',
        }))
        .filter((g) => g.fuente);
    })()
  `);
  note(`fuentes en la fila de la lista: ${JSON.stringify(glifos)}`);
  check(
    "la fila de la lista se dibuja con ionicons, no con una imagen de color",
    Array.isArray(glifos) && glifos.some((g) => g.fuente.includes("ionicons")),
    JSON.stringify(glifos),
  );
} catch (error) {
  failures += 1;
  notes.push(`FALLA  el script no pudo terminar: ${error.message}`);
} finally {
  tab?.close();
  await chrome.kill();
}

console.log(notes.join("\n"));
console.log(failures === 0 ? "\nTODO OK" : `\n${failures} COMPROBACIONES FALLIDAS`);
process.exit(failures === 0 ? 0 : 1);
