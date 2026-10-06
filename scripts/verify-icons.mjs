import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import {
  launchChrome,
  openTab,
  seedSession,
  collectProblems,
  waitForIconFont,
} from "./cdp.mjs";

/**
 * Los iconos unificados, mirados en un navegador.
 *
 * Siembra un espacio, una lista y dos tareas por `POST /sync/push`, abre la
 * lista, le pone a una tarea un emoji desde el selector, a la otra un dibujo
 * con relleno y color, y comprueba en la API que lo que se ve es lo que se
 * guardó. Un cambio que se ve en pantalla y no llega al servidor es la mitad
 * de un bug, y un `console.error` es un bug aunque la pantalla se vea bien.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const SESSION_FILE = process.env.SESSION_FILE ?? "/private/tmp/orbit-icons-session.json";
const SHOTS = process.env.SHOTS_DIR ?? "capturas/icons";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (text) => console.log(`      ${text}`);
const section = (text) => console.log(`\n--- ${text}`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok" : "FALLO"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

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

const api = async (path, { method = "GET", body = null, token = null } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let tab = null;
let sesion = null;

async function account() {
  try {
    const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
    if ((await api("/auth/me", { token: saved.accessToken })).status === 200) return saved;
  } catch {
    /* ninguna todavia */
  }
  const email = `icons-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  const before = await readFile(EMAIL_LOG, "utf8").catch(() => "");
  await api("/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      displayName: "Iconos",
      locale: "es",
      acceptedTermsAt: new Date().toISOString(),
      device: { label: "icons", platform: "web" },
    },
  });
  const deadline = Date.now() + 20000;
  let after = before;
  while (Date.now() < deadline && !/verify-email\?token=/.test(after.slice(before.length))) {
    await sleep(400);
    after = await readFile(EMAIL_LOG, "utf8").catch(() => "");
  }
  const link = after.slice(before.length).match(/verify-email\?token=([A-Za-z0-9_-]+)/);
  if (!link?.[1]) throw new Error("el correo de verificacion no salio en el log");
  await api("/auth/verify-email", { method: "POST", body: { token: link[1] } });
  const session = (
    await api("/auth/login", {
      method: "POST",
      body: { email, password, device: { label: "icons", platform: "web" } },
    })
  ).body.data.session;
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

async function push(token, operations) {
  const deviceId = randomUUID();
  const res = await api("/sync/push", {
    method: "POST",
    token,
    body: {
      deviceId,
      lastPulledAt: null,
      operations: operations.map((op) => ({
        operationId: randomUUID(),
        clientId: deviceId,
        baseVersion: 0,
        base: null,
        clientTimestamp: new Date().toISOString(),
        ...op,
      })),
    },
  });
  // A push with every operation rejected is still a 200 with no `data.results`
  // at all, so a check that only reads the results reports a seed that worked.
  // The status and the error shape are checked first, and then each result.
  if (res.status !== 200 || !res.body?.data?.results) {
    throw new Error(`el push no llego: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  for (const result of res.body.data.results ?? []) {
    if (result.status !== "applied") {
      throw new Error(`operacion rechazada: ${JSON.stringify(result).slice(0, 200)}`);
    }
  }
  return res;
}

/** Un botón por el nombre que lee una persona, sin el glifo del icono. */
const pressLabel = (needle, { exact = false, root = null } = {}) =>
  tab.evaluate(`
    (() => {
      const raiz = ${root ? `document.querySelector(${JSON.stringify(root)})` : "document"};
      if (!raiz) return false;
      const limpio = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      const want = limpio(${JSON.stringify(needle)}).toLowerCase();
      const el = [...raiz.querySelectorAll('[role="button"],[aria-label]')]
        .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0)
        .find((e) => {
          const label = limpio(e.getAttribute("aria-label") || "").toLowerCase();
          return ${exact ? "label === want" : "label.includes(want)"};
        });
      if (!el) return false;
      el.click();
      return true;
    })()
  `);

