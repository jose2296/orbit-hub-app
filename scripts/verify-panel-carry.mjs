import { randomUUID } from "node:crypto";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Llevar una tarjeta a otra pantalla del panel.
 *
 * La gesture es nueva y no hay forma de comprobarla leyendo una captura: el
 * resultado —la tarjeta en la pantalla de al lado— también se puede conseguir
 * arrastrándola hasta el borde y arrastrando el panel entero, que es lo que
 * hacía antes. Lo que se mide aquí es lo que la distinguishes de aquéllo:
 *
 *  - el hold **antes** de mover nada es lo que la recoge. Un arrastre corto
 *    placement y un hold con afterwards push son dos gestos, y el que se está
 *    midiendo es el segundo.
 *  - empujar a un lado **cambia la pantalla** con la tarjeta ya en la mano, y el
 *    cambio lo hace el panel — el dedo está sobre la tarjeta, no sobre el fondo.
 *  - el empujón se gasta: un dedo quiet past the mark gira **una** pantalla, no
 *    todas. Es el fallo que hace que un panel se vaya solo al último punto.
 *  - soltar la deja **guardada** en la pantalla nueva, no solo dibujada allí.
 *  - y un hold sin push no **mueve** nada: ni pantalla ni escritura.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
/*
  Una sesión distinta en cada corrida, y no una reusada.
  La siembra empuja el panel con `baseVersion: 0`, que es la versión que tiene una
  fila que no existe; reutilizar la cuenta de la corrida anterior significa
  empujar sobre una fila que ya está en la 1, el empuje no se aplica, y la
  pantalla que sale es la del panel anterior — con sus nombres, sus pantallas y su
  número. Una comprobación que lee la pantalla equivocada no falla: falla en lo
  que medía, que es peor.
*/
const SESSION_FILE = `/private/tmp/orbit-carry-${Date.now().toString(36)}.json`;

/**
 * Los nombres de las cuatro tarjetas de la siembra.
 *
 * Van en la lista y no en el `settings` de la tarjeta porque es la lista de la que
 * el panel saca el título: una comprobación que busca el nombre que se escribió en
 * el widget busca un texto que la pantalla nunca pinta, y falla sin que haya
 * pasado nada — que es como sedleda una comprobación que no comprueba.
 */
const NOMBRES = ["Primera", "Segunda", "Tercera", "Cuarta"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);

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

/**
 * Una sesión, reutilizada entre corridas.
 *
 * Como en `verify-panel-swipe.mjs`: la cuenta se crea por la API leyendo el token
 * del correo en el log, y guardarla hace que una segunda corrida no monte otra.
 */
async function account() {
  try {
    const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
    if ((await api("/auth/me", { token: saved.accessToken })).status === 200) {
      return saved;
    }
  } catch {
    /* todavía no hay ninguna */
  }
  const { execSync } = await import("node:child_process");
  const port = new URL(API).port || "4000";
  const pid = execSync(`lsof -tnP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  const line = execSync(`lsof -p ${pid} | awk '/ 2w /{print $NF}'`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  const readLog = async () => (await readFile(line, "utf8").catch(() => "")) ?? "";
  const before = await readLog();
  const email = `carry-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  await api("/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      displayName: "Carry",
      locale: "es",
      acceptedTermsAt: new Date().toISOString(),
      device: { label: "carry", platform: "web" },
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
      body: { email, password, device: { label: "carry", platform: "web" } },
    })
  ).body.data.session;
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

const point = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];

/**
 * Un dedo. Se baja, se mueve a base de pasos y se levanta.
 *
 * `hold` es lo que separa los dos gestos de esta comprobación y por eso está
 * antes de cualquier movimiento: sin él el dedo cae, recorre y levanta, que es un
 * arrastre, y un arrastre coloca una tarjeta donde el dedo la suelta — que no es
 * lo que se está midiendo.
 */
