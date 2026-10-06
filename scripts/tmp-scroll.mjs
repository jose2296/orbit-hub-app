import { readFile, writeFile } from "node:fs/promises";
import { launchChrome, openTab, seedSession, waitForIconFont } from "./cdp.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = "http://localhost:8081";
const API = "http://localhost:4000/api/v1";
const FILE = "/private/tmp/orbit-demo-session.json";

const session = (
  await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "demo@orbit.local",
      password: "orbit-demo-2026",
      device: { label: "diag", platform: "web" },
    }),
  }).then((r) => r.json())
).data.session;
await writeFile(FILE, JSON.stringify(session, null, 2));

const pull = await fetch(`${API}/sync/pull`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
  body: JSON.stringify({ deviceId: crypto.randomUUID(), cursor: null, limit: 300 }),
}).then((r) => r.json());
const lista = pull.data.changes.find((c) => c.entity === "list");

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
  await sleep(3000);

  // Todos los nodos que scrollean, con su estado.
  const scrollers = await tab.evaluate(`(() => {
    const out = [];
    document.querySelectorAll('*').forEach((n) => {
      const s = getComputedStyle(n);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
        out.push({
          tag: n.tagName,
          testid: n.getAttribute('data-testid') || n.className?.toString?.().slice(0,40) || '',
          alto: n.clientHeight, contenido: n.scrollHeight, top: Math.round(n.scrollTop),
          y: Math.round(n.getBoundingClientRect().top),
        });
      }
    });
    return out;
  })()`);
  console.log("NODOS QUE SCOLLEAN:", JSON.stringify(scrollers, null, 1));

  // Rueda de verdad sobre la lista.
  const caja = await tab.evaluate(`(() => {
    let node = document.querySelector('[data-testid="icon-grid-emoji"]');
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      }
      node = node.parentElement;
    }
    return null;
  })()`);
  console.log("centro de la lista:", JSON.stringify(caja));

  const chip = () => tab.evaluate(`(() => {
    const chips = [...document.querySelectorAll('[data-testid^="icon-group-"]')];
    const on = chips.filter((e) => {
      const m = getComputedStyle(e).backgroundColor.match(/\\d+/g);
      if (!m) return false;
      const [r,g,b] = m.map(Number);
      return b > 120 && b - r > 40 && b - g > 40;
    }).map((e) => e.getAttribute("aria-label"));
    let node = document.querySelector('[data-testid="icon-grid-emoji"]');
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
        return { encendida: on, scrollTop: Math.round(node.scrollTop), contenido: node.scrollHeight };
      }
      node = node.parentElement;
    }
    return { encendida: on };
  })()`);

  console.log("inicio:", JSON.stringify(await chip()));
  for (let tanda = 1; tanda <= 5; tanda += 1) {
    for (let i = 0; i < 8; i += 1) {
      await tab.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: caja.x, y: caja.y, deltaX: 0, deltaY: 240,
      });
      await sleep(40);
    }
    await sleep(900);
    console.log(`tras ${tanda * 8 * 240}px de rueda:`, JSON.stringify(await chip()));
  }
  await tab.screenshot("capturas/icons/15-emoji-scroll-real.png");
  console.log("captura guardada");
} finally {
  chrome.kill();
}
