import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * What sizes the corner actually goes through.
 *
 * The complaint is that it jumps from one to four and back, which a screenshot
 * cannot show and a test of `snapSize` cannot either: `snapSize` is a pure
 * function and it is being asked the wrong question, because what matters is the
 * sequence of sizes the *gesture* produces as a finger travels. A corner that
 * passes through 2x2 on its way to 4x4 and one that skips it are the same size at
 * the end and completely different to hold.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const EMAIL_LOG = process.env.EMAIL_LOG ?? logOfTheApi();

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
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SESSION_FILE = "/private/tmp/orbit-size-session.json";

async function account() {
  try {
    const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
    if ((await api("/auth/me", { token: saved.accessToken })).status === 200) return saved;
  } catch {
    /* none yet */
  }
  const email = `size-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  const before = await readLog();
  await api("/auth/register", {
    method: "POST",
    body: {
      email, password, displayName: "Size", locale: "es",
      acceptedTermsAt: new Date().toISOString(),
      device: { label: "size", platform: "web" },
    },
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
  const session = (
    await api("/auth/login", {
      method: "POST",
      body: { email, password, device: { label: "size", platform: "web" } },
    })
  ).body.data.session;
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

const chrome = await launchChrome();
let tab;

try {
  const session = await account();
  const CLIENT = "size-measure";
  const ws = randomUUID();
  const list = randomUUID();

  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: new Date().toISOString(),
      operations: [
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create",
          entityId: ws, baseVersion: 0, base: null, clientTimestamp: new Date().toISOString(),
          payload: { name: "Tamaños", color: "teal" },
        },
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create",
          entityId: list, baseVersion: 0, base: null, clientTimestamp: new Date().toISOString(),
          payload: { workspaceId: ws, folderId: null, title: "Medida", kind: "tasks" },
        },
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30",
          baseVersion: 0, base: null, clientTimestamp: new Date().toISOString(),
          payload: {
            // A full board, and the first card is the one that gets resized.
            //
            // With one card alone there is always room, so every size is allowed
            // and the question cannot arise. With the board full, growing a card
            // needs the space its neighbours are standing in — which is where a
            // size can be refused, and a refused size is one the finger passes
            // straight over on its way to the next one that fits.
            layout: Array.from({ length: 6 }, (_, i) => ({
              id: i === 0 ? `list:${list}` : `relleno:${i}`,
              kind: "recent_lists",
              x: (i % 2) * 2,
              y: Math.floor(i / 2) * 2,
              w: 2,
              h: 2,
              page: 0,
              pinned: true,
              settings: { listId: i === 0 ? list : `x${i}`, title: i === 0 ? "Medida" : `Relleno ${i}` },
            })),
          },
        },
      ],
    },
  });
  console.log("siembra:", pushed.status, JSON.stringify(pushed.body?.data?.results?.map((r) => r.status)));

  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
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
  await sleep(1000);

  await tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
      el.click();
      return true;
    })()
  `);
  await sleep(1500);

  const measure = `
    (() => {
      const panel = document.querySelector('[data-testid="panel-grid"]');
      const c = [...panel.children][0];
      const inner = [...c.querySelectorAll('div')].find(d => d.getBoundingClientRect().width > 0);
      const b = (inner ?? c).getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      return {
        w: Math.round(b.width), h: Math.round(b.height),
        left: Math.round(b.left), top: Math.round(b.top),
        panelW: Math.round(pr.width), panelH: Math.round(pr.height),
      };
    })()
  `;

  const handleOf = `
    (() => {
      const h = [...document.querySelectorAll('[aria-label]')]
        .find(e => (e.getAttribute('aria-label') || '').toLowerCase().includes('cambiar el tamaño'));
      const r = h.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()
  `;

  const before = await tab.evaluate(measure);
  const handle = await tab.evaluate(handleOf);
  const cellW = (before.panelW - 3 * 8) / 4;
  const cellH = (before.panelH - 5 * 8) / 6;
  console.log("tablero:", before.panelW, "x", before.panelH, " celda:", cellW.toFixed(1), "x", cellH.toFixed(1));
  console.log("tarjeta:", before.w, "x", before.h, " esquina en", JSON.stringify(handle));

  // The corner travelling out to the right, one small step at a time, and the
  // same distance downwards, so the card grows in both directions together — which
  // is how a corner is actually pulled.
  const dxTotal = Math.round(cellW * 3 + 8 * 3);
  const dyTotal = Math.round(cellH * 3 + 8 * 3);
  const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];
  const steps = 30;

  await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(handle.x, handle.y) });
  const seen = [];
  for (let i = 1; i <= steps; i += 1) {
    const x = handle.x + Math.round((dxTotal * i) / steps);
    const y = handle.y + Math.round((dyTotal * i) / steps);
    await tab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
    await sleep(70);
    const m = await tab.evaluate(measure);
    seen.push({ i, x, y, w: m.w, h: m.h });
  }
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(600);

  const sizes = [];
  for (const s of seen) {
    const size = `${s.w}x${s.h}`;
    if (sizes[sizes.length - 1] !== size) sizes.push(size);
  }
  console.log("\ntamanos que ha ido tomando, en orden:");
  for (const size of sizes) console.log("  ", size);
  console.log("\ndetalle de cada paso:");
  for (const s of seen) {
    console.log(`  paso ${String(s.i).padStart(2)}  dedo ${s.x},${s.y}  ->  ${s.w}x${s.h}`);
  }

  // And back down, because a corner that only works one way is half a control.
  const after = await tab.evaluate(measure);
  const h2 = await tab.evaluate(handleOf);
  await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(h2.x, h2.y) });
  const back = [];
  for (let i = steps - 1; i >= 0; i -= 1) {
    const x = h2.x - Math.round((dxTotal * i) / steps);
    const y = h2.y - Math.round((dyTotal * i) / steps);
    await tab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
    await sleep(70);
    const m = await tab.evaluate(measure);
    const size = `${m.w}x${m.h}`;
    if (back[back.length - 1] !== size) back.push(size);
  }
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  console.log("\nvuelta hacia el tamano pequeno:", JSON.stringify(back));
  console.log("tarjeta al empezar:", `${after.w}x${after.h}`);
} catch (error) {
  console.log("fallo:", error.message);
} finally {
  tab?.close();
  await chrome.kill();
}
