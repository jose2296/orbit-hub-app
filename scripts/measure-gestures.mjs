import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * What the panel feels like, measured rather than judged.
 *
 * A resize that lags the finger by 40 points *looks* like a card fighting the
 * hand, and a drag where nothing else moves until you let go *looks* broken. Both
 * are true in the finished app and neither shows up in a screenshot, so this
 * drives a real pointer and samples the geometry frame by frame.
 *
 * What it reports, per gesture:
 *   - where the pointer is, and where the card is, at each step: the gap is lag
 *   - whether the other cards move during the drag, or only after it
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";

/**
 * Where the API writes the verification mail to, found rather than configured.
 *
 * The API prints the mail to its own output instead of sending it, so the account
 * is verified by reading the token out of the log the process writes. That log is
 * wherever the running process's stdout happens to point, and a path hard-coded
 * here goes stale the moment the API is restarted with a different one — which is
 * how a script that used to work starts failing with "the mail never came" while
 * the API is sitting right there, perfectly healthy, logging to a new file.
 *
 * So it is read off the process that is actually listening.
 */
const EMAIL_LOG =
  process.env.EMAIL_LOG ?? logOfTheApi();

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

const readLog = async () => {
  try {
    return await readFile(EMAIL_LOG, "utf8");
  } catch {
    return "";
  }
};

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
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const chrome = await launchChrome();
let tab;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One account, reused.
 *
 * `POST /auth/register` is rate limited to five per window, and a window is
 * minutes long, so a script that registers on every run locks itself out after
 * the fifth and then fails with a message that has nothing to do with what it was
 * measuring. The session is written next to the script and reused; delete the
 * file to start over.
 */
const SESSION_FILE = "/private/tmp/orbit-verify-session.json";

