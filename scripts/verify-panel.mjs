import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { launchChrome, openTab, collectProblems } from "./cdp.mjs";

/**
 * Does the panel actually draw, and does it draw cards?
 *
 * The bug this exists for: a `GestureDetector` with two children. It typechecks,
 * every test passes and `expo export` succeeds — and the screen throws the moment
 * it is drawn, so the only way to know is to draw it.
 *
 * The data is seeded through the API and the session is planted in the browser's
 * own storage, rather than by clicking through sign-up: seeding by clicking tests
 * the sign-up form every time instead of the panel, and the panel is what broke.
 *
 * What it asserts, and why each one:
 *   1. no exception and no console error      — the panel has a red-error state
 *   2. the cards are on screen, painted       — `toHaveLength` on a DOM query
 *                                              says nothing about a gradient
 *   3. two cards, two gradients               — the refactor's whole point
 *   4. the pencil turns edit mode on          — the mode the gestures live in
 *   5. the menu carries the sync dot          — the badge the refactor moved
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";

/**
 * The API the app is *actually* talking to, and the log that API writes its mail
 * to.
 *
 * Not the one in `.env`, and that is the whole lesson of the first version of
 * this script. The dev server on 8081 was started with its own
 * `EXPO_PUBLIC_API_URL`, so seeding the API named in `.env` seeds a database the
 * app never reads: the panel comes up empty, the planted session is rejected
 * with a 401 that looks like a bug in the app, and every assertion after it
 * measures a blank screen. Both come from the environment so there is one source
 * of truth and it is the running one.
 */
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";

/**
 * Where the API writes the verification mail, found rather than configured.
 *
 * The API prints the mail to its own output instead of sending it, so the account
 * is verified by reading the token out of the log the process writes — and that
 * log is wherever the *running* process's stdout happens to point. A path written
 * down here goes stale the moment the API is restarted with a different one, and
 * then this script fails with "the mail never came" while the API sits there
 * perfectly healthy, logging somewhere else. So it is read off the process that is
 * actually listening on the port.
 */
const EMAIL_LOG = process.env.EMAIL_LOG ?? logOfTheApi();

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

/**
 * The verification link, which in development is only ever written to the API's
 * own output.
 *
 * The API prints the mail to its log rather than sending it, so the account is
 * verified by reading the token out of the log. The log is read from the mark
 * left *before* registering, because reading it after finds a token that is
 * already there and the wait for "something new" then never returns.
 */
const notes = [];
let failures = 0;

function check(name, ok, detail = "") {
  notes.push(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function note(text) {
  notes.push(`      ${text}`);
}

/** Waits for the panel to be on screen, rather than sleeping a fixed amount. */
async function waitForPanel(tab, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await tab
      .evaluate(
        `!!document.querySelector('[data-testid="panel-grid"]') && !document.body.innerText.includes('Todo lo que necesitas')`,
      )
      .catch(() => false);
    if (ready) return;
    await new Promise((r) => setTimeout(r, 600));
  }
  const seen = await tab
    .evaluate(
      `JSON.stringify({
        grid: !!document.querySelector('[data-testid="panel-grid"]'),
        body: (document.body.innerText || '').slice(0, 300),
      })`,
    )
    .catch((e) => `no se pudo leer: ${e.message}`);
  throw new Error(`el panel no apareció en el tiempo esperado — ${seen}`);
}

/**
 * A finger, not a mouse.
 *
 * A `Pan` gesture is a touch gesture, and a synthetic mouse produces a pointer
 * with `pointerType: "mouse"` that a gesture handler is entitled to ignore. A
 * check that drags with the mouse reports "nothing happens" for a panel that
 * works perfectly well under a finger — which is the sort of wrong answer a check
 * exists to stop anyone else having to guess about.
 */
async function touchDrag(tab, fromX, fromY, toX, toY, steps = 8) {
  const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];
  await tab.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(fromX, fromY),
  });
  for (let i = 1; i <= steps; i += 1) {
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(
        fromX + ((toX - fromX) * i) / steps,
        fromY + ((toY - fromY) * i) / steps,
      ),
    });
    await new Promise((r) => setTimeout(r, 60));
  }
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function readLog() {
  try {
    return await readFile(EMAIL_LOG, "utf8");
  } catch {
    return "";
  }
}

