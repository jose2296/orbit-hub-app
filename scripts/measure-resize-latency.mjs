import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * The drawn size against the clock, at frame rate.
 *
 * `sizeFromDrag` is pure and stepping, which is why a test of it proves nothing
 * about the symptom. The suspicion here is a *timing* one: the corner gesture
 * runs on the UI thread but every update crosses to the JavaScript thread with
 * `runOnJS`, and the JavaScript thread re-places the whole screen for each one.
 * If it cannot keep up, the finger travels several sizes while the card is still
 * drawn at the old one, and then it catches up and paints a size the finger has
 * been past for a while. From the hand that is one movement from one to four.
 *
 * So: log the card's box inside a rAF loop, and drive the corner from CDP. The
 * two timelines are then comparable, and the question is whether the drawn size
 * ever skips one.
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
    body: { email, password, displayName: "Size", locale: "es", acceptedTermsAt: new Date().toISOString(), device: { label: "size", platform: "web" } },
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
  const session = (await api("/auth/login", { method: "POST", body: { email, password, device: { label: "size", platform: "web" } } })).body.data.session;
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

const chrome = await launchChrome();
let tab;
try {
  const session = await account();
  const CLIENT = "size-latency";
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
        { operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create", entityId: ws, baseVersion: 0, base: null, clientTimestamp: new Date().toISOString(), payload: { name: "Tamaños", color: "teal" } },
        { operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create", entityId: list, baseVersion: 0, base: null, clientTimestamp: new Date().toISOString(), payload: { workspaceId: ws, folderId: null, title: "Medida", kind: "tasks" } },
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30", baseVersion: 0, base: null,
          clientTimestamp: new Date().toISOString(),
          payload: {
            // One card alone: with neighbours in the way the frame cost changes,
            // and this run is about the delay, not about the packing.
            layout: [
              { id: `list:${list}`, kind: "recent_lists", x: 0, y: 0, w: 1, h: 1, page: 0, pinned: true, settings: { listId: list, title: "Medida", kind: "tasks" } },
            ],
          },
        },
      ],
    },
  });
  console.log("siembra:", pushed.status);

  /**
   * Puts the card at an exact size, through the API and not through the control.
   *
   * Dragging the corner back to where it started was the obvious way and it is the
   * wrong one: it is the thing under test. Worse, it does not work — a corner
   * dragged to the left does not shrink the card at all, which is the second half
   * of the complaint and had been assumed working this whole time. So the size a
   * measurement starts from is written to the store instead, and the drag is only
   * ever measured, never used to set things up.
   */
  const seedWidth = async (w) => {
    const r = await api("/sync/push", {
      method: "POST",
      token: session.accessToken,
      body: {
        deviceId: randomUUID(),
        lastPulledAt: null,
        clientTimestamp: new Date().toISOString(),
        operations: [
          {
            operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
            entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30", baseVersion: 0, base: null,
            clientTimestamp: new Date().toISOString(),
            payload: {
              layout: [
                { id: `list:${list}`, kind: "recent_lists", x: 0, y: 0, w, h: 1, page: 0, pinned: true, settings: { listId: list, title: "Medida", kind: "tasks" } },
              ],
            },
          },
        ],
      },
    });
    if (r.status !== 200) throw new Error(`no he podido sembrar ${w} columnas: ${r.status}`);
  };

  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);

  /**
   * The shape of the board, forced rather than whatever Chrome happened to open.
   *
   * The board is a fraction of the window, so the cell — and with it how far the
   * finger has to travel per size — depends entirely on the shape. A window a
   * person would never use gives a cell of 175 by 48, and a one row card is then
   * 48 points tall with a 44 point corner in it. Both are worth measuring and
   * neither is worth leaving to chance.
   */
  // `mobile: false` on purpose. With it on, the override makes the page a phone
  // with its own user agent expectations and the app never gets as far as the
  // panel, so a shape of window is emulated without pretending to be a different
  // device. What is being varied is the shape of the board, not the platform.
  const SHAPES = {
    phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: false },
    short: { width: 724, height: 469, deviceScaleFactor: 1, mobile: false },
  };
  const shape = SHAPES[process.env.VIEW ?? ""];
  if (shape) {
    await tab.send("Emulation.setDeviceMetricsOverride", shape);
    console.log(`ventana forzada a ${shape.width}x${shape.height}`);
  } else {
    console.log("ventana: la que se abra");
  }

  // Each measurement starts from the same card: a reload and a fresh edit mode
  // for every case, because a card that is already four columns wide cannot show
  // what a drag does to a card that is one column wide.
  const openPanel = async () => {
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
  };

  await openPanel();

  const board = await tab.evaluate(`
    (() => {
      const p = document.querySelector('[data-testid="panel-grid"]').getBoundingClientRect();
      return { w: Math.round(p.width), h: Math.round(p.height) };
    })()
  `);
  const cellW = (board.w - 3 * 8) / 4;
  const cellH = (board.h - 5 * 8) / 6;
  console.log(`tablero ${board.w}x${board.h}  celda ${cellW.toFixed(0)}x${cellH.toFixed(0)}`);

  // The recorder. Every frame, the box of the card, stamped. It runs in the page
  // so the samples are at the display's frame rate and not at the rate CDP
  // answers a round trip.
  //
  // `offsetWidth` and not `getBoundingClientRect`, because the card leans while
  // it waits to be moved and a rotation of half a degree on a wide card adds six
  // points to its *bounding box*. Measuring the transformed box made the height
  // appear to change on its own, and the first run of this script reported a card
  // growing three rows in a frame that had nothing to do with the finger.
  const startRecorder = () =>
    tab.evaluate(`
      (() => {
        window.__log = [];
        window.__t0 = performance.now();
        window.__rec = true;
        const panel = document.querySelector('[data-testid="panel-grid"]');
        const read = () => {
          if (!window.__rec) return;
          const c = panel.children[0];
          const inner = [...c.querySelectorAll('div')].find(d => d.offsetWidth > 0);
          const el = inner ?? c;
          window.__log.push({
            t: Math.round(performance.now() - window.__t0),
            w: Math.round(el.offsetWidth),
            h: Math.round(el.offsetHeight),
          });
          requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
        return true;
      })()
    `);

  // A swipe at a speed a thumb actually moves. Several of them, because the answer
  // is supposed to be about how fast the sizes stop being visible, and one speed
  // cannot show that: a deliberate drag and a flick are the same control used in
  // two different ways, and the second is the one that was reported.
  const dx = Math.round(cellW * 3 + 24);
  const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];

  const swipe = async (pxPerSecond, direction) => {
    const total = Math.round((dx / pxPerSecond) * 1000);
    // The handle is read here and not once at the top: the card is a different
    // size at the start of every measurement, and its corner is somewhere else.
    const handle = await readHandle();
    await startRecorder();
    const finger = [];
    const started = Date.now();
    await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(handle.x, handle.y) });
    while (Date.now() - started < total) {
      const k = Math.min(1, (Date.now() - started) / total);
      const x = handle.x + Math.round(dx * k) * direction;
      finger.push({ t: Date.now() - started, x: (x - handle.x) });
      await tab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, handle.y) });
      await sleep(8);
    }
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(400);
    await tab.evaluate(`window.__rec = false`);
    return { total, log: await tab.evaluate(`window.__log`), finger };
  };

  const readHandle = () =>
    tab.evaluate(`
      (() => {
        const h = [...document.querySelectorAll('[aria-label]')]
          .find(e => (e.getAttribute('aria-label') || '').toLowerCase().includes('cambiar el tamaño'));
        const r = h.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      })()
    `);

  const readWidth = () =>
    tab.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="panel-grid"]');
        const inner = [...panel.children[0].querySelectorAll('div')].find(d => d.offsetWidth > 0);
        return Math.round((inner ?? panel.children[0]).offsetWidth);
      })()
    `);

  /**
   * Every case: a speed and a direction.
   *
   * Both, because one of the two is the bug. Growing was measured all along and
   * looked fine; shrinking by dragging the corner back did nothing at all, and a
   * control that only works in one direction is not a control.
   */
  const cases = [
    { speed: 600, direction: 1, from: 1 },
    { speed: 1600, direction: 1, from: 1 },
    { speed: 2600, direction: 1, from: 1 },
    { speed: 600, direction: -1, from: 4 },
    { speed: 1600, direction: -1, from: 4 },
  ];

  for (const { speed, direction, from } of cases) {
    await seedWidth(from);
    await openPanel();
    const start = `${await readWidth()} de ancho`;
    const { total, log, finger } = await swipe(speed, direction);
    const span = log.length ? log[log.length - 1].t - log[0].t : 0;
    const frames = span ? (1000 * (log.length - 1)) / span : 0;
    const step = cellW + 8;
    // Travel to the first boundary: half a step, because `round` puts it halfway
    // to the next size. Every later one costs a whole step.
    const boundary = step / 2;
    console.log(`\n=== ${direction > 0 ? "creciendo" : "encogiendo"}, ${speed} puntos por segundo: ${dx}px en ${total}ms, ${log.length} muestras a ${frames.toFixed(0)} fps`);
    console.log(`    empieza en ${start}; el primer cambio pide ${boundary.toFixed(0)}px y cada uno de los siguientes ${step.toFixed(0)}px, con el dedo a ${speed}px/s`);

    // The two timelines side by side, because the question is not when the card
    // changed but how much the finger had travelled when it did.
    const changes = [];
    for (const s of log) {
      const cols = Math.round((s.w + 8) / step);
      const rows = Math.round((s.h + 8) / (cellH + 8));
      const last = changes[changes.length - 1];
      if (last && last.cols === cols && last.rows === rows) last.until = s.t;
      else changes.push({ cols, rows, size: `${cols}x${rows}`, from: s.t, until: s.t });
    }
    for (const c of changes) {
      const at = finger.findIndex((f) => f.t >= c.from);
      const travelled = finger.length ? finger[at === -1 ? finger.length - 1 : at].x : 0;
      console.log(
        `  ${c.size.padEnd(7)} desde ${String(c.from).padStart(4)}ms  durante ${String(c.until - c.from).padStart(4)}ms  el dedo iba por ${travelled}px`,
      );
    }

    const cols = changes.map((c) => c.cols);
    const skipped = cols.filter((w, i) => i > 0 && Math.abs(w - cols[i - 1]) > 1).length;
    const invisible = changes.filter((c) => c.until - c.from < 25).length;
    console.log(`  cambios de tamano: ${changes.length - 1}, de los cuales saltan uno o mas: ${skipped}`);
    console.log(`  tamanos en pantalla menos de 25ms: ${invisible} de ${changes.length}`);
  }
} catch (error) {
  console.log("fallo:", error.message);
} finally {
  tab?.close();
  await chrome.kill();
}
