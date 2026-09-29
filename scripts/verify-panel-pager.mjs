import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * The pager: the page you are going to comes in with the gesture.
 *
 * The report was that every swipe looks the same however it is made. It did: the
 * board was one screen and a translation, so the cards slid out, the next screen
 * appeared *already in place* under them, and the only thing that moved was the
 * screen going away. A pager that cannot be taken halfway and put back, and shows
 * nothing of where it is going, is a button with extra steps.
 *
 * What has to be true, and none of it can be checked from a screenshot:
 *
 *  - while the finger is down, the *next* screen is on screen, partly in, coming
 *    from the side the finger is going. A page that is not there during the
 *    gesture cannot be brought in by it.
 *  - the page under the finger moves *with* the finger, one to one, and not by
 *    some other amount.
 *  - letting go finishes the gesture from where it was let go, in the direction it
 *    was going: a small flick from far away still lands on the next page, and a
 *    small drag from close does not.
 *  - and it is reversible: the same gesture the other way goes back, which is the
 *    part a "same animation every time" panel cannot do at all.
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

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);

async function account() {
  try {
    const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
    if ((await api("/auth/me", { token: saved.accessToken })).status === 200) return saved;
  } catch {
    /* none yet */
  }
  const email = `pager-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  const before = await readLog();
  await api("/auth/register", {
    method: "POST",
    body: { email, password, displayName: "Pager", locale: "es", acceptedTermsAt: new Date().toISOString(), device: { label: "pager", platform: "web" } },
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
  const session = (await api("/auth/login", { method: "POST", body: { email, password, device: { label: "pager", platform: "web" } } })).body.data.session;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];

/** The factor the panel divides by when a finger pulls past the end. */
const EDGE_DIVISOR = 3.4;

/**
 * A swipe that reports where the board was while the finger was down.
 *
 * `hold` is the part that matters: it is the time the finger is still on the board
 * after it has stopped moving, which is exactly the state a screenshot of a pager
 * has to catch. A script that swipes and immediately measures has measured the
 * animation's first frame at best.
 */
async function swipeAndWatch(tab, from, to, { steps = 12, step = 12, hold = 500, shotAt = 0, shotPath = null } = {}) {
  await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
  for (let i = 1; i <= steps; i += 1) {
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps),
    });
    await sleep(step);
    // Halfway through, with the finger still down. A picture of the middle of a
    // gesture is the only thing that shows whether the page coming in is really
    // coming in or only being switched on at the end.
    if (shotPath && i === Math.round(steps * shotAt)) await tab.screenshot(shotPath);
  }
  // Where things are with the finger still down.
  const held = await board(tab);
  await sleep(hold);
  const stillHeld = await board(tab);
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return { held, stillHeld };
}

/** The screens on the track and where each of them is, from the DOM. */
const board = (tab) =>
  tab.evaluate(`
    (() => {
      const track = document.querySelector('[data-testid="panel-grid"]');
      const matrix = getComputedStyle(track).transform;
      let shift = 0;
      if (matrix && matrix !== 'none') {
        // A 2D matrix is "matrix(a, b, c, d, tx, ty)".
        shift = parseFloat(matrix.split(',')[4]) || 0;
      }
      const rect = track.getBoundingClientRect();
      const screens = [...track.querySelectorAll('[data-testid^="panel-screen-"]')].map(s => {
        const r = s.getBoundingClientRect();
        const inner = [...s.querySelectorAll('div')].find(d => d.offsetWidth > 0);
        return {
          slot: Number(s.getAttribute('data-testid').replace('panel-screen-', '')),
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
          text: ((inner ?? s).innerText || '').split('\\n')[0],
        };
      });
      const all = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
      return {
        shift: Math.round(shift),
        width: Math.round(rect.width),
        viewport: window.innerWidth,
        screens,
        visible: screens.filter(s => s.right > rect.left + 2 && s.left < rect.right - 2),
        here: all.findIndex(d => d.getAttribute('data-testid') === 'panel-page-current'),
      };
    })()
  `);

/**
 * Where the track rests when screen `here` is the one being looked at.
 *
 * The track does not rest at zero: it is as wide as every screen and the screen
 * being looked at sits at its own slot on it, so resting on screen two is a
 * translation of minus one width. "Square" means "on its slot" and not "at the
 * origin", and a check that forgets this fails on every page but the first.
 *
 * The slot is the width of a screen, measured, and not the width of the track
 * divided by the number of screens *painted*: only the current screen and its two
 * neighbours are ever mounted, so that division is a number that changes as the
 * pager moves and quietly turns every measurement into a wrong one.
 */
const slotOf = (b) => b.screens[0]?.w ?? b.width / Math.max(b.screens.length, 1);
const restingOf = (b) => -(b.here * slotOf(b));

const chrome = await launchChrome();
let tab;
try {
  const session = await account();
  const CLIENT = "verify-pager";
  const ws = randomUUID();
  const lists = Array.from({ length: 12 }, () => randomUUID());
  const at = new Date().toISOString();
  const pageOf = (i) => Math.floor(i / 4);

  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: at,
      operations: [
        { operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create", entityId: ws, baseVersion: 0, base: null, clientTimestamp: at, payload: { name: "Pager", color: "teal" } },
        ...lists.map((id, i) => ({
          operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create", entityId: id,
          baseVersion: 0, base: null, clientTimestamp: at,
          payload: { workspaceId: ws, folderId: null, title: `P${pageOf(i) + 1}-${(i % 4) + 1}`, kind: "tasks" },
        })),
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30", baseVersion: 0, base: null,
          clientTimestamp: at,
          payload: {
            // Four cards a screen, three screens, and the name of each card says
            // which screen it is on. So a card that is half in from the right is
            // identifiable by its text and not by counting.
            layout: lists.map((id, i) => ({
              id: `list:${id}`, kind: "recent_lists",
              x: (i % 2) * 2, y: Math.floor((i % 4) / 2), w: 2, h: 1, page: pageOf(i), pinned: true,
              settings: { listId: id, title: `P${pageOf(i) + 1}-${(i % 4) + 1}`, kind: "tasks" },
            })),
          },
        },
      ],
    },
  });
  // The status of the request is not the status of the operations. A push of
  // twenty rejected operations is a 200 with twenty rejections in it, and a check
  // that only looks at the code says the seed worked and then wonders why the
  // panel is empty.
  const results = pushed.body?.data?.results ?? [];
  const rejected = results.filter((r) => r.status !== "applied");
  check(
    "la siembra se aplica, no solo se acepta",
    pushed.status === 200 && results.length > 0 && rejected.length === 0,
    `${results.length} operaciones, ${results.map((r) => r.status).join(", ") || "ninguna"}${rejected.length ? ` — RECHAZADAS: ${JSON.stringify(rejected.slice(0, 2))}` : ""}`,
  );

  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
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
  await sleep(1500);

  const start = await board(tab);
  check("hay tres pantallas", start.here === 0 && start.screens.length >= 2, `${start.screens.length} pintadas, en la ${start.here + 1}`);
  check("el track es mas ancho que la pantalla", start.width > start.viewport, `track ${start.width}, ventana ${start.viewport}`);

  // The *window*, not the track. The track is as wide as every screen side by
  // side, so its box is twice the screen and a swipe laid out on it puts the finger
  // outside the window — where a touch does nothing, which looks exactly like a
  // pager that is not following the finger.
  const boardBox = await tab.evaluate(`
    (() => {
      const r = document.querySelector('[data-testid="panel-grid"]').getBoundingClientRect();
      const screens = [...document.querySelectorAll('[data-testid^="panel-screen-"]')];
      const slot = screens.length ? screens[0].getBoundingClientRect().width : r.width / 2;
      return {
        left: r.left, top: r.top, height: r.height,
        // One screen's width, which is the pitch of the track and the distance a
        // swipe has to travel to change page.
        width: Math.round(slot),
        window: window.innerWidth,
      };
    })()
  `);
  note(`la pantalla del panel mide ${boardBox.width}px de ancho, ventana ${boardBox.window}px`);
  await tab.screenshot("/private/tmp/orbit/pager/1-reposo.png");

  // The cards of screen one fill the top half; the free board below them is where
  // the swipe starts, so the gesture is never mistaken for a drag of a card.
  const freeY = boardBox.top + boardBox.height * 0.82;
  const y = Math.round(freeY);

  // ------------------------------------------------------------------ the gesture
  const from = { x: Math.round(boardBox.left + boardBox.width - 16), y };
  const to = { x: Math.round(boardBox.left + 16), y };
  const travel = from.x - to.x;

  const { held, stillHeld } = await swipeAndWatch(tab, from, to, {
    hold: 60,
    shotAt: 0.5,
    shotPath: "/private/tmp/orbit/pager/2-mitad-del-gesto.png",
  });
  // The picture of the moment the report is about: the finger still down, the next
  // screen half in from the side it is going. Every number above can be right and
  // this still be wrong.
  await tab.screenshot("/private/tmp/orbit/pager/2-a-medias.png");
  await tab.screenshot("/private/tmp/orbit/pager/3-a-medias-soltado.png");
  // `held` is the first frame after the last move; `stillHeld` is the same finger,
  // a few frames later, and that is the honest answer to "does the board follow
  // the finger" — the first frame on the web is always one frame behind.
  const rest = restingOf(start);
  const movedWith = stillHeld.shift - rest;
  note(`con el dedo quieto a ${travel}px: desplazamiento ${stillHeld.shift} (sitio ${rest}), se ve ${stillHeld.visible.map((v) => `"${v.text}"`).join(", ")}`);

  check("la pantalla se mueve con el dedo, no de golpe", Math.abs(movedWith) > 20, `desplazamiento ${movedWith}px con el dedo a ${travel}px`);

  /*
   * Proportional to the finger, and not point for point — and the difference is
   * worth naming rather than widening a tolerance to hide. The gesture discards the
   * first fourteen points while it decides whether this is a swipe at all
   * (`activeOffsetX`), and a sample read out of a browser is one frame old. So the
   * board is a little behind the finger and never ahead of it, and the size of the
   * gap is the threshold plus a frame rather than a mystery.
   */
  const followed = Math.abs(movedWith);
  check(
    "el desplazamiento sigue al dedo",
    followed >= travel * 0.8 && followed <= travel,
    `dedo ${travel}px, tablero ${Math.round(followed)}px (umbral de activacion 14px mas un fotograma)`,
  );

  // And here is the thing that was reported: the *next* screen has to be there.
  const incoming = stillHeld.visible.filter((s) => s.left > start.visible[0].left + 8);
  check(
    "la pantalla siguiente entra con el gesto, no aparece despues",
    incoming.length > 0,
    `entrando: ${incoming.map((v) => `"${v.text}" en x=${v.left}..${v.right}`).join(", ") || "nada"}`,
  );
  check(
    "y entra por el lado al que va el dedo",
    incoming.length > 0 && incoming[0].left > 0,
    `la entrante empieza en x=${incoming[0]?.left}`,
  );

  // Let go: it must finish the journey from where it was, not start over.
  await sleep(900);
  const after = await board(tab);
  check("al soltar llega a la pagina siguiente", after.here === 1, `en la ${after.here + 1}, viendo "${after.visible[0]?.text}"`);
  check(
    "y se queda cuadrada en esa pagina",
    Math.abs(after.shift - restingOf(after)) < 2,
    `desplazamiento ${after.shift}px, su sitio es ${restingOf(after)}px`,
  );
  note(`pantalla 2 ve "${after.visible.map((s) => s.text).join(", ")}"`);

  // ----------------------------------------------------------------- y al revés
  const backFrom = { x: Math.round(boardBox.left + 16), y };
  const backTo = { x: Math.round(boardBox.left + boardBox.width - 16), y };
  const { stillHeld: heldBack } = await swipeAndWatch(tab, backFrom, backTo, { hold: 60 });
  await tab.screenshot("/private/tmp/orbit/pager/4-al-reves-a-medias.png");
  const restBack = restingOf(after);
  const incomingBack = heldBack.visible.filter((v) => v.right < start.visible[0].right - 8);
  check(
    "el gesto al reves trae la pantalla anterior",
    incomingBack.length > 0,
    `entrando: ${incomingBack.map((v) => `"${v.text}"`).join(", ") || "nada"}`,
  );
  check(
    "y tambien se mueve con el dedo",
    heldBack.shift - restBack > 20,
    `desplazamiento ${Math.round(heldBack.shift - restBack)}px`,
  );
  await sleep(900);
  const back = await board(tab);
  check("vuelve a la primera", back.here === 0, `en la ${back.here + 1}`);

  // ------------------------------------------------- un flick corto cuenta igual
  // A short fast flick from near the middle. The old panel had a fixed distance
  // *or* a fixed speed, and a flick is the case where only the speed is there.
  const flickFrom = { x: Math.round(boardBox.left + boardBox.width * 0.5), y };
  const flickTo = { x: Math.round(boardBox.left + boardBox.width * 0.5 - 70), y };
  await swipeAndWatch(tab, flickFrom, flickTo, { steps: 6, step: 4, hold: 20 });
  await sleep(900);
  const flicked = await board(tab);
  check("un flick corto y rapido tambien cambia de pagina", flicked.here === 1, `en la ${flicked.here + 1} tras ${flickFrom.x - flickTo.x}px rapidos`);

  // And a slow short drag from close does not, which is somebody thinking again.
  const slowFrom = { x: Math.round(boardBox.left + boardBox.width * 0.5), y };
  const slowTo = { x: Math.round(boardBox.left + boardBox.width * 0.5 - 34), y };
  await swipeAndWatch(tab, slowFrom, slowTo, { steps: 14, step: 55, hold: 400 });
  await sleep(700);
  const afterSlow = await board(tab);
  check(
    "un arrastre corto y lento no cambia de pagina",
    afterSlow.here === 1,
    `sigue en la ${afterSlow.here + 1} tras ${slowFrom.x - slowTo.x}px lentos`,
  );
  check(
    "y vuelve a su sitio",
    Math.abs(afterSlow.shift - restingOf(afterSlow)) < 2,
    `desplazamiento ${afterSlow.shift}px, su sitio es ${restingOf(afterSlow)}px`,
  );

  // ------------------------------------------------------- el final de la linea
  // Walk to the last screen first. The rubber band only exists at the end of the
  // track, and a check that runs it from the middle is a check of nothing — the
  // same mistake a "swipe works" check makes when it only ever goes one way.
  let here = (await board(tab)).here;
  for (let i = 0; i < 6 && here < 2; i += 1) {
    const at = (await board(tab)).here;
    await swipeAndWatch(
      tab,
      { x: Math.round(boardBox.left + boardBox.width - 16), y },
      { x: Math.round(boardBox.left + 16), y },
      { steps: 8, step: 8, hold: 20 },
    );
    await sleep(700);
    here = (await board(tab)).here;
    if (here === at) break;
  }
  const end = await board(tab);
  check("llega a la ultima pantalla", end.here === 2, `en la ${end.here + 1} de 3`);

  // Now pull on it. A screen that does not exist must not come into view, and the
  // track has to say no more slowly than the finger says no.
  // Towards the screen that does not exist. Pulling the other way is not a test of
  // resistance at all: on the last screen that is a perfectly ordinary swipe back,
  // and a check that calls it "the end" is checking the wrong thing.
  const atEnd = { x: Math.round(boardBox.left + boardBox.width - 16), y };
  const past = { x: Math.round(boardBox.left + 16), y };
  const asked = Math.abs(atEnd.x - past.x);
  const { stillHeld: heldEnd } = await swipeAndWatch(tab, atEnd, past, { hold: 60 });
  await tab.screenshot("/private/tmp/orbit/pager/5-final-resistido.png");
  const moved = Math.abs(heldEnd.shift - restingOf(end));
  note(`en el final: pide ${asked}px, se mueve ${Math.round(moved)}px (un tercio, ${Math.round(asked / EDGE_DIVISOR)})`);
  check(
    "en la ultima pantalla el gesto no inventa otra",
    heldEnd.screens.length === end.screens.length,
    `${heldEnd.screens.length} pintadas, las mismas ${end.screens.length}`,
  );
  check(
    "y se resiste en vez de irse libre",
    heldEnd.shift < restingOf(end) && moved < asked / 2,
    `pide ${asked}px y se mueve ${Math.round(moved)}px`,
  );
  await sleep(800);
  const settledEnd = await board(tab);
  check(
    "vuelve a la ultima pagina",
    settledEnd.here === end.here && Math.abs(settledEnd.shift - restingOf(settledEnd)) < 2,
    `en la ${settledEnd.here + 1}, desplazamiento ${settledEnd.shift}px`,
  );

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} COMPROBACIONES FALLIDAS`);
} catch (error) {
  console.log("fallo:", error.message);
  failures += 1;
} finally {
  tab?.close();
  await chrome.kill();
}