/** Un toque por testID, para lo que no tiene nombre leíble (una celda de emoji). */
const pressTestId = (testId) =>
  tab.evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)});
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return "invisible";
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    })()
  `);

/** Escribe en un campo por su etiqueta accesible, como una persona. */
const typeInto = (ariaLabel, text) =>
  tab.evaluate(`
    (() => {
      const campo = [...document.querySelectorAll("input,textarea")].find(
        (el) => el.getAttribute("aria-label") === ${JSON.stringify(ariaLabel)},
      );
      if (!campo) return { escrito: false };
      const proto = campo.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(campo, "");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(campo, ${JSON.stringify(text)});
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      return { escrito: campo.value === ${JSON.stringify(text)} };
    })()
  `);

const whereAmI = () =>
  tab.evaluate(
    `(() => ({ path: location.pathname, rows: document.querySelectorAll('[data-testid^="item-row-"]').length }))()`,
  );

async function waitForRows({ expect = 1, timeout = 45000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(400);
    const last = await whereAmI().catch(() => null);
    if (last && last.rows >= expect) {
      await sleep(900);
      return last;
    }
  }
  throw new Error("la lista no se quedo quieta");
}

async function shot(name) {
  const font = await waitForIconFont(tab);
  if (!font.ok) note("la fuente de iconos no llego antes de la captura");
  return tab.screenshot(`${SHOTS}/${name}.png`);
}

/**
 * Lo que el servidor tiene de verdad, y no lo que la pantalla enseña.
 *
 * Se espera y no se lee una vez: la escritura sale del telefono a su ritmo
 * (outbox, flush, push) y leer a los 1200 ms mide la pantalla de antes del
 * toque. Un cambio que se ve y no llega es la mitad de un bug.
 */
async function waitForServerIcon(listId, itemId, want, { timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(600);
    const items = await api(`/lists/${listId}/items`, { token: sesion.accessToken });
    last = (items.body?.data?.items ?? []).find((r) => r.id === itemId)?.icon ?? null;
    if (want(last)) return last;
  }
  return last;
}

const problems = [];
const chrome = await launchChrome();
try {
  const session = await account();
  sesion = session;
  const token = session.accessToken;

  const ws = randomUUID();
  const lista = randomUUID();
  const tareaEmoji = randomUUID();
  const tareaVector = randomUUID();

  await push(token, [
    { entity: "workspace", kind: "create", entityId: ws, payload: { name: "Iconos" } },
    {
      entity: "list",
      kind: "create",
      entityId: lista,
      payload: { workspaceId: ws, title: "Compra", kind: "tasks" },
    },
    {
      entity: "list_item",
      kind: "create",
      entityId: tareaEmoji,
      payload: { listId: lista, title: "Libro", position: 0 },
    },
    {
      entity: "list_item",
      kind: "create",
      entityId: tareaVector,
      payload: { listId: lista, title: "Pan", position: 1 },
    },
  ]);

  tab = await openTab(chrome.port);
  problems.push(...collectProblems(tab));
  const desdeElPrincipio = 0;
  await seedSession(tab, session, APP);

  /* ---------------- 1. La lista, sin iconos todavia ---------------- */
  section("1. La lista con dos tareas sin icono");
  await tab.goto(`${APP}/list/${lista}`);
  await waitForRows({ expect: 2 });
  await shot("01-lista-sin-iconos");
  check("la lista pinta sus dos tareas", (await whereAmI()).rows >= 2);

  /* ---------------- 2. Un emoji desde el selector ---------------- */
  section("2. Un emoji elegido en el selector llega al servidor");
  if (!(await pressLabel("Libro", { exact: false, root: `[data-testid="item-row-${tareaEmoji}"]` }))) {
    throw new Error("no se abrio la hoja de Libro");
  }
  await sleep(800);
  if (!(await pressLabel("Icono", { exact: true }))) throw new Error("no se abrio la pagina de iconos");
  await sleep(800);
  const escrito = await typeInto("Buscar un icono", "libro");
  if (!escrito.escrito) throw new Error("no se pudo escribir en el buscador de emojis");
  // La búsqueda lleva rebote y la cuadrícula se pinta después: tocar antes es
  // tocar lo que había, no lo que se busca.
  {
    const deadline = Date.now() + 15000;
    let hay = false;
    while (Date.now() < deadline && !hay) {
      await sleep(400);
      hay = await tab.evaluate(
        `!!document.querySelector('[data-testid="emoji-cell-📖"]')`,
      );
    }
    if (!hay) throw new Error("el libro no aparecio en el buscador");
  }
  const tocado = await pressTestId("emoji-cell-📖");
  if (tocado !== true) throw new Error(`no se pudo tocar el libro: ${tocado}`);
  const iconoEmoji = await waitForServerIcon(
    lista,
    tareaEmoji,
    (icon) => icon?.type === "emoji" && icon?.value === "📖",
  );
  await shot("02-emoji-elegido");

  check(
    "el emoji se guardo como objeto",
    iconoEmoji?.type === "emoji" && iconoEmoji?.value === "📖",
    JSON.stringify(iconoEmoji),
  );

  /* ---------------- 3. Un dibujo con relleno y color ---------------- */
  section("3. Un dibujo con relleno y rosa llega al servidor");
  await pressLabel("Cerrar", { exact: true });
  await sleep(700);
  await shot("03a-despues-de-cerrar");
  if (!(await pressLabel("Pan", { exact: false, root: `[data-testid="item-row-${tareaVector}"]` }))) {
    throw new Error("no se abrio la hoja de Pan");
  }
  await sleep(800);
  if (!(await pressLabel("Icono", { exact: true }))) throw new Error("no se abrio la pagina de iconos");
  await sleep(800);
  if ((await pressTestId("icon-tab-vector")) !== true) throw new Error("no se abrio la pestana de dibujos");
  await sleep(500);
  await shot("03b-pestana-vector");
  const escritoVector = await typeInto("Buscar un icono", "pan");
  if (!escritoVector.escrito) throw new Error("no se pudo escribir en el buscador de dibujos");
  await sleep(800);
  if ((await pressTestId("icon-style-fill")) !== true) throw new Error("no se pudo elegir relleno");
  if ((await pressTestId("icon-color-rose")) !== true) throw new Error("no se pudo elegir rosa");
  if ((await pressTestId("icon-cell-pan")) !== true) throw new Error("no se pudo tocar el pan");
  const iconoVector = await waitForServerIcon(
    lista,
    tareaVector,
    (icon) =>
      icon?.type === "vector" &&
      icon?.value === "pan" &&
      icon?.style === "fill" &&
      icon?.color === "rose",
  );
  await shot("03-vector-elegido");

  check(
    "el dibujo se guardo con su estilo y su color",
    iconoVector?.type === "vector" &&
      iconoVector?.value === "pan" &&
      iconoVector?.style === "fill" &&
      iconoVector?.color === "rose",
    JSON.stringify(iconoVector),
  );

  /* ---------------- 4. Cambiar el color no borra el icono ---------------- */
  section("4. Elegir color despues no borra el icono");
  if ((await pressTestId("icon-color-teal")) !== true) throw new Error("no se pudo elegir verde azulado");
  if ((await pressTestId("icon-cell-pan")) !== true) throw new Error("no se pudo retocar el pan");
  const iconoColor = await waitForServerIcon(
    lista,
    tareaVector,
    (icon) => icon?.type === "vector" && icon?.value === "pan" && icon?.color === "teal",
  );
  check(
    "el icono sigue siendo el pan, ahora en verde azulado",
    iconoColor?.type === "vector" &&
      iconoColor?.value === "pan" &&
      iconoColor?.color === "teal",
    JSON.stringify(iconoColor),
  );
  await shot("04-color-cambiado");

  /* ---------------- 5. La consola ---------------- */
  section("5. La consola");
  check(
    "nada fallo en la consola desde que se abrio la pestana",
    problems.length === desdeElPrincipio,
    problems
      .slice(desdeElPrincipio)
      .map((p) => `${p.kind}: ${p.text.slice(0, 120)}`)
      .join(" | ") || "0 problemas",
  );
} finally {
  chrome.kill();
}

if (failures > 0) {
  console.log(`\n${failures} comprobacion(es) en rojo`);
  process.exit(1);
}
console.log("\ntodo verde");