/** Waits for the API to write something new, rather than sleeping and hoping. */
async function waitForLog(before, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = await readLog();
    if (now.length > before.length && pattern.test(now.slice(before.length))) return now;
    await new Promise((r) => setTimeout(r, 400));
  }
  return readLog();
}

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

try {
  // ------------------------------------------------------------------ seed
  const email = `panel-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";

  // The mark in the API's log is taken *before* registering. Reading it after is
  // the bug this comment exists for: the token is already in the log by then, so
  // "wait for something new" waits for something that is never coming and the
  // script reports that no mail was sent when it plainly was.
  const logBefore = await readLog();

  const registered = await api("/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      displayName: "Panel",
      locale: "es",
      acceptedTermsAt: new Date().toISOString(),
      device: { label: "verify script", platform: "web" },
    },
  });
  if (registered.status !== 201) {
    throw new Error(`registro fallo: ${JSON.stringify(registered.body)}`);
  }

  // The account is not usable until the mail is followed, and in development the
  // mail only exists in the API's output.
  const logAfter = await waitForLog(logBefore, /verify-email\?token=/, 15000);
  const link = logAfter.slice(logBefore.length).match(/verify-email\?token=([A-Za-z0-9_-]+)/);
  if (!link?.[1]) {
    throw new Error(
      "el correo de verificacion no salio en el log de la API " +
        `(el log grew de ${logBefore.length} a ${logAfter.length} caracteres)`,
    );
  }

  const verified = await api("/auth/verify-email", { method: "POST", body: { token: link[1] } });
  check("la cuenta se verifica", verified.status === 200, `status ${verified.status}`);

  const login = await api("/auth/login", {
    method: "POST",
    body: { email, password, device: { label: "verify script", platform: "web" } },
  });
  if (login.status !== 200) {
    throw new Error(`login fallo: ${JSON.stringify(login.body)}`);
  }
  const session = login.body.data.session;
  note(`sesion: ${session.user.email}`);

  const token = session.accessToken;
  const push = async (operations) =>
    api("/sync/push", {
      method: "POST",
      token,
      body: {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations,
        clientTimestamp: new Date().toISOString(),
      },
    });

  // Two spaces with two different colours, and a list in each.
  const teal = randomUUID();
  const rose = randomUUID();
  const listA = randomUUID();
  const listB = randomUUID();

  const pushed = await push([
    {
      operationId: randomUUID(),
      clientId: "verify-panel",
      entity: "workspace",
      kind: "create",
      entityId: teal,
      baseVersion: 0,
      payload: { name: "Casa", emoji: "🏠", color: "teal" },
      base: null,
      clientTimestamp: new Date().toISOString(),
    },
    {
      operationId: randomUUID(),
      clientId: "verify-panel",
      entity: "workspace",
      kind: "create",
      entityId: rose,
      baseVersion: 0,
      payload: { name: "Cine", emoji: "🎬", color: "rose" },
      base: null,
      clientTimestamp: new Date().toISOString(),
    },
    {
      operationId: randomUUID(),
      clientId: "verify-panel",
      entity: "list",
      kind: "create",
      entityId: listA,
      baseVersion: 0,
      payload: { workspaceId: teal, folderId: null, title: "Compra", kind: "tasks" },
      base: null,
      clientTimestamp: new Date().toISOString(),
    },
    {
      operationId: randomUUID(),
      clientId: "verify-panel",
      entity: "list",
      kind: "create",
      entityId: listB,
      baseVersion: 0,
      payload: { workspaceId: rose, folderId: null, title: "Peliculas", kind: "movies" },
      base: null,
      clientTimestamp: new Date().toISOString(),
    },
    {
      operationId: randomUUID(),
      clientId: "verify-panel",
      entity: "dashboard",
      kind: "update",
      entityId: randomUUID(),
      baseVersion: 0,
      payload: {
        // Two cards of two by two, side by side, on a screen six rows deep.
        //
        // Two by two and not full width: a card that fills the width of a four
        // column panel has no room to be moved to, so a check that drags one of
        // those is asking for something the panel is right to refuse, and the
        // failure it reports is the check's and not the panel's.
        layout: [
          {
            id: `list:${listA}`,
            kind: "recent_lists",
            x: 0,
            y: 0,
            w: 2,
            h: 2,
            page: 0,
            pinned: true,
            settings: { listId: listA, title: "Compra", kind: "tasks" },
          },
          {
            id: `list:${listB}`,
            kind: "recent_lists",
            x: 2,
            y: 0,
            w: 2,
            h: 2,
            page: 0,
            pinned: true,
            settings: { listId: listB, title: "Peliculas", kind: "movies" },
          },
        ],
      },
      base: null,
      clientTimestamp: new Date().toISOString(),
    },
  ]);
  check("la siembra por la API se acepta", pushed.status === 200, `status ${pushed.status}`);
  for (const result of pushed.body?.data?.results ?? []) {
    check(
      `operacion ${result.entity ?? "?"} aplicada`,
      result.status === "applied" || result.status === "duplicate",
      result.status,
    );
  }

  // -------------------------------------------------------------- the browser
  tab = await openTab(chrome.port);
  const problems = collectProblems(tab);

  await tab.goto(`${APP}/`, { readyExpression: "document.readyState === 'complete'" });

  // Plant the session where the app looks for it, before it boots.
  await tab.evaluate(`
    (() => {
      const s = ${JSON.stringify({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
        tokenType: "Bearer",
        user: session.user,
        device: session.device,
      })};
      localStorage.setItem("orbithub:access-token", s.accessToken);
      localStorage.setItem("orbithub:refresh-token", s.refreshToken);
      localStorage.setItem("orbithub:session-meta", JSON.stringify({
        expiresIn: s.expiresIn,
        issuedAt: Date.now(),
        user: s.user,
        device: s.device,
      }));
      return true;
    })()
  `);

  await tab.goto(`${APP}/`, { readyExpression: "document.readyState === 'complete'" });
  await new Promise((r) => setTimeout(r, 6000));

  const screen = await tab.evaluate("document.body.innerText || ''");
  note(`pantalla: ${JSON.stringify(screen.slice(0, 200))}`);

  check(
    "no sale el error de GestureDetector",
    !screen.includes("more than one view") &&
      !problems.some((p) => p.text.includes("more than one view")),
  );

  const real = problems.filter(
    // The 401 on the shares inbox is a separate thing and is reported on its own:
    // a check that quietly ignores it is a check that will keep ignoring it.
    (p) => !/favicon|React DevTools|source-?map/i.test(p.text) && !p.text.includes("shares/inbox"),
  );
  check(
    "sin errores de consola, excepciones ni respuestas 4xx/5xx",
    real.length === 0,
    real.slice(0, 4).map((p) => `[${p.kind}] ${p.text.slice(0, 160)}`).join(" | "),
  );

  const inbox401 = problems.filter((p) => p.text.includes("shares/inbox"));
  note(
    inbox401.length === 0
      ? "sin 401 en la bandeja de compartir"
      : `${inbox401.length} 401 en /shares/inbox con la sesion puesta a mano — ` +
        "puede ser la llamada al montar antes de restaurar la sesion, o la sesion " +
        "a mano. Conviene mirarlo aparte.",
  );

  // -------------------------------------------------------------- the panel
  const panel = await tab.evaluate(`
    (() => {
      const grid = document.querySelector('[data-testid="panel-grid"]');
      /*
       * The cards, taken as the element children of each screen.
       *
       * \`[...grid.children]\` is the screens themselves: the track holds one view
       * per page, and the background layer while arranging, so that count has been
       * counting pages. It read as a card count because the two happen to be close
       * — one screen with two cards on it counts 1 — and then every check that
       * compared a card count against a per-card number (a resize handle, an
       * unpin button) was comparing screens against cards.
       *
       * A screen's own element children are exactly the cards, and that is the
       * level to count at: one entry per card, each entry *containing* the painted
       * gradient and the view Reanimated wobbles. Counting the gradient box
       * instead finds the card too, but then the gradient and the wobble are on
       * the element itself rather than inside it, and both of the checks that ask
       * "does it have a gradient" and "does it move" have to look the wrong way.
       */
      const screens = grid ? [...grid.querySelectorAll('[data-testid^="panel-screen-"]')] : [];
      const cards = screens.flatMap((s) => [...s.children].filter((el) => el.tagName === 'DIV'));
      return {
        hasGrid: !!grid,
        cards: cards.length,
        // The gradient is the refactor's point, so it is read off the computed
        // style rather than off the class name: a class can be there and the
        // background can still be flat.
        backgrounds: cards.map(c => {
          const el = [...c.querySelectorAll('div')].find(d => {
            const bg = getComputedStyle(d).backgroundImage || '';
            return bg.includes('gradient');
          });
          return el ? getComputedStyle(el).backgroundImage : null;
        }),
        text: cards.map(c => (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40)),
        pencil: [...document.querySelectorAll('[aria-label],[role=button]')]
          .some(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas')),
      };
    })()
  `);
  note(`panel: ${JSON.stringify(panel)}`);

  check("el panel dibuja la rejilla", panel.hasGrid);
  // Derived, not a number written down here: the harness reuses an account, and a
  // panel left over from an earlier run has as many cards as that run left. A
  // fixed count is then a check of the previous run.
  check("dibuja tarjetas", panel.cards >= 2, `${panel.cards} tarjetas`);
  check(
    "cada tarjeta esta pintada con un degradado",
    panel.backgrounds.length >= 2 && panel.backgrounds.every((bg) => Boolean(bg)),
    JSON.stringify(panel.backgrounds).slice(0, 160),
  );
  check(
    "las dos tarjetas tienen degradados distintos",
    panel.backgrounds[0] !== panel.backgrounds[1],
  );
  check("el lapiz de colocar las tarjetas esta", panel.pencil);

  // ---------------------------------------------------------- the edit mode
  if (panel.pencil) {
    await tab.evaluate(`
      (() => {
        const el = [...document.querySelectorAll('[aria-label],[role=button]')]
          .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
        el.click();
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const editing = await tab.evaluate(`
      (() => {
        // Case-insensitive: the label is "Cambiar el tamaño de X" and a check
        // for a lowercase "cambiar" finds nothing and looks like a missing handle.
        const byLabel = (needle) => [...document.querySelectorAll('[aria-label]')]
          .filter(e => (e.getAttribute('aria-label') || '').toLowerCase().includes(needle));

        // The wobble is applied by Reanimated to the view inside the cell, so the
        // count is per card and not per element: one card legitimately has two
        // rotated ancestors (the cell and the animated view inside it), and
        // counting elements makes the assertion wrong by exactly a factor of two.
        //
        // And the cells are the cards, at the level that contains both the
        // painted card and the view Reanimated wobbles: the element children of
        // each screen. A direct child of the track was the screens plus the
        // background layer — a page count standing in for a card count, so
        // \`resizeHandles === cards\` was asking two cards to equal one screen.
        const cells = [...document.querySelectorAll('[data-testid="panel-grid"] [data-testid^="panel-screen-"]')]
          .flatMap((s) => [...s.children].filter((el) => el.tagName === 'DIV'));
        const wobbling = cells.filter((cell) =>
          [...cell.querySelectorAll('*')].some((el) => {
            const t = getComputedStyle(el).transform;
            return t && t !== 'none' && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(t);
          }),
        );

        return {
          cards: cells.length,
          resizeHandles: byLabel('cambiar el tamaño').length,
          unpinButtons: byLabel('quitar').length,
          wobbling: wobbling.length,
          sample:
            getComputedStyle(
              cells[0]?.querySelector('[style*="rotate"]') ?? cells[0],
            ).transform?.slice(0, 70) ?? null,
        };
      })()
    `);

    // How far the cards lean, sampled over half a second.
    //
    // The amplitude is what was wrong: seven tenths of a degree, and the cards
    // rattled. "Is it transforming" cannot tell a gentle lean from a rattle —
    // both are a matrix that is not the identity — so the angle itself is read,
    // several times, because the amplitude is a peak and one sample lands on
    // whichever side of the swing it happens to catch.
    const TILT = `
      (() => {
        const cells = [...document.querySelectorAll('[data-testid="panel-grid"] > *')];
        const tiltOf = (cell) => {
          for (const el of cell.querySelectorAll('*')) {
            const m = getComputedStyle(el).transform?.match(/matrix\\(([^,]+), ([^,]+)/);
            if (m) return (Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI;
          }
          return 0;
        };
        return cells.map((c) => Math.abs(tiltOf(c)));
      })()
    `;
    const seen = [];
    for (let i = 0; i < 12; i += 1) {
      const angles = await tab.evaluate(TILT).catch(() => null);
      if (Array.isArray(angles) && angles.length > 0) {
        seen.push(angles.map((a) => Number(Number(a).toFixed(2))));
      }
      await new Promise((r) => setTimeout(r, 90));
    }
    const peak = seen.flat().reduce((most, a) => Math.max(most, a), 0);
    const distinct = new Set(seen.flat()).size;
    note(`inclinacion maxima: ${peak.toFixed(2)} grados, ${distinct} valores distintos en 12 muestras`);
    note(`modo edicion: ${JSON.stringify(editing)}`);
    check(
      "cada tarjeta tiene su esquina de redimensionar",
      editing.resizeHandles === editing.cards && editing.cards > 0,
      `${editing.resizeHandles} esquinas para ${editing.cards} tarjetas (muestra: ${editing.sample})`,
    );
    check(
      "cada tarjeta se puede quitar del panel",
      editing.unpinButtons === editing.cards && editing.cards > 0,
      `${editing.unpinButtons} botones para ${editing.cards} tarjetas`,
    );
    check(
      "las tarjetas se mueven al entrar en modo edicion",
      editing.wobbling === editing.cards && editing.cards > 0,
      `${editing.wobbling} de ${editing.cards} con rotacion (${editing.sample})`,
    );
    check(
      "el temblor es un balanceo y no un sacudon",
      peak > 0 && peak <= 0.6 && distinct >= 4,
      `maximo ${peak.toFixed(2)} grados, ${distinct} valores distintos (un balanceo se mueve sin parar; un sacudon pasa por cero)`,
    );

    // ---------------------------------------------------- the deck, not a list
    //
    // The whole point of the panel: a card can be put in a chosen cell, the
    // others get out of the way, and the position is *stored* rather than only
    // drawn. A panel that repacks itself on every render cannot pass this, which
    // is why it is checked by reloading the page rather than by reading the DOM
    // a second time — the same DOM would look identical with a position that was
    // never written anywhere.
    const grid = await tab.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="panel-grid"]');
        const r = panel.getBoundingClientRect();
        const cells = [...panel.children].map((c) => {
          const inner = [...c.querySelectorAll('div')].find((d) => d.getBoundingClientRect().width > 0);
          const b = (inner ?? c).getBoundingClientRect();
          return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height };
        });
        // The panel's own place on the page as well, because a touch has to be
        // dispatched in page coordinates and the cells are counted from the top
        // left of the panel. Mixing the two puts the finger somewhere the panel
        // is not, and the drag then measures nothing at all.
        return {
          left: r.left, top: r.top, width: r.width, height: r.height,
          viewport: window.innerHeight,
          cells,
        };
      })()
    `);

  // Every card is a size from the list, and none of them is off the panel.
  //
  // Not "no card is bigger than half the panel": a card that fills the width is
  // one of the sizes the panel offers, and refusing it would be refusing a thing
  // somebody asked for. What is not allowed is a size that is not in the list —
  // a card at 3.4 columns is a size nobody chose — or a card hanging off the end.
  const cell = { width: grid.width / 4, height: 60 };
  void cell;
  const onGrid = grid.cells.every(
    (card) =>
      card.w > 0 &&
      card.h > 0 &&
      card.w <= grid.width + 2 &&
      card.x >= -2 &&
      card.y >= -2 &&
      card.x + card.w <= grid.width + 2,
  );
  check(
    "cada tarjeta cabe en el panel y no se sale por un lado",
    onGrid,
    JSON.stringify(grid.cells.map((c) => `${Math.round(c.w)}x${Math.round(c.h)} en ${Math.round(grid.width)} de ancho`)),
  );

  // The drag. Down and to the right, into the free half of the screen.
  const startX = grid.left + grid.cells[0].x + 30;
  const startY = grid.top + grid.cells[0].y + 30;
  const toX = startX + grid.width * 0.45;
  const toY = startY + grid.height * 0.5;
  note(`arrastrando de (${Math.round(startX)}, ${Math.round(startY)}) a (${Math.round(toX)}, ${Math.round(toY)})`);
  await touchDrag(tab, startX, startY, toX, toY);
  await new Promise((r) => setTimeout(r, 1000));

  const moved = await tab.evaluate(`
    (() => {
      const panel = document.querySelector('[data-testid="panel-grid"]');
      const r = panel.getBoundingClientRect();
      const c = [...panel.children][0];
      const inner = [...c.querySelectorAll('div')].find((d) => d.getBoundingClientRect().width > 0);
      const b = (inner ?? c).getBoundingClientRect();
      return { x: b.left - r.left, y: b.top - r.top };
    })()
  `);

  check(
    "una tarjeta se pone en la celda que se elija",
    moved.x > grid.cells[0].x + 10 || moved.y > grid.cells[0].y + 10,
    `de (${Math.round(grid.cells[0].x)}, ${Math.round(grid.cells[0].y)}) a (${Math.round(moved.x)}, ${Math.round(moved.y)})`,
  );

    await tab.goto(APP);
    await waitForPanel(tab);
    const reloaded = await tab.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="panel-grid"]');
        const r = panel.getBoundingClientRect();
        const c = [...panel.children][0];
        const inner = [...c.querySelectorAll('div')].find((d) => d.getBoundingClientRect().width > 0);
        const b = (inner ?? c).getBoundingClientRect();
        return { x: b.left - r.left, y: b.top - r.top };
      })()
    `);
    check(
      "la posicion se guardo, no solo se dibujo",
      Math.abs(reloaded.x - moved.x) < 4 && Math.abs(reloaded.y - moved.y) < 4,
      `antes ${Math.round(moved.x)}, ${Math.round(moved.y)} — tras recargar ${Math.round(reloaded.x)}, ${Math.round(reloaded.y)}`,
    );
  }

  // ------------------------------------------------------ the screens of it
  //
  // A panel with more pinned things than fit has more than one screen, and the two
  // ways of getting between them are the dots and a swipe. The dots are checked
  // for existing whether or not anything is being arranged — they used to appear
  // only while arranging, which meant that looking at a panel you could not tell
  // there was a second screen of your things.
  const paging = await tab.evaluate(`
    (() => {
      const dots = [...document.querySelectorAll('[aria-label^="Ir a la pantalla"]')];
      return { dots: dots.length, labels: dots.map(d => d.getAttribute('aria-label')) };
    })()
  `);
  note(`pantallas: ${JSON.stringify(paging)}`);

  // Seed enough cards to need a second screen, then look again.
  await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: new Date().toISOString(),
      operations: [
        ...Array.from({ length: 8 }, (_, i) => ({
          operationId: randomUUID(),
          clientId: "verify-panel",
          entity: "list",
          kind: "create",
          entityId: randomUUID(),
          baseVersion: 0,
          payload: {
            workspaceId: teal,
            folderId: null,
            title: `Pagina ${i + 1}`,
            kind: "tasks",
          },
          base: null,
          clientTimestamp: new Date().toISOString(),
        })),
        {
          operationId: randomUUID(),
          clientId: "verify-panel",
          entity: "dashboard",
          kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30",
          baseVersion: 0,
          base: null,
          clientTimestamp: new Date().toISOString(),
          // Twenty-four one-by-one cards is exactly a full screen, so the last
          // one has to go somewhere: a second screen, which is what the swipe is
          // for.
          payload: {
            layout: Array.from({ length: 26 }, (_, i) => ({
              id: `page:${i}`,
              kind: "recent_lists",
              x: i % 4,
              y: Math.floor(i / 4),
              w: 1,
              h: 1,
              page: Math.floor(i / 24),
              pinned: true,
              settings: { title: `Tarjeta ${i + 1}` },
            })),
          },
        },
      ],
    },
  });
  await tab.goto(APP);
  await waitForPanel(tab);
  await new Promise((r) => setTimeout(r, 1200));

  const withScreens = await tab.evaluate(`
    (() => {
      const panel = document.querySelector('[data-testid="panel-grid"]');
      const r = panel.getBoundingClientRect();
      // Which page is marked, counted among all of them.
      //
      // Not by matching a label prefix: the current page's label is deliberately
      // different from the others' ("you are on page N" against "go to page N"),
      // so a query that looks for the "go to" prefix finds one fewer dot after a
      // swipe than before it, and the index it returns is then meaningless. A
      // stable id on every dot, and the marked one, survives both.
      const all = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
      const here = all.findIndex(d => d.getAttribute('data-testid') === 'panel-page-current');
      return {
        dots: all.length,
        here,
        firstCard: (panel.querySelector('div div')?.innerText || '').slice(0, 20),
        left: r.left, top: r.top, width: r.width, height: r.height,
        viewport: window.innerHeight,
      };
    })()
  `);
  note(
    `con varias pantallas: ${withScreens.dots} puntos, en la ${withScreens.here + 1}, se ve "${withScreens.firstCard.split("\n")[0]}"`,
  );
  check(
    "la navegación se ve sin estar editando",
    withScreens.dots >= 2,
    `${withScreens.dots} pantallas marcadas (${withScreens.firstCard.split("\n")[0]})`,
  );

  /**
   * The panel fills the screen and the screen does not scroll.
   *
   * The whole of it. A card is a fraction of the board, six rows of the cell are
   * exactly the board, and the result is a page whose content is the window — so
   * the thing to measure is not where a card is but whether the document is taller
   * than the window, which is the only definition of "it scrolls" that a person
   * would recognise.
   *
   * Read on the document and not on a panel, because a panel is never the thing
   * that scrolls: the page is, and a check that asks the panel how tall it is has
   * asked the wrong question.
   */
  const fits = await tab.evaluate(`
    (() => {
      const doc = document.documentElement;
      const panel = document.querySelector('[data-testid="panel-grid"]');
      const r = panel.getBoundingClientRect();
      // The bottom of the area the content lives in, which is the top of the tab
      // bar and not the bottom of the window. The window includes the bar, and
      // asking the panel to reach the bottom of the window is asking it to be
      // drawn underneath the navigation.
      const bar = [...document.querySelectorAll('div, nav')]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          // Touches the bottom of the window, is bar-sized and is not the page
          // itself. Without the upper bound the tallest match is the root element,
          // which is 2000px tall and starts above the header: comparing the panel
          // against it measures a gap of fifteen hundred pixels.
          return (
            b.height > 40 &&
            b.height < 200 &&
            b.bottom >= window.innerHeight - 2 &&
            b.top < window.innerHeight
          );
        })
        .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
      return {
        page: doc.scrollHeight,
        window: window.innerHeight,
        panelBottom: Math.round(r.bottom),
        barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
        barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
      };
    })()
  `);
  note(
    `la pagina mide ${fits.page} en una ventana de ${fits.window}; el panel acaba en ${fits.panelBottom} y la barra de pestanas empieza en ${fits.barTop}`,
  );
  check(
    "la pantalla no hace scroll",
    fits.page <= fits.window + 1,
    `el documento mide ${fits.page} en una ventana de ${fits.window}`,
  );
  check(
    "y el panel llega hasta donde empieza la barra de abajo",
    fits.barTop !== null && Math.abs(fits.panelBottom - fits.barTop) <= 2,
    `el panel acaba en ${fits.panelBottom}, la barra en ${fits.barTop} (${fits.barHeight} de alto)`,
  );

  // Every dot is a screen you can get to.
  //
  // Pressing each one in turn, and not counting them. The bug this is here for
  // drew one dot more than there were screens, so the bar said three and only two
  // of them went anywhere — and counting the dots would have passed, because
  // three dots for two screens is exactly what it was asked to look at. Pressing
  // the last one is the only thing that can see it.
  if (withScreens.dots >= 2) {
    const reachable = [];
    for (let index = 0; index < withScreens.dots; index += 1) {
      // By absolute index, and never by position within the dots that are *not*
      // current: that list has one fewer element every time one of them becomes
      // the current one, so index 1 of it is either a different dot or nothing at
      // all, and the check goes green having pressed one button twice.
      await tab
        .evaluate(`
          (() => {
            const dot = document.querySelector('[data-testid="panel-page-${index}"]')
              || [...document.querySelectorAll('[data-testid^="panel-page-"]')][${index}];
            dot?.click?.();
            return true;
          })()
        `)
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      reachable.push(
        await tab.evaluate(
          `[...document.querySelectorAll('[data-testid^="panel-page-"]')].findIndex(d => d.getAttribute('data-testid') === 'panel-page-current')`,
        ),
      );
    }
    check(
      "todos los puntos llevan a una pantalla distinta",
      new Set(reachable).size === withScreens.dots && reachable.every((p) => p >= 0),
      `${withScreens.dots} puntos, llevarían a ${JSON.stringify(reachable)}`,
    );

    // Back to the first, so the swipe checks below start where they mean to.
    await tab.evaluate(
      `[...document.querySelectorAll('[data-testid^="panel-page-"]')].find((d) => d.getAttribute('data-testid') === 'panel-page-current')?.click()`,
    );
    await new Promise((r) => setTimeout(r, 700));
  }

  if (withScreens.dots >= 2) {
    // A swipe to the left, with the finger, across the middle of the *visible*
    // part of the panel.
    //
    // Not of the panel: with twenty-six cards it is over a thousand pixels tall,
    // so the middle of it is several screens down and a touch dispatched there
    // lands outside the window and does nothing at all — which looks exactly like
    // a swipe that does not work.
    const cy = Math.min(
      withScreens.top + withScreens.height / 2,
      withScreens.top + (withScreens.viewport ?? 400) * 0.3,
    );
    note(`swipe a y=${Math.round(cy)} (la ventana acaba en ${withScreens.viewport})`);
    await touchDrag(
      tab,
      withScreens.left + withScreens.width * 0.8,
      cy,
      withScreens.left + withScreens.width * 0.2,
      cy,
      10,
    );
    await new Promise((r) => setTimeout(r, 900));

    const afterSwipe = await tab.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="panel-grid"]');
        const all = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
        return {
          here: all.findIndex(d => d.getAttribute('data-testid') === 'panel-page-current'),
          firstCard: (panel.querySelector('div div')?.innerText || '').slice(0, 20),
          transform: getComputedStyle(panel).transform,
        };
      })()
    `);
    check(
      "un swipe a la izquierda pasa a la siguiente pantalla",
      afterSwipe.here === withScreens.here + 1,
      `de la ${withScreens.here + 1} a la ${afterSwipe.here + 1} de ${withScreens.dots}, ahora se ve "${afterSwipe.firstCard.split("\n")[0]}"`,
    );
    check(
      "y la pantalla vuelve a su sitio al soltar",
      afterSwipe.transform === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(afterSwipe.transform),
      afterSwipe.transform,
    );

    // And back the other way.
    await touchDrag(
      tab,
      withScreens.left + withScreens.width * 0.2,
      cy,
      withScreens.left + withScreens.width * 0.8,
      cy,
      10,
    );
    await new Promise((r) => setTimeout(r, 900));
    const back = await tab.evaluate(
      `[...document.querySelectorAll('[data-testid^="panel-page-"]')].findIndex(d => d.getAttribute('data-testid') === 'panel-page-current')`,
    );
    check(
      "y un swipe a la derecha vuelve a la anterior",
      back === withScreens.here,
      `vuelve a la ${back + 1}`,
    );
  }

  // ------------------------------------------------------------ the sync row
  // The row has to be findable by the name of the *thing*, not by its state: a
  // row whose only text is "Al día" is a status label, and the first version of
  // this was exactly that and nobody could see it.
  const syncRow = await tab.evaluate(`
    (() => {
      const b = document.querySelector('[data-testid="drawer-button"]');
      b.click();
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 1200));
  const row = await tab.evaluate(`
    (() => {
      const panel = document.querySelector('[data-testid="drawer-panel"]');
      if (!panel) return { open: false };
      const el = [...panel.querySelectorAll('[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '').toLowerCase().includes('sincronizaci'));
      if (!el) return { open: true, found: false, text: (panel.innerText||'').slice(0,300) };
      const r = el.getBoundingClientRect();
      return {
        open: true,
        found: true,
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
        visible: r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight,
        height: Math.round(r.height),
      };
    })()
  `);
  note(`fila de sincronizacion: ${JSON.stringify(row)}`);
  check("el drawer tiene una fila de sincronizacion", row.open && row.found);
  check(
    "la fila dice que es la sincronizacion y no solo el estado",
    row.found && /sincronizaci/i.test(row.text),
    row.text,
  );
  check("la fila esta a la vista sin desplazarse", row.found && row.visible, `alto ${row.height}`);

  for (const problem of problems.slice(0, 12)) {
    note(`[${problem.kind}] ${problem.text.slice(0, 220)}`);
  }
} catch (error) {
  failures += 1;
  notes.push(`FALLA  el script no pudo terminar: ${error.message}`);
} finally {
  tab?.close();
  await chrome.kill();
}

console.log(notes.join("\n"));
console.log(failures === 0 ? "\nTODO OK" : `\n${failures} COMPROBACIONES FALLIDAS`);
process.exit(failures === 0 ? 0 : 1);
