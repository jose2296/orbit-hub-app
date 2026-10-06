import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { launchChrome, openTab, seedSession, waitForIconFont } from "./cdp.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = "http://localhost:8081";
const API = "http://localhost:4000/api/v1";
const FILE = "/private/tmp/orbit-demo-session.json";
const SHOTS = "capturas/icons";

let session = null;
try {
  const guardada = JSON.parse(await readFile(FILE, "utf8"));
  const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${guardada.accessToken}` } });
  if (me.status === 200) session = guardada;
} catch { session = null; }
if (!session) {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@orbit.local", password: "orbit-demo-2026", device: { label: "bar", platform: "web" } }),
  }).then((r) => r.json());
  session = login.data.session;
  await writeFile(FILE, JSON.stringify(session, null, 2));
}

const pull = await fetch(`${API}/sync/pull`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
  body: JSON.stringify({ deviceId: randomUUID(), cursor: null, limit: 100 }),
}).then((r) => r.json());
const lista = pull.data.changes.find((c) => c.entity === "list");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok" : "FALLO"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const chrome = await launchChrome({ width: 430, height: 932 });
try {
  const tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.goto(`${APP}/list/${lista.record.id}`);
  await sleep(9000);
  await waitForIconFont(tab);

  const filas = await tab.evaluate(`[...document.querySelectorAll('[data-testid^="item-row-"]')]
    .map((r) => r.getAttribute("data-testid"))`);
  console.log("FILAS:", JSON.stringify(filas));
  const titulos = await tab.evaluate(`(() => {
    const row = document.querySelector('[data-testid^="item-row-"]');
    if (!row) return [];
    return [...row.querySelectorAll('[role="button"]')].map((e) => e.getAttribute("aria-label"));
  })()`);
  console.log("TITULOS FILA:", JSON.stringify(titulos));
  const tocado = await tab.evaluate(`(() => {
    const row = document.querySelector('[data-testid^="item-row-"]');
    const btns = [...row.querySelectorAll('[role="button"]')].filter((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
    const titulo = btns.find((e) => e.getAttribute("aria-label") === "Pan");
    if (!titulo) return "sin-titulo:" + btns.map((e) => e.getAttribute("aria-label")).join("|");
    titulo.click();
    return "ok";
  })()`);
  console.log("TOCADO:", tocado);
  await tab.screenshot(`capturas/icons/69-despues-tocar.png`);
  await sleep(1400);
  const etiquetas = await tab.evaluate(`[...document.querySelectorAll('[role="button"],[aria-label]')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((e) => e.getAttribute("aria-label")).filter(Boolean).slice(0, 12)`);
  console.log("ETIQUETAS:", JSON.stringify(etiquetas));
  let iconoOk = false;
  for (let intento = 0; intento < 10 && !iconoOk; intento += 1) {
    await sleep(600);
    iconoOk = await tab.evaluate(`(() => {
      const el = [...document.querySelectorAll('[role="button"],[aria-label]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .find((e) => (e.getAttribute("aria-label") || "") === "Icono");
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
  }
  console.log("ICONO:", iconoOk);
  await sleep(2500);
  // La pestana inicial es la del icono que ya tiene la fila (vector en Pan):
  // se vuelve a emojis para probar la barra ahi.
  await tab.evaluate(`document.querySelector('[data-testid="icon-tab-emoji"]')?.click()`);
  await sleep(2500);
  console.log("grid:", await tab.evaluate(`!!document.querySelector('[data-testid="icon-grid-emoji"]')`));
  console.log("grid:", await tab.evaluate(`!!document.querySelector('[data-testid="icon-grid-emoji"]')`));

  // La barra y su estado: desplazamiento y que chip esta encendido y donde.
  const barra = () =>
    tab.evaluate(`(() => {
      const chip = [...document.querySelectorAll('[data-testid^="icon-group-"]')][0];
      if (!chip) return null;
      let n = chip.parentElement;
      while (n && n !== document.body) {
        const s = getComputedStyle(n);
        if (s.overflowX === "auto" || s.overflowX === "scroll") {
          const r = n.getBoundingClientRect();
          const encendido = [...n.querySelectorAll('[data-testid^="icon-group-"]')]
            .filter((e) => {
              const m = getComputedStyle(e).backgroundColor.match(/\\d+/g);
              if (!m) return false;
              const [rr, g, b] = m.map(Number);
              return b > 120 && b - rr > 40 && b - g > 40;
            })
            .map((e) => {
              const c = e.getBoundingClientRect();
              return {
                nombre: e.getAttribute("aria-label"),
                // Visible dentro de la barra o fuera de ella.
                visible: c.left >= r.left - 2 && c.right <= r.right + 2,
              };
            });
          return { scrollLeft: Math.round(n.scrollLeft), encendidos: encendido };
        }
        n = n.parentElement;
      }
      return null;
    })()`);

  // Rueda de verdad hasta el fondo de los emojis.
  const caja = await tab.evaluate(`(() => {
    let node = document.querySelector('[data-testid="icon-grid-emoji"]');
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if (s.overflowY === "auto" || s.overflowY === "scroll") {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
      node = node.parentElement;
    }
    return null;
  })()`);
  for (let tanda = 0; tanda < 8; tanda += 1) {
    for (let i = 0; i < 8; i += 1) {
      await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: caja.x, y: caja.y, deltaX: 0, deltaY: 300 });
      await sleep(40);
    }
    await sleep(800);
  }
  const final = await barra();
  console.log("BARRA:", JSON.stringify(final));
  check("la barra se ha movido de su sitio", (final?.scrollLeft ?? 0) > 50, JSON.stringify(final?.scrollLeft));
  check(
    "la categoria encendida se ve dentro de la barra",
    (final?.encendidos.length ?? 0) === 1 && final.encendidos[0].visible === true,
    JSON.stringify(final?.encendidos),
  );
  await tab.screenshot(`${SHOTS}/70-barra-sigue.png`);
} finally {
  chrome.kill();
}

if (failures > 0) {
  console.log(`\n${failures} comprobacion(es) en rojo`);
  process.exit(1);
}
console.log("\ntodo verde");
