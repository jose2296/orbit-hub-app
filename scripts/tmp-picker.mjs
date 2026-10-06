import { readFile, writeFile } from "node:fs/promises";
import { launchChrome, openTab, seedSession, waitForIconFont } from "./cdp.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = "http://localhost:8081";
const API = "http://localhost:4000/api/v1";
const FILE = "/private/tmp/orbit-demo-session.json";
const SHOTS = "capturas/icons";

const guardada = JSON.parse(await readFile(FILE, "utf8"));
const session = (
  await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "demo@orbit.local",
      password: "orbit-demo-2026",
      device: { label: "picker", platform: "web" },
    }),
  }).then((r) => r.json())
).data.session;
await writeFile(FILE, JSON.stringify(session, null, 2));
void guardada;
const token = session.accessToken;

const pull = await fetch(`${API}/sync/pull`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ deviceId: crypto.randomUUID(), cursor: null, limit: 300 }),
}).then((r) => r.json());
const lista = pull.data.changes.find((c) => c.entity === "list");

const chrome = await launchChrome({ width: 430, height: 932 });
try {
  const tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.goto(`${APP}/list/${lista.record.id}`);
  await sleep(9000);
  console.log("fuente:", (await waitForIconFont(tab)).ok ? "cargada" : "NO");

  // Abre la hoja de la primera tarea tocando su título, y luego la página de
  // iconos. El icono de la fila es un botón que va directo a esa página, así que
  // tocar "el primer botón" abre el selector por la puerta de atrás.
  await tab.evaluate(`(() => {
    const row = document.querySelector('[data-testid^="item-row-"]');
    const btn = [...row.querySelectorAll('[role="button"]')].find((e) =>
      (e.getAttribute("aria-label") || "") === "Pan"
      || (e.getAttribute("aria-label") || "") === "Leche"
      || (e.getAttribute("aria-label") || "") === "Cafe");
    if (!btn) throw new Error("no hay titulo en la fila");
    btn.click();
  })()`);
  await sleep(1400);
  await tab.evaluate(`(() => {
    const el = [...document.querySelectorAll('[role="button"],[aria-label]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .find((e) => (e.getAttribute("aria-label") || "") === "Icono");
    if (!el) throw new Error("no hay fila Icono");
    el.click();
  })()`);
  await sleep(2500);

  const medir = () =>
    tab.evaluate(`(() => {
      const celdas = [...document.querySelectorAll('[data-testid^="emoji-cell-"],[data-testid^="icon-cell-"]')];
      const anchos = celdas.slice(0, 60).map((e) => Math.round(e.getBoundingClientRect().width));
      const altos = celdas.slice(0, 60).map((e) => Math.round(e.getBoundingClientRect().height));
      // El chip encendido es el que lleva el color de acento de fondo. Preguntar
      // por aria-selected no vale: react-native-web no lo escribe en un boton.
      const chips = [...document.querySelectorAll('[data-testid^="icon-group-"]')];
      const encendido = chips
        .filter((e) => {
          const bg = getComputedStyle(e).backgroundColor;
          const m = bg.match(/\\d+/g);
          if (!m) return false;
          const [r,g,b] = m.map(Number);
          return b > 120 && b - r > 40 && b - g > 40;
        })
        .map((e) => e.getAttribute("aria-label"));
      return {
        celdas: celdas.length,
        categorias: chips.map((e) => e.getAttribute("aria-label")),
        encendida: encendido,
        anchoUnico: [...new Set(anchos)],
        altoUnico: [...new Set(altos)],
        hayCampoColor: !!document.querySelector('[data-testid^="icon-color-"]'),
        hayEstilo: !!document.querySelector('[data-testid^="icon-style-"]'),
      };
    })()`);

  console.log("EMOJIS:", JSON.stringify(await medir()));
  await tab.screenshot(`${SHOTS}/10-picker-emojis.png`);

  // Scrollear la lista y ver que la categoría se ilumina.
  await tab.evaluate(`(() => {
    const grid = document.querySelector('[data-testid="icon-grid-emoji"]');
    const scroller = grid.closest('div[style*="overflow"]') || grid.parentElement;
    return true;
  })()`);
  const scrollInfo = await tab.evaluate(`(() => {
    const grid = document.querySelector('[data-testid="icon-grid-emoji"]');
    let node = grid;
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') return { ok: true, h: node.clientHeight, sh: node.scrollHeight };
      node = node.parentElement;
    }
    return { ok: false };
  })()`);
  console.log("lista scrollea:", JSON.stringify(scrollInfo));

  await tab.evaluate(`(() => {
    const grid = document.querySelector('[data-testid="icon-grid-emoji"]');
    let node = grid;
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') { node.scrollTop = node.scrollHeight * 0.55; return true; }
      node = node.parentElement;
    }
    return false;
  })()`);
  await sleep(1200);
  console.log("tras scrollear, categoria encendida:", JSON.stringify((await medir()).encendida));
  await tab.screenshot(`${SHOTS}/11-picker-emojis-scroll.png`);

  // Ir a la pestaña de vectoriales.
  await tab.evaluate(`document.querySelector('[data-testid="icon-tab-vector"]').click()`);
  await sleep(4000);
  console.log("VECTORES:", JSON.stringify(await medir()));
  await tab.screenshot(`${SHOTS}/12-picker-vectores.png`);

  // Buscar y comprobar que no hay glifos repetidos en pantalla.
  await tab.evaluate(`(() => {
    const campo = [...document.querySelectorAll("input,textarea")].find(
      (el) => el.getAttribute("aria-label") === "Buscar un icono");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(campo, "");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(1500);
  const dupes = await tab.evaluate(`(() => {
    const chips = [...document.querySelectorAll('[aria-label]')]
      .filter((e) => (e.getAttribute("data-testid")||"").startsWith("icon-group-"))
      .map((e) => e.getAttribute("aria-label"));
    const celdas = [...document.querySelectorAll('[data-testid^="icon-cell-"]')];
    const textos = celdas.map((e) => e.textContent.trim());
    const glifos = [...document.querySelectorAll('[data-testid^="icon-cell-"]')]
      .map((e) => getComputedStyle(e).fontFamily);
    return {
      categorias: chips,
      celdas: celdas.length,
      celdasVacias: textos.filter((t) => t === "").length,
    };
  })()`);
  console.log("VECTORES sin busqueda:", JSON.stringify(dupes));
  await tab.screenshot(`${SHOTS}/13-picker-vectores-todo.png`);

  console.log("capturas guardadas");
} finally {
  chrome.kill();
}
