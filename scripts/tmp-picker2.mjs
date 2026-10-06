import { readFile, writeFile } from "node:fs/promises";
import { launchChrome, openTab, seedSession, waitForIconFont } from "./cdp.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = "http://localhost:8081";
const API = "http://localhost:4000/api/v1";
const FILE = "/private/tmp/orbit-demo-session.json";
const SHOTS = "capturas/icons";

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
const token = session.accessToken;

const pull = await fetch(`${API}/sync/pull`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ deviceId: crypto.randomUUID(), cursor: null, limit: 300 }),
}).then((r) => r.json());
const lista = pull.data.changes.find((c) => c.entity === "list");

const scrollerJs = (grid) => `(() => {
  let node = document.querySelector('[data-testid="icon-grid-${grid}"]');
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
})()`;

const estado = (tab) =>
  `(() => {
    const chips = [...document.querySelectorAll('[data-testid^="icon-group-"]')];
    const encendido = chips.filter((e) => {
      const m = getComputedStyle(e).backgroundColor.match(/\\d+/g);
      if (!m) return false;
      const [r,g,b] = m.map(Number);
      return b > 120 && b - r > 40 && b - g > 40;
    }).map((e) => e.getAttribute("aria-label"));
    const prefijo = "${tab}" === "emoji" ? "emoji-cell-" : "icon-cell-";
    const celdas = [...document.querySelectorAll('[data-testid^="'+prefijo+'"]')];
    const anchos = [...new Set(celdas.slice(0,60).map((e)=>Math.round(e.getBoundingClientRect().width)))];
    const altos = [...new Set(celdas.slice(0,60).map((e)=>Math.round(e.getBoundingClientRect().height)))];
    const node = ${scrollerJs(tab)};
    return {
      encendida: encendido,
      celdasMontadas: celdas.length,
      anchoUnico: anchos, altoUnico: altos,
      scrolleo: node ? { alto: node.clientHeight, contenido: node.scrollHeight } : null,
      primeraVisible: celdas[0] ? celdas[0].getAttribute("data-testid") : null,
    };
  })()`;

const chrome = await launchChrome({ width: 430, height: 932 });
try {
  const tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.goto(`${APP}/list/${lista.record.id}`);
  await sleep(9000);
  await waitForIconFont(tab);

  await tab.evaluate(`(() => {
    const row = document.querySelector('[data-testid^="item-row-"]');
    [...row.querySelectorAll('[role="button"]')]
      .find((e) => ["Pan","Leche","Cafe"].includes(e.getAttribute("aria-label") || ""))
      .click();
  })()`);
  await sleep(1400);
  await tab.evaluate(`(() => {
    [...document.querySelectorAll('[role="button"],[aria-label]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; })
      .find((e) => e.getAttribute("aria-label") === "Icono").click();
  })()`);
  await sleep(2500);

  for (const [cual, etiqueta] of [["emoji", "EMOJIS"], ["vector", "VECTORES"]]) {
    if (cual === "vector") {
      await tab.evaluate(`document.querySelector('[data-testid="icon-tab-vector"]').click()`);
      await sleep(3500);
    }
    console.log(`\n=== ${etiqueta} ===`);
    console.log("arriba:  ", JSON.stringify(await tab.evaluate(estado(cual))));

    for (const frac of [0.5, 0.9]) {
      await tab.evaluate(`(() => {
        const n = ${scrollerJs(cual)};
        n.scrollTop = n.scrollHeight * ${frac};
      })()`);
      await sleep(1400);
      const e = await tab.evaluate(estado(cual));
      console.log(`al ${Math.round(frac*100)}%:`, JSON.stringify({ encendida: e.encendida, primera: e.primeraVisible }));
    }

    // Tocar una categoria: tiene que saltar, no filtrar.
    const antes = await tab.evaluate(estado(cual));
    await tab.evaluate(`(() => {
      const chips = [...document.querySelectorAll('[data-testid^="icon-group-"]')];
      chips[chips.length - 1].click();
    })()`);
    await sleep(2200);
    const despues = await tab.evaluate(estado(cual));
    console.log("tocar la ultima categoria:", JSON.stringify({ antes: antes.encendida, despues: despues.encendida }));
    await tab.screenshot(`${SHOTS}/14-${cual}-ultima-categoria.png`);

    await tab.evaluate(`(() => { const n = ${scrollerJs(cual)}; n.scrollTop = 0; })()`);
    await sleep(800);
  }
  console.log("\ncapturas guardadas");
} finally {
  chrome.kill();
}