async function account() {
  try {
    const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
    // Checked, not trusted: the account may have been wiped with the data dir.
    const me = await api("/auth/me", { token: saved.accessToken });
    if (me.status === 200) return saved;
  } catch {
    // No session yet, or unreadable: make one.
  }

  const email = `feel-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  const logBefore = await readLog();
  const registered = await api("/auth/register", {
    method: "POST",
    body: {
      email, password, displayName: "Feel", locale: "es",
      acceptedTermsAt: new Date().toISOString(),
      device: { label: "feel", platform: "web" },
    },
  });
  if (registered.status === 429) {
    throw new Error(
      "la API esta limitando los registros (429). Espera a que se acabe la " +
        "ventana o borra el fichero de sesion y reinicia la API para vaciar el " +
        "limitador, que es en memoria.",
    );
  }
  if (registered.status !== 201) throw new Error(`registro: ${JSON.stringify(registered.body)}`);

  const deadline = Date.now() + 20000;
  let logAfter = logBefore;
  while (Date.now() < deadline && !/verify-email\?token=/.test(logAfter.slice(logBefore.length))) {
    await sleep(400);
    logAfter = await readLog();
  }
  const link = logAfter.slice(logBefore.length).match(/verify-email\?token=([A-Za-z0-9_-]+)/);
  if (!link?.[1]) throw new Error("el correo de verificacion no salio en el log de la API");
  await api("/auth/verify-email", { method: "POST", body: { token: link[1] } });

  const login = await api("/auth/login", {
    method: "POST",
    body: { email, password, device: { label: "feel", platform: "web" } },
  });
  if (login.status !== 200) throw new Error(`login: ${JSON.stringify(login.body)}`);

  const session = login.body.data.session;
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

/**
 * A drag, in steps, sampling the panel after each one.
 *
 * Touch and not a mouse, and that is the whole point: a `Pan` gesture is a touch
 * gesture. A synthetic mouse produces `pointerdown` with `pointerType: "mouse"`
 * and a gesture handler is entitled to ignore that, so a harness that drags with
 * the mouse reports "nothing happens" for a panel that works perfectly well
 * under a finger — which is exactly the sort of wrong answer a harness exists to
 * stop anyone else having to guess about.
 */
const INPUT = process.env.PANEL_INPUT ?? "touch";

async function drag(tab, from, to, steps, sample) {
  const samples = [];
  const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];

  if (INPUT === "touch") {
    await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
  } else {
    await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
  }

  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    if (INPUT === "touch") {
      await tab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
    } else {
      await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 1 });
    }
    await sleep(70);
    // `cards:` and not a spread: the sample is an array, and spreading one into
    // an object gives keys "0", "1", "2" — which reads as a bug in the panel.
    samples.push({ pointer: { x: Math.round(x), y: Math.round(y) }, cards: await sample() });
  }

  if (INPUT === "touch") {
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1, buttons: 0 });
  }
  return samples;
}

try {
  const session = await account();

  // A clientId of eight characters or more. The contract asks for it and the
  // server rejects the *whole* push otherwise, which looks like a seeding
  // problem and is not: nothing arrives and the panel is empty.
  const CLIENT = "verify-script";

  const ws = randomUUID();
  const lists = [0, 1, 2].map(() => randomUUID());
  /**
   * The dashboard's own id, not a random one.
   *
   * There is one panel row per person, and the app picks which local row is
   * "the" panel and soft-deletes the rest. A layout written under a fresh random
   * id arrives as a second row, the app resolves to the row it created for itself
   * and the seeded cards are the ones that get dropped — so the panel shows one
   * card and the measurement is of the wrong thing.
   */
  const DASHBOARD_ID = "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30";
  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(), lastPulledAt: null,
      clientTimestamp: new Date().toISOString(),
      operations: [
        { operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create", entityId: ws, baseVersion: 0, payload: { name: "Casa", color: "teal" }, base: null, clientTimestamp: new Date().toISOString() },
        ...lists.map((id, i) => ({
          operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create", entityId: id, baseVersion: 0,
          payload: { workspaceId: ws, folderId: null, title: `Lista ${i + 1}`, kind: "tasks" }, base: null,
          clientTimestamp: new Date().toISOString(),
        })),
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
          entityId: DASHBOARD_ID, baseVersion: 0, base: null, clientTimestamp: new Date().toISOString(),
          // Three cards, each already arranged somewhere different, and no two of
          // them asking for the same cells. A panel where every card says (0,0)
          // cannot tell "it kept its place" from "it was packed there for me".
          payload: {
            layout: [
              { id: `list:${lists[0]}`, kind: "recent_lists", x: 0, y: 0, w: 4, h: 2, page: 0, pinned: true, settings: { listId: lists[0], title: "Lista 1", kind: "tasks" } },
              { id: `list:${lists[1]}`, kind: "recent_lists", x: 4, y: 0, w: 4, h: 2, page: 0, pinned: true, settings: { listId: lists[1], title: "Lista 2", kind: "tasks" } },
              { id: `list:${lists[2]}`, kind: "recent_lists", x: 8, y: 2, w: 4, h: 2, page: 0, pinned: true, settings: { listId: lists[2], title: "Lista 3", kind: "tasks" } },
            ],
          },
        },
      ],
    },
  });
  console.log("siembra:", pushed.status, JSON.stringify(pushed.body?.data?.results?.map(r => r.status)));

  tab = await openTab(chrome.port);
  await seedSession(tab, session, `${APP}/`);
  await tab.goto(`${APP}/`);

  // Wait for the panel rather than sleeping a fixed amount: the first load after
  // a code change is a Metro rebuild, and a fixed wait either wastes half a
  // minute or gives up before the bundle is there. A wait that is too short
  // reports "the panel is empty" and every measurement after it is of nothing.
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    await sleep(700);
    ready = await tab.evaluate(`
      (() => {
        if (document.body.innerText.includes('Todo lo que necesitas')) return false;
        return !!document.querySelector('[data-testid="panel-grid"]');
      })()
    `).catch(() => false);
  }
  if (!ready) {
    throw new Error(
      "el panel no apareció en un minuto. Pantalla: " +
        (await tab.evaluate("(document.body.innerText || '').slice(0, 200)")),
    );
  }
  await sleep(1200);

  // Edit mode.
  const entered = await tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
      if (!el) return { ok: false, screen: (document.body.innerText || '').slice(0, 300) };
      el.click();
      return { ok: true };
    })()
  `);
  if (!entered.ok) {
    throw new Error(`no hay lapiz de colocar las tarjetas. Pantalla: ${entered.screen}`);
  }
  await sleep(1500);

  /**
   * What is actually under the corner handle, and whether touches arrive at all.
   *
   * Added after a run where the resize did nothing whatsoever. From outside, "the
   * gesture did not fire" and "the gesture fired and the layout refused the size"
   * look identical — the card does not change either way — so the only way to
   * tell them apart is to look at what is under the point and count the touches
   * that land on it.
   */
  await tab.evaluate(`
    (() => {
      window.__touches = [];
      for (const type of ['touchstart', 'touchmove', 'touchend']) {
        document.addEventListener(type, (e) => {
          const t = e.changedTouches[0];
          window.__touches.push(type + (t ? '@' + Math.round(t.clientX) + ',' + Math.round(t.clientY) : ''));
        }, true);
      }
      const handle = [...document.querySelectorAll('[aria-label]')]
        .find(e => (e.getAttribute('aria-label') || '').toLowerCase().includes('cambiar el tamaño'));
      if (!handle) { window.__handle = null; return true; }
      const r = handle.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      window.__handle = {
        box: { x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height) },
        onTop: (top && (top.getAttribute('aria-label') || top.tagName)) || 'nada',
        inside: !!top && (top === handle || handle.contains(top)),
      };
      return true;
    })()
  `);
  console.log("esquina (que hay debajo):", JSON.stringify(await tab.evaluate("window.__handle")));

  /**
   * The card as the person sees it.
   *
   * The cell is the *slot*; the card is drawn inside it with a transform on top,
   * so during a drag the slot stays where the layout says and the card moves with
   * the finger. Measuring the slot and concluding "the card does not follow the
   * finger" is measuring the wrong box, and it looks exactly like the bug it is
   * not — which is worth a comment, because it cost an hour.
   */
  const geometry = `
    (() => {
      const cells = [...document.querySelectorAll('[data-testid="panel-grid"] > *')];
      return cells.map((c) => {
        // The first descendant that actually has a box. The first 'div' is the
        // gesture handler's wrapper, which is 'display: contents' and therefore
        // measures zero — and measuring that says every card is 0x0, which is
        // true and useless.
        const inner = [...c.querySelectorAll('div')].find(d => d.getBoundingClientRect().width > 0);
        const r = (inner ?? c).getBoundingClientRect();
        return {
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
        };
      });
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

  const before = await tab.evaluate(geometry);
  const handle = await tab.evaluate(handleOf);
  console.log("antes:      ", JSON.stringify(before));
  console.log("esquina:    ", JSON.stringify(handle));

  // --- resize: pull the corner 120px right and 90px down --------------------
  const resizeSamples = await drag(
    tab,
    handle,
    { x: handle.x + 120, y: handle.y + 90 },
    6,
    () => tab.evaluate(geometry),
  );
  console.log("\n--- RESIZE: la tarjeta que se arrastra ---");
  const first0 = before[0];
  for (const s of resizeSamples) {
    const c = s.cards[0];
    console.log(
      `  puntero x=${s.pointer.x}  ->  caja x=${c.x} ancho=${c.w} alto=${c.h}` +
        `  (el dedo esta ${Math.round(s.pointer.x - (c.x + c.w))}px a la derecha del borde)`,
    );
  }
  const afterResize = await tab.evaluate(geometry);
  console.log("anchos durante el arrastre:", JSON.stringify(resizeSamples.map((s) => s.cards[0].w)));
  console.log("despues:    ", JSON.stringify(afterResize));
  console.log("cambio el tamaño:", afterResize[0].w !== first0.w || afterResize[0].h !== first0.h);
  console.log("las otras se movieron:", JSON.stringify(before.slice(1)) !== JSON.stringify(afterResize.slice(1)));
  console.log("toques en la pagina:", JSON.stringify(await tab.evaluate("window.__touches.slice(0, 4)")));
  // --- move to a chosen cell ------------------------------------------------
  //
  // The thing the panel could not do before: the first card is dragged to the far
  // corner and has to *stay* there, in cells, with the others moving out of the
  // way — and not come back to wherever the packer would have put it.
  const first = afterResize[0];
  const othersBefore = afterResize.slice(1);
  console.log("\n--- MOVER A UNA CELDA ---");
  const moveSamples = await drag(
    tab,
    { x: first.x + 40, y: first.y + 30 },
    { x: first.x + 330, y: first.y + 210 },
    8,
    () => tab.evaluate(geometry),
  );
  moveSamples.forEach((s, i) => {
    const c = s.cards[0];
    console.log(`  paso ${i}: dedo x=${s.pointer.x} y=${s.pointer.y}  ->  carta x=${c.x} y=${c.y} ${c.w}x${c.h}`);
  });
  console.log("las otras se movieron DURANTE:",
    moveSamples.some((s) => JSON.stringify(s.cards.slice(1)) !== JSON.stringify(othersBefore)));

  // Read the resting place, not the place it is passing through. The cards ease
  // into their cells over about a sixth of a second, and a reading taken the
  // instant the finger lifts is a card still in flight — which compares against
  // nothing and looks exactly like a position that was not saved.
  await sleep(900);
  const afterMove = await tab.evaluate(geometry);
  console.log("despues:", JSON.stringify(afterMove));
  console.log("la carta se fue a la derecha y abajo:",
    afterMove[0].x > first.x + 60 && afterMove[0].y > first.y + 40);

  // It has to have been *stored*, not just drawn. A reload reads the layout back
  // from the cache, and a position that was only ever drawn comes back in the
  // place the packer wanted.
  await tab.goto(APP);
  await sleep(7000);
  const afterReload = await tab.evaluate(geometry);
  console.log("tras recargar:", JSON.stringify(afterReload));
  console.log("la posicion sobrevive a recargar:",
    Math.abs(afterReload[0].x - afterMove[0].x) < 3 &&
    Math.abs(afterReload[0].y - afterMove[0].y) < 3);

  console.log(`\n=== con ${INPUT === "touch" ? "el dedo" : "el raton"} ===`);
} catch (error) {
  console.log("fallo:", error.message, error.stack?.split("\n")[1] ?? "");
} finally {
  tab?.close();
  await chrome.kill();
}
