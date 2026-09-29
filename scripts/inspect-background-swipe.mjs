import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * Does the background swipe move the track at all while arranging?
 *
 * The check in `verify-panel-swipe.mjs` only sees the *outcome* — the page did not
 * change. There are two quite different reasons for that: the gesture never fires
 * and the track never moves, or it fires and the swipe is not committed. This
 * samples the track transform with the finger still down, which tells them apart.
 */
const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];

const shift = `
  (() => {
    const track = document.querySelector('[data-testid="panel-grid"]');
    const m = getComputedStyle(track).transform;
    return m && m !== "none" ? Math.round(parseFloat(m.split(",")[4]) || 0) : 0;
  })()
`;

const chrome = await launchChrome({ width: 390, height: 844 });
let tab;
try {
  const session = JSON.parse(await readFile("/private/tmp/orbit-size-session.json", "utf8"));
  const CLIENT = "bg-probe";
  const ws = randomUUID();
  const lists = Array.from({ length: 10 }, () => randomUUID());
  const at = new Date().toISOString();
  await fetch(`${API}/sync/push`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      deviceId: randomUUID(), lastPulledAt: null, clientTimestamp: at,
      operations: [
        { operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create", entityId: ws, baseVersion: 0, base: null, clientTimestamp: at, payload: { name: "Fondo", color: "teal" } },
        ...lists.map((id) => ({ operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create", entityId: id, baseVersion: 0, base: null, clientTimestamp: at, payload: { workspaceId: ws, folderId: null, title: `Lista ${id.slice(0, 4)}`, kind: "tasks" } })),
        { operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update", entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30", baseVersion: 0, base: null, clientTimestamp: at,
          payload: { layout: [
            ...lists.slice(0, 4).map((id, i) => ({ id: `list:${id}`, kind: "recent_lists", x: (i % 2) * 2, y: Math.floor(i / 2), w: 2, h: 1, page: 0, pinned: true, settings: { listId: id, title: `Lista ${i + 1}`, kind: "tasks" } })),
            ...lists.slice(4).map((id, i) => ({ id: `list:${id}`, kind: "recent_lists", x: (i % 2) * 2, y: Math.floor(i / 2), w: 2, h: 1, page: 1, pinned: true, settings: { listId: id, title: `Lista ${i + 5}`, kind: "tasks" } })),
          ] } },
      ],
    }),
  });

  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await tab.goto(APP);
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    await sleep(700);
    ready = await tab.evaluate(`!!document.querySelector('[data-testid="panel-grid"]')`).catch(() => false);
  }
  if (!ready) throw new Error("el panel no aparecio");
  await sleep(1500);

  // What is actually under the point the swipe starts on, and how big is it?
  const anatomy = await tab.evaluate(`
    (() => {
      const bg = document.querySelector('[data-testid="panel-background"]');
      return {
        editing: !!bg,
        bgBox: bg ? (r => ({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }))(bg.getBoundingClientRect()) : null,
        pointerEvents: bg ? getComputedStyle(bg).pointerEvents : null,
        zIndex: bg ? getComputedStyle(bg).zIndex : null,
        trackChildren: [...document.querySelector('[data-testid="panel-grid"]').children].map(c => ({
          testid: c.getAttribute('data-testid') || c.tagName,
          pe: getComputedStyle(c).pointerEvents,
        })),
      };
    })()
  `);
  console.log("FUERA de editar:", JSON.stringify(anatomy, null, 2));

  // Enter the arranging mode.
  await tab.evaluate(`
    (() => {
      const clean = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find((e) => clean(e.getAttribute("aria-label") || "").includes("Colocar las tarjetas"));
      el.click();
      return true;
    })()
  `);
  await sleep(1500);

  const anatomy2 = await tab.evaluate(`
    (() => {
      const bg = document.querySelector('[data-testid="panel-background"]');
      const r = bg.getBoundingClientRect();
      const y = 351;
      const hit = document.elementFromPoint(348, y);
      return {
        editing: !!bg,
        bgBox: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
        pointerEvents: getComputedStyle(bg).pointerEvents,
        hitAt348_351: { tag: hit?.tagName, testid: hit?.getAttribute?.('data-testid'), insideBg: bg.contains(hit) },
        trackChildren: [...document.querySelector('[data-testid="panel-grid"]').children].map(c => ({
          testid: c.getAttribute('data-testid') || c.tagName,
          pe: getComputedStyle(c).pointerEvents,
        })),
      };
    })()
  `);
  console.log("\nDENTRO de editar:", JSON.stringify(anatomy2, null, 2));

  // Now the swipe, with the finger held down, sampling the track as it goes.
  const from = { x: 348, y: 351 };
  const to = { x: 80, y: 351 };
  console.log(`\nswipe de ${from.x} a ${to.x}`);
  await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
  const samples = [];
  for (let i = 1; i <= 16; i += 1) {
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(from.x + ((to.x - from.x) * i) / 16, from.y),
    });
    await sleep(12);
    samples.push(await tab.evaluate(shift));
  }
  console.log("  shift con el dedo abajo:", samples.join(" "));
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1000);
  const after = await tab.evaluate(`
    (() => ({
      here: [...document.querySelectorAll('[data-testid^="panel-page-"]')]
        .findIndex((d) => d.getAttribute("data-testid") === "panel-page-current"),
    }))()
  `);
  console.log("  pagina final:", after.here, "| shift final:", await tab.evaluate(shift));
} catch (error) {
  console.log("fallo:", error.message);
} finally {
  tab?.close();
  await chrome.kill();
}
