import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * The two things that were asked for, measured rather than argued about.
 *
 * One: a sideways swipe on the *background* turns the page while the panel is
 * being arranged, and a sideways drag on a *card* still moves the card. Those two
 * share a finger and used to be the same gesture, which is why one of them had to
 * be switched off.
 *
 * Two: a resize is animated. The card under the corner used to be *set* instead
 * of animated, on the reasoning that it is under the finger — but a size is a
 * step, not a position, so the card is never under the finger: it is as many cells
 * across as the size says. Set without animating, it jumped a whole cell while its
 * neighbours glided.
 *
 * The measurement for the second one is the awkward part. The drawn width is now
 * animated, so it is *supposed* to take values that are not in the list of sizes —
 * that is the animation. So the check is not "only catalog sizes" but "did the
 * width move gradually between two catalog sizes, and did it get there".
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
  const email = `panel-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  const before = await readLog();
  await api("/auth/register", {
    method: "POST",
    body: { email, password, displayName: "Panel", locale: "es", acceptedTermsAt: new Date().toISOString(), device: { label: "panel", platform: "web" } },
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
  const session = (await api("/auth/login", { method: "POST", body: { email, password, device: { label: "panel", platform: "web" } } })).body.data.session;
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

/** A finger. A `Pan` is a touch gesture and a mouse pointer is entitled to be ignored. */
const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];

async function touchSwipe(tab, from, to, { steps = 12, hold = 0 } = {}) {
  await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
  for (let i = 1; i <= steps; i += 1) {
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      ),
    });
    await sleep(12);
  }
  if (hold) await sleep(hold);
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const chrome = await launchChrome();
let tab;
try {
  const session = await account();
  const CLIENT = "panel-swipe";
  const ws = randomUUID();
  const lists = Array.from({ length: 10 }, () => randomUUID());
  const at = new Date().toISOString();

  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: at,
      operations: [
        { operationId: randomUUID(), clientId: CLIENT, entity: "workspace", kind: "create", entityId: ws, baseVersion: 0, base: null, clientTimestamp: at, payload: { name: "Fondo", color: "teal" } },
        ...lists.map((id) => ({
          operationId: randomUUID(), clientId: CLIENT, entity: "list", kind: "create", entityId: id,
          baseVersion: 0, base: null, clientTimestamp: at,
          payload: { workspaceId: ws, folderId: null, title: `Lista ${id.slice(0, 4)}`, kind: "tasks" },
        })),
        {
          operationId: randomUUID(), clientId: CLIENT, entity: "dashboard", kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30", baseVersion: 0, base: null,
          clientTimestamp: at,
          payload: {
            /*
              Two columns wide and two rows tall on the first screen.
              Two columns, so a corner drag has somewhere to go: a card seeded at the
              full four cannot be resized, and a check that watches a resize happen
              to a card that cannot change is a check of nothing. Two rows out of
              six, so most of the board is background and there is somewhere to
              start a swipe that is not on a card.
            */
            layout: [
              ...lists.slice(0, 4).map((id, i) => ({
                id: `list:${id}`, kind: "recent_lists",
                x: (i % 2) * 2, y: Math.floor(i / 2), w: 2, h: 1, page: 0, pinned: true,
                settings: { listId: id, title: `Lista ${i + 1}`, kind: "tasks" },
              })),
              ...lists.slice(4).map((id, i) => ({
                id: `list:${id}`, kind: "recent_lists",
                x: (i % 2) * 2, y: Math.floor(i / 2), w: 2, h: 1, page: 1, pinned: true,
                settings: { listId: id, title: `Lista ${i + 5}`, kind: "tasks" },
              })),
            ],
          },
        },
      ],
    },
  });
  check("la siembra se acepta", pushed.status === 200, String(pushed.status));

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
  await sleep(1200);

  const enterEdit = () =>
    tab.evaluate(`
      (() => {
        const el = [...document.querySelectorAll('[aria-label],[role=button]')]
          .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
        el.click();
        return true;
      })()
    `);

  /**
   * The screen filling the window right now, as a DOM node handle.
   *
   * Every measurement in here has to be taken against this and not against the
   * track, which is as wide as all the screens side by side: a swipe laid out on
   * the track puts the finger outside the window, where a touch does nothing.
   */
  const theScreen = `
    (() => {
      const screens = [...document.querySelectorAll('[data-testid^="panel-screen-"]')];
      return screens.find(s => {
        const r = s.getBoundingClientRect();
        return r.left > -2 && r.right < window.innerWidth + 2;
      }) ?? screens[0];
    })()
  `;

  /**
   * One screen of the panel: where it is and how wide it is.
   *
   * Not the box of the track. The track is as wide as every screen side by side,
   * so a swipe laid out on it puts the finger outside the window — where a touch
   * does nothing, which looks exactly like a pager that is not following anything.
   */
  const screenBox = () =>
    tab.evaluate(`
      (() => {
        const r = (${theScreen}).getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right };
      })()
    `);
  const board = await screenBox();
  const current = () =>
    tab.evaluate(`
      (() => {
        const all = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
        const panel = document.querySelector('[data-testid="panel-grid"]');
        // The background layer is a child of the board now, and it is not a card.
        // Measuring it as one reads the whole board's width and calls it a card.
        const cards = [...panel.children].filter(c => c.getAttribute('data-testid') !== 'panel-background');
        return {
          here: all.findIndex(d => d.getAttribute('data-testid') === 'panel-page-current'),
          total: all.length,
          background: !!document.querySelector('[data-testid="panel-background"]'),
          first: (cards[0]?.innerText || '').split('\\n')[0],
        };
      })()
    `);

  // ---------------------------------------------------------------- fuera de editar
  await enterEdit(); // and straight back out, so the mode toggle itself is exercised
  await tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '').includes('Terminar de colocar')
          || (e.getAttribute('aria-label') || '').includes('Guardar'));
      if (el) el.click();
      return true;
    })()
  `);
  await sleep(1200);
  const outside = await current();
  check(
    "fuera de editar no hay capa de fondo",
    !outside.background,
    `pantalla ${outside.here + 1} de ${outside.total}`,
  );

  await touchSwipe(tab, { x: board.left + board.width - 24, y: board.top + board.height / 2 }, { x: board.left + 24, y: board.top + board.height / 2 });
  await sleep(900);
  const turnedOutside = await current();
  check(
    "fuera de editar el swipe sigue cambiando de pantalla",
    turnedOutside.here === 1,
    `de la ${outside.here + 1} a la ${turnedOutside.here + 1}`,
  );

  // back to the first screen
  await touchSwipe(tab, { x: board.left + 24, y: board.top + board.height / 2 }, { x: board.left + board.width - 24, y: board.top + board.height / 2 });
  await sleep(900);
  check("y vuelve a la anterior", (await current()).here === 0);

  // ------------------------------------------------------------------ editando
  await enterEdit();
  await sleep(1500);
  const editing = await current();
  check("al editar aparece la capa de fondo", editing.background === true);
  check("sigue habiendo varias pantallas", editing.total >= 2, `${editing.total} pantallas`);

  /**
   * A point on the board that no card covers, asked again every time it is needed.
   *
   * Not once at the start: the two screens hold different numbers of cards, so a
   * point that is free on the first is in the middle of a card on the second, and
   * a swipe that starts on a card is a card being dragged. The two failures look
   * the same from here — nothing moved that was supposed to move — and they are
   * not the same bug.
   *
   * The four cards on the first screen are two columns by one row, so the top two
   * rows are covered wall to wall and the background is only free below them.
   */
  const freeSpotOnBoard = () =>
    tab.evaluate(`
      (() => {
        const screen = ${theScreen};
        const pr = screen.getBoundingClientRect();
        // The cards on this screen, and nothing else: the screens either side are
        // on the track too, and a card that is half off the window covers the
        // border where a swipe has to start.
        const cards = [...screen.querySelectorAll('div')]
          .filter(c => c.offsetWidth > 0 && c.getBoundingClientRect().width > 0)
          .map(c => c.getBoundingClientRect())
          .filter(r => r.left >= pr.left - 2 && r.right <= pr.right + 2);
        const covered = (x, y) => cards.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        // Free with room around it: a point on the very edge of a card stops being
        // on it as soon as the card moves, and a swipe begun on the seam between a
        // card and the background is a swipe on a card.
        const free = (x, y) => {
          for (let dx = -14; dx <= 14; dx += 7) {
            for (let dy = -14; dy <= 14; dy += 7) {
              if (covered(x + dx, y + dy)) return false;
            }
          }
          return true;
        };
        const band = (edge) => {
          /*
           * A band of background wide enough to start a swipe in, at one side of
           * the screen, and always inside the window.
           *
           * Wide enough matters: a swipe needs more than the fourteen points the
           * gesture spends deciding whether it is a swipe, and a band narrower than
           * that gives a touch that goes nowhere. Narrower than the panel as well,
           * because a touch outside the window does nothing at all — which looks
           * exactly like a background that is not there.
           */
          const inner = 26;
          const lo = Math.max(pr.left + inner, 8);
          const hi = Math.min(pr.right - inner, window.innerWidth - 8);
          for (let gy = 4; gy < 40; gy++) {
            const y = pr.top + (pr.height * gy) / 40;
            for (let n = 0; n < 40; n++) {
              const x = edge === 'right' ? hi - ((hi - lo) * n) / 39 : lo + ((hi - lo) * n) / 39;
              if (free(x, y)) return { x: Math.round(x), y: Math.round(y) };
            }
          }
          return null;
        };
        return { right: band('right'), left: band('left'), screen: { left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width) } };
      })()
    `);

  const swipeBackground = async (towardsLeft) => {
    const spot = await freeSpotOnBoard();
    // A swipe to the left starts on the right and one to the right starts on the
    // left, so the probe is asked for the side the finger has to begin on.
    const from = towardsLeft ? spot.right : spot.left;
    if (!from) return { ok: false, why: "no hay hueco libre con espacio para el dedo" };
    // Three quarters of a screen, which is more than the distance a page needs and
    // keeps both ends of the touch inside the window.
    const travel = (spot.screen?.width ?? board.width) * 0.75;
    const to = towardsLeft
      ? { x: Math.max(10, from.x - travel), y: from.y }
      : { x: Math.min((await screenBox()).right - 10, from.x + travel), y: from.y };
    note(`swipe sobre el fondo hacia ${towardsLeft ? "la izquierda" : "la derecha"}: de ${from.x},${from.y} a ${Math.round(to.x)},${to.y}`);
    await touchSwipe(tab, from, to, { steps: 16 });
    await sleep(1000);
    return { ok: true, to: await current() };
  };

  const opening = await freeSpotOnBoard();
  check("hay hueco libre en el tablero para empezar el swipe", Boolean(opening.right), JSON.stringify(opening));

  if (opening.right) {
    const away = await swipeBackground(true);
    check(
      "un swipe sobre el fondo cambia de pantalla estando en modo edicion",
      away.ok && away.to.here === 1,
      away.ok ? `de la ${editing.here + 1} a la ${away.to.here + 1}` : away.why,
    );

    // And back, so the rest of the checks start on the first screen. The spot is
    // found again on the screen it is going to happen on.
    const back = await swipeBackground(false);
    check("y vuelve", back.ok && back.to.here === 0, back.ok ? `a la ${back.to.here + 1}` : back.why);
  }

  // ------------------------------------------------------------- swipe sobre una tarjeta
  // Every measurement here skips the background layer: it is a child of the board
  // now, and reading it as a card reports the width of the whole board.
  const boxes = () =>
    tab.evaluate(`
      (() => {
        // The cards of the screen on display. The track's children are the screens,
        // and a screen's box does not move when a card inside it is dragged — so
        // comparing them would say "nothing moved" about a card that did.
        const screen = ${theScreen};
        return [...screen.querySelectorAll('div')]
          .filter(d => d.offsetWidth > 0 && d.getBoundingClientRect().width > 0)
          .map(d => {
            const r = d.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top) };
          });
      })()
    `);

  const beforeMove = await boxes();
  const card = await tab.evaluate(`
    (() => {
      const screen = ${theScreen};
      const boxes = [...screen.querySelectorAll('div')].filter(d => d.offsetWidth > 0 && d.getBoundingClientRect().width > 0);
      const r = boxes[0].getBoundingClientRect();
      // The middle of the card, well away from the corner handle.
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()
  `);
  await touchSwipe(tab, card, { x: card.x - 90, y: card.y }, { steps: 10 });
  await sleep(1000);
  const afterMove = await boxes();
  const stillFirst = (await current()).here;
  const movedSomething = JSON.stringify(beforeMove) !== JSON.stringify(afterMove);
  check(
    "un swipe sobre una tarjeta mueve la tarjeta y no cambia de pantalla",
    movedSomething && stillFirst === 0,
    `pantalla ${stillFirst + 1}, tarjetas movidas: ${movedSomething}`,
  );

  // ------------------------------------------------------------------------- la animación
  const handle = await tab.evaluate(`
    (() => {
      // Inside the screen on display, and nowhere else: a corner on a screen that
      // is arriving is a button the person cannot see, and dragging it does
      // nothing at all while looking exactly like a broken resize.
      const screen = ${theScreen};
      const h = [...screen.querySelectorAll('[aria-label]')]
        .find(e => (e.getAttribute('aria-label') || '').toLowerCase().includes('cambiar el tamaño'));
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()
  `);
  check("hay una esquina que redimensionar", handle !== null);
  /*
    Counted in JS and not with `[aria-label*="…"]`.

    The CSS attribute selector is case sensitive and the app names the corner
    "Cambiar el tamaño de …" with a capital C, so the selector matched nothing
    and the check below compared 0 against 0 and passed without ever looking at a
    corner. A check that cannot fail is worse than no check: it reads as evidence
    that the corners are right, and what it actually establishes is that nobody
    counted them.
  */
  const RESIZE_LABEL = (el) => (el.getAttribute("aria-label") || "").toLowerCase().includes("cambiar el tamaño");
  const corners = await tab.evaluate(`
    [...document.querySelectorAll('[aria-label]')].filter(${RESIZE_LABEL.toString()}).length
  `);
  const liveCards = await tab.evaluate(`
    (() => {
      const screen = ${theScreen};
      return [...screen.querySelectorAll('[aria-label]')].filter(${RESIZE_LABEL.toString()}).length;
    })()
  `);
  check(
    "y solo hay esquinas en la pantalla que se mira",
    corners > 0 && corners === liveCards,
    `${corners} esquinas en el documento, ${liveCards} en la pantalla visible`,
  );

  if (handle) {
    const cellW = (board.width - 3 * 8) / 4;
    await tab.evaluate(`
      (() => {
        window.__w = [];
        window.__t0 = performance.now();
        window.__rec = true;
        const read = () => {
          if (!window.__rec) return;
          // The card being resized, which is on the screen on display.
          const screen = ${theScreen};
          const boxes = [...screen.querySelectorAll('div')].filter(d => d.offsetWidth > 0 && d.getBoundingClientRect().width > 0);
          const card = boxes[0];
          window.__w.push({ t: Math.round(performance.now() - window.__t0), w: Math.round(card.offsetWidth) });
          requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
        return true;
      })()
    `);

    // A drag long enough to cross two boundaries, slowly enough to be a person.
    await touchSwipe(tab, handle, { x: handle.x + Math.round(cellW * 2.4), y: handle.y }, { steps: 26, hold: 260 });
    await sleep(700);
    await tab.evaluate(`window.__rec = false`);

    const samples = await tab.evaluate(`window.__w`);
    const widths = [...new Set(samples.map((s) => s.w))];
    // The sizes the card is allowed to be, in pixels. Everything in between is the
    // animation, and its presence is the thing being checked.
    const cells = (n) => Math.round(n * cellW + (n - 1) * 8);
    const sizes = [1, 2, 3, 4].map(cells);
    const before = samples[0]?.w;
    const finished = widths[widths.length - 1];
    const between = widths.filter((w) => !sizes.includes(w));

    check(
      "la tarjeta cambia de tamaño al arrastrar la esquina",
      finished !== before && sizes.includes(finished),
      `de ${before}px a ${finished}px, tamaños ${sizes.join("/")}`,
    );
    check(
      "el ancho pasa por valores intermedios: la tarjeta se anima, no salta",
      between.length > 3,
      `${between.length} anchos intermedios distintos, ${samples.length} muestras en total`,
    );
    note(`anchos: ${widths.join(" ")}`);
  }

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} COMPROBACIONES FALLIDAS`);
} catch (error) {
  console.log("fallo:", error.message);
  failures += 1;
} finally {
  tab?.close();
  await chrome.kill();
}