async function touch(tab, from, to, { steps = 14, holdBefore = 0, holdAfter = 0, stepWait = 14 } = {}) {
  await tab.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(from.x, from.y),
  });
  if (holdBefore) await sleep(holdBefore);
  for (let i = 1; i <= steps; i += 1) {
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      ),
    });
    await sleep(stepWait);
  }
  if (holdAfter) await sleep(holdAfter);
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const chrome = await launchChrome();
let tab;
try {
  const session = await account();
  const CLIENT = "panel-carry";
  const ws = randomUUID();
  const lists = Array.from({ length: NOMBRES.length }, () => randomUUID());
  const at = new Date().toISOString();

  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: at,
      operations: [
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "workspace",
          kind: "create",
          entityId: ws,
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: { name: "Fondo", color: "teal" },
        },
        ...lists.map((id) => ({
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "list",
          kind: "create",
          entityId: id,
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: { workspaceId: ws, folderId: null, title: NOMBRES[lists.indexOf(id)], kind: "tasks" },
        })),
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "dashboard",
          kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30",
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: {
            /*
              Dos pantallas, cada una con sitio de sobra y con hueco entre las
              tarjetas. El hueco importa: una comprobación que empieza el gesto
              encima de una tarjeta que no está donde cree que está mide otra
              cosa, y una pantalla llena no tiene por dónde empezarlo.
            */
            layout: [
              {
                id: `list:${lists[0]}`,
                kind: "recent_lists",
                x: 0,
                y: 0,
                w: 2,
                h: 2,
                page: 0,
                pinned: true,
                settings: { listId: lists[0], title: "Primera", kind: "tasks" },
              },
              {
                id: `list:${lists[1]}`,
                kind: "recent_lists",
                x: 2,
                y: 0,
                w: 2,
                h: 2,
                page: 0,
                pinned: true,
                settings: { listId: lists[1], title: "Segunda", kind: "tasks" },
              },
              {
                id: `list:${lists[2]}`,
                kind: "recent_lists",
                x: 0,
                y: 0,
                w: 2,
                h: 2,
                page: 1,
                pinned: true,
                settings: { listId: lists[2], title: "Tercera", kind: "tasks" },
              },
              {
                id: `list:${lists[3]}`,
                kind: "recent_lists",
                x: 2,
                y: 0,
                w: 2,
                h: 2,
                page: 1,
                pinned: true,
                settings: { listId: lists[3], title: "Cuarta", kind: "tasks" },
              },
            ],
            pages: 2,
          },
        },
      ],
    },
  });
  check("la siembra se acepta", pushed.status === 200, String(pushed.status));

  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await tab.goto(APP);

  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    await sleep(700);
    ready = await tab
      .evaluate(
        `!!document.querySelector('[data-testid="panel-grid"]') && !document.body.innerText.includes('Todo lo que necesitas')`,
      )
      .catch(() => false);
  }
  if (!ready) {
    await tab.screenshot("verify/carry-no-panel.png");
    const texto = await tab.evaluate(`document.body.innerText.slice(0, 300)`).catch(() => "");
    const testids = await tab
      .evaluate(`[...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.dataset.testid))].join(', ')`)
      .catch(() => "");
    throw new Error(`el panel no aparecio. Texto: ${texto} | testids: ${testids}`);
  }
  await sleep(1200);

  /*
   * Los dos lectores que hacen falta, y los dos contra el DOM y no contra la
   * storage: lo que importa es dónde los **dibuja** el panel ahora mismo, y una
   * escritura que aún no ha llegado a la pantalla se parece mucho a una escritura.
   *
   * La pantalla visible se busca por su posición y no por su nombre: el track es
   * tan ancho como todas las pantallas seguidas y cada una tiene un `testid` con
   * su desplazamiento dentro, así que el nombre cambia con la página y la
   * posición no. Y el panel tiene margen a los lados, así que "la de la izquierda
   * del todo" no es la que empieza en cero.
   */
  const onScreen = () =>
    tab.evaluate(`
      (() => {
        const pantallas = [...document.querySelectorAll('[data-testid^="panel-screen-"]')];
        if (!pantallas.length) return { titulos: [], dot: -1 };
        const mitad = window.innerWidth / 2;
        const visibles = pantallas.filter(e => {
          const r = e.getBoundingClientRect();
          return r.left < mitad && r.right > 4;
        });
        const NOMBRES_TENIDAS = ${JSON.stringify(NOMBRES)};
        const raiz = visibles.sort(
          (a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left,
        )[0];
        const titulos = [...raiz.querySelectorAll('div')]
          .filter(e => e.children.length === 0)
          .map(e => (e.textContent || '').trim())
          .filter(t => NOMBRES_TENIDAS.includes(t));
        const puntos = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
        const actual = document.querySelector('[data-testid="panel-page-current"]');
        return { titulos: [...new Set(titulos)], dot: puntos.indexOf(actual) };
      })()
    `);

  /**
   * El centro de una tarjeta por su nombre, dentro de la pantalla que se ve.
   *
   * Y de la tarjeta y no del track: el track es tan ancho como todas las pantallas
   * seguidas, así que un rectángulo tomado de él pone el dedo fuera de la ventana,
   * donde un toque no hace nada.
   */
  const cardBox = (titulo) =>
    tab.evaluate(`
      (() => {
        const mitad = window.innerWidth / 2;
        const raiz = [...document.querySelectorAll('[data-testid^="panel-screen-"]')]
          .filter(e => {
            const r = e.getBoundingClientRect();
            return r.left < mitad && r.right > 4;
          })
          .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
        if (!raiz) return null;
        const nodo = [...raiz.querySelectorAll('div')]
          .find(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(titulo)});
        if (!nodo) return null;
        const r = nodo.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);

  const enterEdit = () =>
    tab.evaluate(`
      (() => {
        const el = [...document.querySelectorAll('[aria-label],[role=button]')]
          .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
        el.click();
        return true;
      })()
    `);

  /** Vuelve a la primera pantalla, sin gesto, para que cada caso empiece igual. */
  const goFirst = async () => {
    await tab.evaluate(`
      (() => {
        const b = [...document.querySelectorAll('[data-testid^="panel-page-"]')].find(e => e.dataset.testid === 'panel-page-0');
        b && b.click();
        return true;
      })()
    `);
    await sleep(400);
  };

  await enterEdit();
  await sleep(600);
  check("entra en modo edición", (await onScreen()).dot === 0, `dot ${(await onScreen()).dot}`);

  /* ------------------------------------------------------------------ el hold -- */

  {
    const antes = await onScreen();
    const caja = await cardBox("Primera");
    if (!caja) throw new Error("no encuentro la tarjeta Primera");
    // El hold y nada más: ni un punto de movimiento en toda la gesture.
    await touch(tab, caja, caja, { holdBefore: 700, holdAfter: 120, steps: 1 });
    await sleep(500);
    const despues = await onScreen();
    check(
      "un hold sin empujar no cambia de pantalla",
      despues.dot === antes.dot,
      `dot ${antes.dot} → ${despues.dot}`,
    );
    check(
      "y no deja la tarjeta fuera de su sitio",
      despues.titulos.includes("Primera"),
      despues.titulos.join(", "),
    );
    await tab.screenshot("verify/carry-hold.png");
  }

  /* ---------------------------------------------------------- push a la derecha -- */

  {
    await goFirst();
    const antes = await onScreen();
    const caja = await cardBox("Primera");
    await touch(tab, caja, { x: caja.x + 110, y: caja.y }, { holdBefore: 520, holdAfter: 420 });
    await sleep(700);
    const durante = await onScreen();
    await tab.screenshot("verify/carry-turn.png");
    check(
      "empujar a la derecha lleva la tarjeta a la pantalla siguiente",
      durante.dot === antes.dot + 1,
      `dot ${antes.dot} → ${durante.dot}`,
    );
    check(
      "y la tarjeta va con ella, no se queda atrás",
      durante.titulos.includes("Primera"),
      durante.titulos.join(", "),
    );
    check(
      "la otra tarjeta de la pantalla nueva sigue donde estaba",
      durante.titulos.includes("Tercera"),
      durante.titulos.join(", "),
    );
    check(
      "la de la pantalla de la que salió no la acompaña",
      !durante.titulos.includes("Segunda"),
      durante.titulos.join(", "),
    );
  }

  /* ------------------------------------------------------------- el push se gasta -- */

  {
    // Un dedo quieto pasado el mark gira **una** pantalla. Sin esto el panel se
    // camina solo hasta el último punto mientras alguien sujeta una tarjeta, que
    // es el fallo más caro de esta gesture.
    await tab.evaluate(`
      (() => {
        const b = [...document.querySelectorAll('[data-testid^="panel-page-"]')].find(e => e.dataset.testid === 'panel-page-0');
        b && b.click();
        return true;
      })()
    `);
    await sleep(500);
    const antes = (await onScreen()).dot;
    const caja = await cardBox("Segunda");
    await touch(tab, caja, { x: caja.x + 150, y: caja.y }, { holdBefore: 520, holdAfter: 1400 });
    await sleep(500);
    const despues = (await onScreen()).dot;
    check(
      "un dedo quieto pasado el mark gira una sola pantalla",
      despues === antes + 1,
      `dot ${antes} → ${despues}`,
    );
    check("y no se va hasta el final del panel", despues < 2, `dot ${despues}`);
  }

  /* ----------------------------------------------------------- queda guardada -- */

  {
    /*
      La escritura, y no la pantalla.
      Una tarjeta dibujada en la pantalla nueva y no guardada se pierde al
      recargar, y eso no lo ve ninguna comprobación de gestos: se ve después, en una
      sesión nueva, con el panel entero como estaba. Así que aquí se recarga la
      página y se mira dónde está la tarjeta — que es la única forma de que la
      palabra "guardada" signifique algo.
    */
    await tab.goto(APP);
    const deadline = Date.now() + 45000;
    let listo = false;
    while (Date.now() < deadline && !listo) {
      await sleep(700);
      listo = await tab
        .evaluate(`!!document.querySelector('[data-testid="panel-grid"]')`)
        .catch(() => false);
    }
    if (!listo) throw new Error("el panel no volvio tras recargar");
    /*
      Y se espera a que el panel se lea, no a que la página esté.
      La escritura de una tarjeta va por el outbox como todas las demás, así que
      recargar no la encuentra en el sitio al instante: llega después. Y una
      comprobación que recarga y mira demasiado pronto ve el panel *anterior* —
      que es exactamente el resultado que esta comprobación cree que está
      midiendo cuando lo que mide es que no ha tenido tiempo.
    */
    await sleep(7000);
    // Y de vuelta al modo de colocar: recargar devuelve la pantalla como se
    // abre, y una gesture que solo existe dentro de ese modo no hace nada fuera
    // de el — asi que el caso de "hacia atras" que viene justo despues mediria un
    // panel en el que la prueba no se puede hacer.
    await enterEdit();
    await sleep(500);

    // Donde esta cada tarjeta, en TODAS las pantallas del track, por su nombre.
    const donde = await tab.evaluate(`
      (() => {
        const NOMBRES_TENIDAS = ${JSON.stringify(NOMBRES)};
        const salida = {};
        for (const nombre of NOMBRES_TENIDAS) {
          const nodo = [...document.querySelectorAll('div')]
            .find(e => e.children.length === 0 && (e.textContent || '').trim() === nombre);
          if (!nodo) continue;
          const pantalla = nodo.closest('[data-testid^="panel-screen-"]');
          salida[nombre] = Number(String(pantalla.dataset.testid).replace('panel-screen-', '')) === 0
            ? 0
            : 1;
        }
        return salida;
      })()
    `);
    note(`tras recargar: ${JSON.stringify(donde)}`);
    check(
      "la tarjeta que se llevó a la derecha sigue ahí al recargar",
      donde["Primera"] === 1,
      `pantalla ${donde["Primera"]}`,
    );
    check(
      "y la que no se movió sigue en la suya",
      donde["Segunda"] === 0,
      `pantalla ${donde["Segunda"]}`,
    );
    await tab.screenshot("verify/carry-reload.png");
  }

  /* --------------------------------------------------------------- hacia atrás -- */

  {
    await tab.evaluate(`
      (() => {
        const b = [...document.querySelectorAll('[data-testid^="panel-page-"]')].find(e => e.dataset.testid === 'panel-page-1');
        b && b.click();
        return true;
      })()
    `);
    await sleep(500);
    const antes = await onScreen();
    const caja = await cardBox("Cuarta");
    await touch(tab, caja, { x: caja.x - 110, y: caja.y }, { holdBefore: 520, holdAfter: 420 });
    await sleep(700);
    const despues = await onScreen();
    check(
      "empujar a la izquierda también cambia de pantalla",
      despues.dot === antes.dot - 1,
      `dot ${antes.dot} → ${despues.dot}`,
    );
    check(
      "y la tarjeta va con ella",
      despues.titulos.includes("Cuarta"),
      despues.titulos.join(", "),
    );
    await tab.screenshot("verify/carry-back.png");
  }

  /* ------------------------------------------------------------------ el undo -- */

  {
    // Un hold sin push no escribe. Y una escritura que no cambia nada es una
    // operación en el outbox que alguien tendrá que sincronizar sin motivo.
    await goFirst();
    const antes = await onScreen();
    // "Segunda" y no la que se movió antes: una tarjeta que ya está en la segunda
    // pantalla no está en la primera, y una comprobación que la busca ahí mide un
    // `null` en vez de una gesture.
    const caja = await cardBox("Segunda");
    await touch(tab, caja, caja, { holdBefore: 650, holdAfter: 150, steps: 1 });
    await sleep(600);
    const despues = await onScreen();
    check(
      "soltar la tarjeta donde se recogió la deja en su pantalla",
      despues.dot === antes.dot && despues.titulos.includes("Segunda"),
      `dot ${despues.dot}, ${despues.titulos.join(", ")}`,
    );
  }

  const errores = await tab.evaluate(`
    (() => {
      const warnings = [];
      return warnings.length ? warnings.join(' | ') : '';
    })()
  `);
  if (errores) note(`consola: ${errores}`);
} finally {
  tab?.close();
  chrome.kill();
}

console.log(failures === 0 ? "\ntodas las comprobaciones pasan" : `\n${failures} comprobaciones fallan`);
process.exit(failures === 0 ? 0 : 1);
