import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * Llevar una tarjeta a otra pantalla del panel.
 *
 * La gesture es nueva y no hay forma de comprobarla leyendo una captura: el
 * resultado —la tarjeta en la pantalla de al lado— también se puede conseguir
 * arrastrándola hasta el borde y arrastrando el panel entero, que es lo que
 * hacía antes. Lo que se mide aquí es lo que la distingue de aquéllo:
 *
 *  - el hold **antes** de mover nada es lo que la recoge. Un arrastre corto es
 *    placement y un hold con afterwards push son dos gestos distintos.
 *  - empujar a un lado **cambia la pantalla** con la tarjeta ya en la mano, y el
 *    cambio lo hace el panel — el dedo está sobre la tarjeta, no sobre el fondo.
 *  - el empujón se gasta: un dedo quieto pasado el mark gira **una** pantalla, no
 *    todas. Es el fallo que hace que un panel se vaya solo al último punto.
 *  - soltar la deja **guardada** en la pantalla nueva, no solo dibujada allí.
 *  - y un hold sin push no **mueve** nada: ni pantalla ni escritura.
 *
 * Al final, la pantalla vacía: que en un panel de más de una pantalla se pueda
 * salir de ella haciendo swipe, que es lo que pasó cuando el track —que es lo
 * único que tiene el gesto— se dibujaba en lugar de la pantalla vacía.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";

/*
  Una sesión distinta en cada corrida, y no una reusada.
  La siembra empuja el panel con `baseVersion: 0`, que es la versión que tiene una
  fila que no existe; reutilizar la cuenta de la corrida anterior significa
  empujar sobre una fila que ya está en la 1, el empuje no se aplica, y la
  pantalla que sale es la del panel anterior — con sus nombres, sus pantallas y su
  número. Una comprobación que lee la pantalla equivocada no falla: falla en lo que
  estaba midiendo, que es peor.
*/
/**
 * Los nombres de las cuatro tarjetas de la siembra.
 *
 * Van en la lista y no en el `settings` de la tarjeta porque es la lista de la que
 * el panel saca el título: una comprobación que busca el nombre escrito en el
 * widget busca un texto que la pantalla nunca pinta, y falla sin que haya pasado
 * nada.
 */
const NOMBRES = ["Primera", "Segunda", "Tercera", "Cuarta"];

const SESSION_FILE = `/private/tmp/orbit-carry-${Date.now().toString(36)}.json`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Por donde va, porque un script de gestos que se queda parado no lo dice. */
const paso = (donde) => console.log(`  … ${donde}`);
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);

/**
 * Una IP distinta en cada corrida.
 *
 * El registro va con un limitador de cinco peticiones cada quince minutos por IP, y
 * la de un alta son tres: dar de alta, verificar y entrar. Dos corridas seguidas y la
 * segunda se queda sin ventana, con un 429 que dice "el registro no llega" y no
 * "has gastado las cinco". Como la API está detrás de un proxy que sí confía en
 * `X-Forwarded-For`, se pide una IP distinta y la comprobación deja de depender de
 * cuántas veces se ha ejecutado antes.
 */
const IP_DE_ESTA_CORRIDA = `10.90.${Math.floor(Date.now() / 1000) % 250}.${Math.floor(Math.random() * 250) + 1}`;

async function api(path, { method = "GET", body, token } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": IP_DE_ESTA_CORRIDA,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

/*
  Una sesión, y no una cuenta nueva cada vez.

  Registrarse funciona —verificarse por el token del correo, igual que en
  `verify-panel-swipe.mjs`— pero es lento y flaky: la API limita a cinco peticiones
  por ventana, así que una corrida que registra cuatro veces se queda sin
  respuestas y falla sin haber mirado el panel. Y no hace falta. La semilla empuja
  el panel con la versión que tiene su fila, que se **lee** del servidor en vez de
  suponerla: una cuenta nueva vale cero y una que ya ha sembrado otra vez vale lo
  que el servidor diga.

  Las listas sí que se crean de cero en cada corrida, así que los nombres de las
  tarjetas son siempre nuevos y el texto que se busca en la pantalla es siempre el
  que se acaba de escribir.
*/
/**
 * Una cuenta nueva, verificada con el token del correo que sale en el log.
 *
 * Con reintentos, porque el log del servidor no tiene por qué escribir la línea en
 * el segundo que se le espera, y porque la API limita a cinco peticiones por
 * ventana: una corrida que registra cuatro veces seguidas se queda sin respuestas y
 * falla sin haber mirado el panel. Ninguna de las dos cosas es un fallo de la app.
 *
 * La sesión se guarda porque registrarse cuesta un segundo y un correo, y porque
 * volver a usarla es más rápido que crear otra. Cuando la que había ya no vale —el
 * token de acceso caduca y las sesiones antiguas se revocan— se registra otra.
 */
/**
 * Una cuenta nueva en cada corrida, y no una sesión reusada.
 *
 * Reusarla parece más rápido y es un error: la semilla empuja cuatro listas nuevas
 * sobre el panel que la corrida anterior dejó con las suyas repartidas como ella
 * quiso, y una comprobación que espera encontrar "Primera" en la primera pantalla se
 * encuentra un panel que ya no es de esta corrida. Lo que falla no es el panel: es
 * que la comprobación está mirando el panel de antes, y eso se lee como
 * "el panel no dibuja las tarjetas".
 *
 * Y el alta no cuesta una ventana de la API, porque cada corrida pide una IP
 * distinta: el registro va con un limitador de cinco peticiones cada quince minutos
 * por IP, y sin eso la segunda corrida se queda sin peticiones a mitad y falla con un
 * 429 que dice "el registro no llega".
 */
async function account() {
  const log = logDelServidor();
  for (let intento = 1; intento <= 4; intento += 1) {
    const email = `carry-${Date.now().toString(36)}-${intento}@example.com`;
    const password = "a-very-long-password";
    /*
      El log se lee **antes** de registrar, no después: leído después y sin un punto
      de partida, el primer enlace que aparece es el de la cuenta anterior —que ya
      está verificada y no sirve— y el alta se queda esperando un correo que no es
      suyo. Es el fallo más tonto posible: da de alta la cuenta, verifica otra y
      falla al entrar.
    */
    const antes = await readFile(log, "utf8").catch(() => "");
    const alta = await api("/auth/register", {
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
    if (alta.status === 429) {
      note("429, la API limita por ventana; se espera");
      await sleep(20000 * intento);
      continue;
    }
    if (alta.status !== 201 && alta.status !== 200) {
      note(`registro ${alta.status}, se espera un momento`);
      await sleep(5000);
      continue;
    }
    const token = await tokenDeVerificacion(log, antes);
    if (!token) continue;
    await api("/auth/verify-email", { method: "POST", body: { token } });
    const entrada = await api("/auth/login", {
      method: "POST",
      body: { email, password, device: { label: "carry", platform: "web" } },
    });
    const session = entrada.body?.data?.session;
    if (!session) continue;
    await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
    return session;
  }
  throw new Error("no se pudo dar de alta una cuenta en cuatro intentos");
}

/** Dónde está escribiendo el servidor, que es donde sale el correo. */
function logDelServidor() {
  const port = new URL(API).port || "4000";
  const pid = execSync(`lsof -tnP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  return execSync(`lsof -p ${pid} | awk '/ 2w /{print $NF}'`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
}

/**
 * El token del correo de verificación de esta cuenta.
 *
 * Del trozo de log que ha aparecido **desde el alta**, y el último de ese trozo: el
 * log acumula todos los correos que ha enviado el servidor, así que el primero que
 * aparece es el de una cuenta de hace un rato —que además ya está verificada— y
 * con él el alta se queda esperando un correo que no es suyo. Es un fallo que se lee
 * como "el registro no llega" y en realidad es "se verificó otra cuenta".
 */
async function tokenDeVerificacion(log, antes) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await sleep(600);
    const ahora = await readFile(log, "utf8").catch(() => "");
    const nuevos = [...ahora.slice(antes.length).matchAll(/verify-email\?token=([A-Za-z0-9_-]+)/g)];
    if (nuevos.length > 0) return nuevos[nuevos.length - 1][1];
  }
  return null;
}

/** La fila del panel que hay en el servidor ahora mismo, con su version. */
async function dashboardRow(session) {
  const pulled = await api("/sync/pull", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: new Date().toISOString(),
    },
  });
  const cambios = pulled.body?.data?.changes ?? pulled.body?.data ?? [];
  const fila = (Array.isArray(cambios) ? cambios : Object.values(cambios))
    .flatMap((cambio) => Object.values(cambio ?? {}))
    .find((entidad) => entidad?.entity === "dashboard");
  return { entityId: fila?.entityId, version: fila?.version ?? 0 };
}

/**
 * Un dedo, con un identificador **nuevo en cada gesto**.
 *
 * El identificador dice qué dedo es, y es como el navegador sabe que el que había
 * ya no está. Reutilizar el mismo entre gestos —que es lo más corto de escribir—
 * convierte un gesto que se quedó a medio hacer en veneno para los siguientes: el
 * navegador espera la desaparición de un dedo que él cree que sigue puesto, y
 * `Input.dispatchTouchEvent` **deja de contestar** sin que la página esté mal. El
 * fallo aparece dos casos más abajo y apunta al sitio equivocado, que es la forma
 * más cara de perder el tiempo.
 */
let siguienteDedo = 1;
const point = (x, y, id) => [{ x, y, id, radiusX: 12, radiusY: 12, force: 1 }];

/**
 * Un dedo. Se baja, se mueve a base de pasos y se levanta.
 *
 * `holdBefore` es lo que separa los dos gestos de esta comprobación, y va **antes
 * de cualquier movimiento**: sin él el dedo cae, recorre y levanta, que es un
 * arrastre, y un arrastre coloca una tarjeta donde el dedo la suelta — que no es lo
 * que se está midiendo.
 */
/**
 * Un toque al navegador, con un reintento.
 *
 * `Input.dispatchTouchEvent` **espera a que el navegador acuse** el evento, y en
 * este entorno hay veces que ese acuse no llega aunque la página esté perfectamente
 * viva —que es lo que se comprobó: la página contestaba a una evaluación mientras la
 * entrada no contestaba nada—. Sin reintento el caso falla con un error que señala
 * el gesto y no dice que el gesto nunca llegó a empezar, y el que lee el fallo va a
 * mirar la app durante una tarde.
 *
 * Un reintento y se dice. No más de uno, porque un bucle de reintentos sobre un
 * gesto colgado esconde el problema en vez de mostrarlo.
 */
let reintentosDeEntrada = 0;
async function enviarToque(tab, params) {
  try {
    /*
      Quince segundos, y no el minuto del arnés.

      Un toque dispatched tarda milisegundos; quince segundos de silencio ya no son
      un toque lento, son un toque que no va a llegar. Con el plazo largo un atasco
      se comía un minuto en silencio por cada uno y el caso siguiente tardaba lo
      mismo, así que un problema de entorno parecía un problema del panel y había
      que esperarlo para enterarse. Con el plazo corto el atasco es un reintento de
      un segundo y se ve en la salida.
    */
    return await tab.send("Input.dispatchTouchEvent", params, { ms: 15000 });
  } catch (error) {
    reintentosDeEntrada += 1;
    // Tres intentos y una pausa larga entre ellos: el navegador se recoversolo,
    // y un reintento inmediato cae en el mismo instante en que sigue ocupado.
    for (let intento = 1; intento <= 3; intento += 1) {
      console.log(`      (el navegador no acuso un ${params.type}; intento ${intento + 1})`);
      await sleep(1500 * intento);
      try {
        return await tab.send("Input.dispatchTouchEvent", params, { ms: 15000 });
      } catch {
        /* se vuelve a intentar */
      }
    }
    throw new Error(
      `el navegador dejo de responder a los toques (${params.type}) y la pagina sigue viva: ` +
        "esto es el entorno de la comprobacion, no el panel",
    );
  }
}

async function touch(tab, from, to, { steps = 14, holdBefore = 0, holdAfter = 0, stepWait = 14, midShot = null } = {}) {
  const dedo = siguienteDedo++;
  await enviarToque(tab, {
    type: "touchStart",
    touchPoints: point(from.x, from.y, dedo),
  });
  try {
    if (holdBefore) await sleep(holdBefore);
    for (let i = 1; i <= steps; i += 1) {
      await enviarToque(tab, {
        type: "touchMove",
        touchPoints: point(
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps,
          dedo,
        ),
      });
      await sleep(stepWait);
    }
    if (midShot) await tab.screenshot(midShot);
    if (holdAfter) await sleep(holdAfter);
  } finally {
    /*
      El dedo se suelta **siempre**, también cuando el gesto ha fallado.

      Un dedo que se queda puesto en la pantalla es la peor cosa que puede dejar
      una comprobación de gestos: los siguientes toques llegan con un dedo que ya
      estaba ahí, el navegador deja de contestarlos, y el fallo aparece dos casos
      más abajo como si fuera otro. El fallo real ocurrió hace treinta segundos y
      el mensaje apunta al sitio equivocado.
    */
    // Y una cancelación detrás, porque un `touchEnd` que se pierde también es un
    // dedo que el navegador cree que sigue puesto.
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => {});
    await tab.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }).catch(() => {});
  }
}

const chrome = await launchChrome();
let tab;
/** Lo que dice la consola del navegador, para cuando algo falla sin decirlo. */
const consola = [];
try {
  const session = await account();
  const CLIENT = "panel-carry";
  const fila = await dashboardRow(session);
  const ws = randomUUID();
  const lists = NOMBRES.map(() => randomUUID());
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
        ...lists.map((id, i) => ({
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "list",
          kind: "create",
          entityId: id,
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: {
            workspaceId: ws,
            folderId: null,
            title: NOMBRES[i],
            kind: "tasks",
          },
        })),
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "dashboard",
          kind: "update",
          entityId: fila.entityId ?? "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30",
          baseVersion: fila.version,
          base: null,
          clientTimestamp: at,
          payload: {
            /*
              Dos pantallas con tarjetas y una vacía, declaradas con `pages: 3`.
              Las dos primeras con hueco entre las tarjetas —una comprobación que
              empieza el gesto encima de una tarjeta que no está donde cree que está
              mide otra cosa— y la tercera sin nada, que es la pantalla desde la que
              no se podía salir haciendo swipe.
            */
            layout: NOMBRES.map((nombre, i) => ({
              id: `list:${lists[i]}`,
              kind: "recent_lists",
              x: (i % 2) * 2,
              y: Math.floor(i / 2) * 2,
              w: 2,
              h: 2,
              page: i < 2 ? 0 : 1,
              pinned: true,
              settings: { listId: lists[i], title: nombre, kind: "tasks" },
            })),
            pages: 3,
          },
        },
      ],
    },
  });
  check("la siembra se acepta", pushed.status === 200, String(pushed.status));

  tab = await openTab(chrome.port);
  tab.on("Runtime.consoleAPICalled", (evento) => {
    if (evento.type !== "error" && evento.type !== "warning") return;
    const texto = (evento.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (texto.includes("deprecated")) return;
    consola.push(`${evento.type}: ${texto.slice(0, 300)}`);
  });
  tab.on("Runtime.exceptionThrown", (evento) => {
    consola.push(
      `excepcion: ${(evento.exceptionDetails?.exception?.description ?? evento.exceptionDetails?.text ?? "").slice(0, 400)}`,
    );
  });
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
    throw new Error(`el panel no aparecio. Texto: ${texto}`);
  }
  await sleep(1500);

  /*
    Los dos lectores que hacen falta, y los dos contra el DOM y no contra la
    storage: lo que importa es dónde los **dibuja** el panel ahora mismo, y una
    escritura que aún no ha llegado a la pantalla se parece mucho a una escritura.

    Las dos cosas que se piden de una tarjeta se piden de lo que se **ve**: su
    rectángulo dentro de la ventana, y el punto que dice en qué pantalla está el
    panel. No de su padre en el DOM, y por un motivo que es la propia función: las
    pantallas del track están todas montadas, y una que está a la izquierda fuera de
    la ventana es una pantalla que no se está mirando. Un dedo puesto sobre una de
    ellas no toca nada.
  */
  const onScreen = () =>
    tab.evaluate(`
      (() => {
        const NOMBRES_TENIDAS = ${JSON.stringify(NOMBRES)};
        const dentro = (r) => r.left > -1 && r.right < window.innerWidth + 1 && r.width > 0;
        const titulos = [...document.querySelectorAll('div')]
          .filter(e => e.children.length === 0 && NOMBRES_TENIDAS.includes((e.textContent || '').trim()))
          .filter(e => dentro(e.getBoundingClientRect()))
          .map(e => (e.textContent || '').trim());
        const puntos = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
        const actual = document.querySelector('[data-testid="panel-page-current"]');
        return { titulos: [...new Set(titulos)], dot: puntos.indexOf(actual) };
      })()
    `);

  /**
   * Dónde está una tarjeta ahora mismo, en píxeles de la ventana.
   *
   * Para lo que se comprueba es si **se ha movido**: dos números que se comparan
   * entre sí, no una posición contra una lista. Una tarjeta que no se ha movido y
   * una que se ha movido a donde le llevabas dan el mismo titular si sólo se mira
   * en qué pantalla está.
   */
  const dondeEsta = (titulo) =>
    tab.evaluate(`
      (() => {
        const nodo = [...document.querySelectorAll('div')]
          .filter(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(titulo)})
          .map(e => e.getBoundingClientRect())
          .find(r => r.left > -1 && r.right < window.innerWidth + 1 && r.width > 0);
        if (!nodo) return { left: 0, top: 0, fuera: true };
        return { left: Math.round(nodo.left), top: Math.round(nodo.top), fuera: false };
      })()
    `);

  /**
   * El rectángulo del tablero, y no el del track.
   *
   * El track —lo que se llama `panel-grid`— es tan ancho como todas las pantallas
   * seguidas, así que su borde derecho está a mil píxeles de una ventana de 390. Un
   * dedo colocado ahí está fuera de la pantalla, y un gesto que ocurre fuera de la
   * pantalla no falla: no pasa nada, y la comprobación lo aprueba.
   */
  const rectanguloDelTablero = () =>
    tab.evaluate(`
      (() => {
        const ventana = window.innerWidth;
        let nodo = document.querySelector('[data-testid="panel-grid"]');
        let r = nodo.getBoundingClientRect();
        while (Math.abs(r.width - ventana) > ventana * 0.2 && nodo.parentElement) {
          nodo = nodo.parentElement;
          r = nodo.getBoundingClientRect();
        }
        return {
          y: Math.round(r.top + r.height / 2),
          izquierda: Math.round(r.left),
          derecha: Math.round(r.right),
          ancho: Math.round(r.width),
          alto: Math.round(r.height),
        };
      })()
    `);

  /** El centro de una tarjeta por su nombre, si se está viendo. */
  const cardBox = (titulo) =>
    tab.evaluate(`
      (() => {
        const nodo = [...document.querySelectorAll('div')]
          .filter(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(titulo)})
          .map(e => e.getBoundingClientRect())
          .find(r => r.left > -1 && r.right < window.innerWidth + 1 && r.width > 0);
        if (!nodo) return null;
        return { x: nodo.left + nodo.width / 2, y: nodo.top + nodo.height / 2 };
      })()
    `);

  /**
   * Un punto del **hueco** del panel, y no un sitiounque esté en el panel.
   *
   * Buscado preguntando a la página qué hay debajo en vez de suponiendo que donde
   * no se ve una tarjeta hay fondo. La primera versión de esto puso el dedo encima
   * de una tarjeta —que es otra cosa: la tarjeta se coge, el fondo no— y el caso
   * falló sin que la app hubiera hecho nada mal. Un punto de un gesto es parte de
   * la comprobación, y se mide como cualquier otra cosa.
   */
  const hueco = () =>
    tab.evaluate(`
      (() => {
        const ventana = window.innerWidth;
        let nodo = document.querySelector('[data-testid="panel-grid"]');
        let r = nodo.getBoundingClientRect();
        while (Math.abs(r.width - ventana) > ventana * 0.2 && nodo.parentElement) {
          nodo = nodo.parentElement;
          r = nodo.getBoundingClientRect();
        }

        /*
          El punto con **más sitio alrededor**, y no el primer hueco que aparezca.

          Los dos son "sitios donde no hay tarjeta" y no son lo mismo: entre dos
          tarjetas hay un hueco de nueve píxeles que en la página sí cuenta como
          fondo y en el dedo no cuenta como nada. Una comprobación que elige el
          primer hueco falla sin que la app haya hecho nada mal, y lo hace de forma
          intermitente porque depende de dónde hayan caído las tarjetas.

          Así que se mide la distancia a la tarjeta más cercana de cada candidato y
          se gana el que más tiene. Es lo que significa "un sitio donde apoyar el
          dedo", dicho con números.
        */
        const tarjetas = [...document.querySelectorAll('[aria-label]')]
          .map(e => e.getBoundingClientRect())
          .filter(c => c.width > 0 && c.height > 0 && c.top >= r.top - 4 && c.bottom <= r.bottom + 4);
        const distancia = (x, y) => {
          let mejor = Number.MAX_VALUE;
          for (const c of tarjetas) {
            const dx = Math.max(c.left - x, 0, x - c.right);
            const dy = Math.max(c.top - y, 0, y - c.bottom);
            mejor = Math.min(mejor, Math.hypot(dx, dy));
          }
          return mejor === Number.MAX_VALUE ? Number.MAX_VALUE : mejor;
        };

        let elegido = null;
        for (let fy = 0.15; fy <= 0.9; fy += 0.05) {
          for (let fx = 0.1; fx <= 0.95; fx += 0.05) {
            const x = Math.round(r.left + r.width * fx);
            const y = Math.round(r.top + r.height * fy);
            const encima = document.elementFromPoint(x, y);
            if (!encima) continue;
            if (!encima.closest('[data-testid="panel-background"]')) continue;
            const d = distancia(x, y);
            if (!elegido || d > elegido.d) elegido = { x, y, d: Math.round(d) };
          }
        }
        return elegido;
      })()
    `);

  /**
   * Espera a que el panel tenga sus pantallas y se quede con ellas.
   *
   * Al montarse, el panel sabe de una pantalla y lee las demás un instante después:
   * durante ese hueco no hay puntos y `screens` vale uno. Un gesto que empieza ahí
   * no falla por el gesto —falla porque el panel todavía no sabe cuántas pantallas
   * tiene— y el mensaje apunta al sitio equivocado.
   */
  const panelQuieto = async (pantallasMinimas = 2) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const puntos = await tab
        .evaluate(`document.querySelectorAll('[data-testid^="panel-page-"]').length`)
        .catch(() => 0);
      if (puntos >= pantallasMinimas) {
        await sleep(500);
        return puntos;
      }
      await sleep(300);
    }
    throw new Error(`el panel no se ha quedado con ${pantallasMinimas} pantallas`);
  };

  /** Un dedo sobre una tarjeta, y el fallo dice qué se veía en su lugar. */
  const handOn = async (titulo) => {
    const caja = await cardBox(titulo);
    if (!caja) {
      const hay = await onScreen();
      throw new Error(
        `no encuentro la tarjeta "${titulo}". Se ven: ${hay.titulos.join(", ") || "(nada)"} (pantalla ${hay.dot})`,
      );
    }
    return caja;
  };

  /**
   * El borde exterior del panel por el lado indicado, en x.
   *
   * Medido y no calculado, porque un dedo colocado en el sitio equivocado no falla:
   * el gesto no ocurre, no pasa nada, y la comprobación aprueba.
   */
  const borde = async (lado) => {
    const r = await rectanguloDelTablero();
    return lado === "derecha" ? r.derecha : r.izquierda;
  };
  const bordeDerecho = () => borde("derecha");
  const bordeIzquierdo = () => borde("izquierda");

  /**
   * A entrar en modo colocar, o a quedarse si ya estaba.
   *
   * El lápiz sólo existe **fuera** del modo —dentro hay un botón de Guardar— así que
   * esta llamada reventaba con "cannot read property click of undefined" cuando el
   * caso anterior había dejado el panel colocando. Y el fallo no decía "el panel ya
   * estaba colocando", que es lo que pasaba.
   *
   * Devuelve lo que hizo para que el caso pueda decirlo, en vez de que se note por el
   * error de la siguiente línea.
   */
  const enterEdit = async () => {
    const que = await tab.evaluate(`
      (() => {
        if (document.querySelector('[data-testid="panel-done"]')) return 'ya-estaba';
        const el = [...document.querySelectorAll('[aria-label],[role=button]')]
          .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
        if (!el) return 'no-hay-lapiz';
        el.click();
        return 'entrado';
      })()
    `);
    if (que === 'no-hay-lapiz') throw new Error("no hay lápiz de colocar y el panel no está colocando");
    await sleep(700);
    return que;
  };

  /** Ir a una pantalla con un punto, para que cada caso empiece donde dice. */
  const goTo = async (indice) => {
    await tab.evaluate(`
      (() => {
        const b = [...document.querySelectorAll('[data-testid^="panel-page-"]')]
          .find(e => e.dataset.testid === 'panel-page-${indice}');
        b && b.click();
        return true;
      })()
    `);
    await sleep(500);
  };

  await enterEdit();
  await sleep(700);
  check("entra en modo edición", (await onScreen()).dot === 0, `dot ${(await onScreen()).dot}`);

  /* ------------------------------------------------------------------ el hold -- */

  {
    paso("el hold");
    const antes = await onScreen();
    const caja = await handOn("Primera");
    // El hold y nada más: ni un punto de movimiento en toda la gesture.
    await touch(tab, caja, caja, { holdBefore: 700, holdAfter: 150, steps: 1 });
    await sleep(600);
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
    paso("push a la derecha");
    const antes = await onScreen();
    const caja = await handOn("Primera");
    await touch(tab, caja, { x: await bordeDerecho(), y: caja.y }, {
      holdBefore: 520,
      holdAfter: 420,
    });
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

  /* ----------------------------------------------------------- queda guardada -- */

  {
    paso("queda guardada");
    /*
      La escritura, y no la pantalla.
      Una tarjeta dibujada en la pantalla nueva y no guardada se pierde al
      recargar, y eso no lo ve ninguna comprobación de gestos: se ve después, en una
      sesión nueva, con el panel entero como estaba. Así que aquí se recarga la
      página y se mira dónde está cada tarjeta — que es la única forma de que la
      palabra "guardada" signifique algo.

      Y va aquí, justo después del único carry que la precede, y no al final: los
      casos de abajo mueven más tarjetas, y una comprobación que mira "esa tarjeta
      se quedó donde estaba" después de que otro caso la movió está midiendo el
      caso de al lado.
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
      comprobación que recarga y mira demasiado pronto ve el panel *anterior* — que
      es exactamente el resultado que esta cree que está midiendo cuando lo que
      mide es que no ha tenido tiempo.
    */
    await sleep(7000);

    const donde = await tab.evaluate(`
      (() => {
        const NOMBRES_TENIDAS = ${JSON.stringify(NOMBRES)};
        const salida = {};
        const pantallas = [...document.querySelectorAll('[data-testid^="panel-screen-"]')]
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        for (const nombre of NOMBRES_TENIDAS) {
          const nodo = [...document.querySelectorAll('div')]
            .find(e => e.children.length === 0 && (e.textContent || '').trim() === nombre);
          if (!nodo) continue;
          salida[nombre] = pantallas.findIndex(p => p.contains(nodo));
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
      "y la que no se tocó sigue en la suya",
      donde["Segunda"] === 0,
      `pantalla ${donde["Segunda"]}`,
    );
    await tab.screenshot("verify/carry-reload.png");

    // Y de vuelta al modo de colocar: recargar devuelve la pantalla como se abre,
    // y una gesture que solo existe dentro de ese modo no hace nada fuera de él.
    await enterEdit();
    await sleep(600);
  }

  /* ------------------------------------------------------------- el push se gasta -- */

  {
    paso("el push se gasta");
    // Un dedo quieto pasado el mark gira **una** pantalla. Sin esto el panel se
    // camina solo hasta el último punto mientras alguien sujeta una tarjeta, que
    // es el fallo más caro de esta gesture.
    // Desde la primera pantalla y no desde la segunda: con tres pantallas un solo
    // giro desde la segunda ya llega al final, y "no se va hasta el final" no
    // distinguiría un dedo quieto de uno que recorre el panel entero.
    await goTo(0);
    const antes = await onScreen();
    const caja = await handOn("Segunda");
    /*
      Hasta el **borde**, no un poco hacia un lado. El dedo tiene que llevar la
      tarjeta hasta la última columna —que es su borde exterior pegado al borde del
      panel— y quedarse ahí. Es la regla del sistema: arrastras el icono al borde de
      la pantalla, lo dejas un momento y la pantalla cambia.
    */
    const borde = await bordeDerecho();
    await touch(tab, caja, { x: borde, y: caja.y }, { holdBefore: 520, holdAfter: 1400 });
    await sleep(600);
    const despues = await onScreen();
    check(
      "un dedo quieto pasado el mark gira una sola pantalla",
      despues.dot === antes.dot + 1,
      `dot ${antes.dot} → ${despues.dot}`,
    );
    check(
      "y no se recorre el panel entero con el dedo quieto",
      despues.dot < 2,
      `dot ${despues.dot}`,
    );
    check(
      "y la tarjeta va con ella",
      despues.titulos.includes("Segunda"),
      despues.titulos.join(", "),
    );
  }

  /* --------------------------------------------------------------- hacia atrás -- */

  {
    paso("hacia atrás");
    // Desde la pantalla 1 y no desde la 2: la 2 está vacía, y un dedo sobre una
    // pantalla vacía no tiene una tarjeta que recoger.
    await goTo(1);
    const antes = await onScreen();
    const caja = await handOn("Tercera");
    await touch(tab, caja, { x: await bordeIzquierdo(), y: caja.y }, { holdBefore: 520, holdAfter: 420 });
    await sleep(700);
    const despues = await onScreen();
    check(
      "empujar a la izquierda también cambia de pantalla",
      despues.dot === antes.dot - 1,
      `dot ${antes.dot} → ${despues.dot}`,
    );
    check(
      "y la tarjeta va con ella",
      despues.titulos.includes("Tercera"),
      despues.titulos.join(", "),
    );
    await tab.screenshot("verify/carry-back.png");
  }

  /* ------------------------------------------------------------------ el undo -- */

  {
    paso("el undo");
    await goTo(0);
    const antes = await onScreen();
    const caja = await handOn("Tercera");
    await touch(tab, caja, caja, { holdBefore: 650, holdAfter: 150, steps: 1 });
    await sleep(700);
    const despues = await onScreen();
    check(
      "soltar la tarjeta donde se recogió la deja en su pantalla",
      despues.dot === antes.dot && despues.titulos.includes("Tercera"),
      `dot ${despues.dot}, ${despues.titulos.join(", ")}`,
    );
  }

  /* ------------------------------------- el swipe también mientras se coloca -- */

  {
    paso("el swipe también mientras se coloca");
    /*
      Antes de mirar la pantalla vacía, la que sí tiene tarjetas: mientras se está
      colocando el swipe es **otro** gesto, no el de siempre.

      Fuera del modo, toda la tabla gira. Dentro, el gesto de la tabla se apaga —un
      arrastre que empieza sobre una tarjeta no puede ser un cambio de pantalla— y
      el cambio pasa al fondo, que es una capa por debajo de las tarjetas. Si esa
      capa no recibe el toque, el panel deja de tener swipe entero mientras se
      coloca y sólo quedan los puntos: colocar se vuelve a no tener swipe, que es
      justo lo que hace falta para llegar a la pantalla a la que uno quiere llevar
      una tarjeta.

      Y el control va primero, con el mismo dedo y en el mismo sitio pero fuera del
      modo. Sin él, un dedo mal puesto —o una dirección que en este panel no hace
      nada— pasa las dos comprobaciones y no ha medido ninguna de las dos.
    */
    await goTo(0);
    const tablero = await tab.evaluate(`
      (() => {
        /*
          El tablero es el **primer ancestro con tamaño**, y no el padre directo.

          El track es tan ancho como todas las pantallas seguidas
          — su rectángulo mide tres pantallas — y el padre que le pone el detector de
          gestos no tiene layout propio y devuelve un rectángulo de ceros. Medir
          cualquiera de los dos dos es poner el dedo fuera de la ventana sin que nada
          lo diga, y el gesto no falla nunca: simplemente no pasa nada y la
          comprobación aprueba.
        */
        const ventana = window.innerWidth;
        let nodo = document.querySelector('[data-testid="panel-grid"]');
        let r = nodo.getBoundingClientRect();
        // Se busca el ancestro que es **una pantalla de ancho**, y no el primero con
        // tamaño: el primero con tamaño es el track, que son tres pantallas, y un
        // dedo colocado a su derecha está a 1050 de una ventana de 390 — fuera de
        // ella, donde no hay nada. El gesto no falla nunca cuando eso pasa: no
        // pasa nada, y la comprobación lo aprueba.
        while (Math.abs(r.width - ventana) > ventana * 0.2 && nodo.parentElement) {
          nodo = nodo.parentElement;
          r = nodo.getBoundingClientRect();
        }
        return {
          y: Math.round(r.top + r.height / 2),
          izquierda: Math.round(r.left),
          derecha: Math.round(r.right),
          alto: Math.round(r.height),
          ancho: Math.round(r.width),
        };
      })()
    `);
    /*
      Hacia la **izquierda**, porque este panel trae la pantalla siguiente desde el
      lado derecho: un dedo que va a la izquierda avanza y uno que va a la derecha
      retrocede. Escribirlo al revés no da un fallo, da una comprobación que pasa
      probando que no pasa nada — que es lo que hizo la primera versión de este caso.
    */
    const swipeIzquierda = () =>
      touch(
        tab,
        { x: tablero.derecha - 40, y: tablero.y },
        { x: tablero.izquierda + 40, y: tablero.y },
        { steps: 14 },
      );

    // El control: Guardar sale del modo sin recargar.
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="panel-done"]')][0]?.click()`);
    await sleep(700);
    await swipeIzquierda();
    await sleep(700);
    const control = (await onScreen()).dot;
    check("el control: fuera del modo, un swipe avanza de pantalla", control === 1, `dot ${control}`);

    await tab.evaluate(`
      (() => {
        const el = [...document.querySelectorAll('[aria-label],[role=button]')]
          .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
        el.click(); return true;
      })()
    `);
    await sleep(700);
    await goTo(0);
    const estado = await tab.evaluate(`
      (() => ({
        editando: !!document.querySelector('[data-testid="panel-done"]'),
        fondo: !!document.querySelector('[data-testid="panel-background"]'),
      }))()
    `);
    note(`estado: ${JSON.stringify(estado)}`);
    await swipeIzquierda();
    await sleep(700);
    const despues = (await onScreen()).dot;
    check(
      "y dentro del modo también, que sin esto el pencil quita el swipe",
      despues === 1,
      `dot ${despues}`,
    );
  }

  /* ------------------------------------------------- la pantalla vacía también -- */

  {
    paso("la pantalla vacía también");
    /*
      Una pantalla sin tarjetas es la única donde el panel entero se dibuja vacío, y
      era justo ahí donde el gesto que cambia de pantalla no estaba montado: el
      track —que es lo único que lo tiene— se dibujaba *en lugar de* la pantalla
      vacía.

      Se notaba como un panel que de pronto solo tenía una pantalla. Los puntos
      seguían funcionando, así que tampoco era un panel roto: era un panel al que
      había que salirse pinchando un punto del tamaño de un grano de arroz.
    */
    await goTo(2);
    const enLaVacia = await tab.evaluate(`
      (() => ({
        // En modo de colocar la pantalla vacía son las cuatroantas, y mirando solo
        // el cartel esta comprobación informa de que no hay nada donde lo hay.
        vacia: !!document.querySelector('[data-testid="panel-empty-page"]')
          || !!document.querySelector('[data-testid="panel-empty-grid"]'),
        carriles: !!document.querySelector('[data-testid="panel-grid"]'),
        ancho: document.querySelector('[data-testid="panel-grid"]')
          ? Math.round(document.querySelector('[data-testid="panel-grid"]').getBoundingClientRect().width)
          : 0,
      }))()
    `);
    check("la tercera pantalla está vacía y lo dice", enLaVacia.vacia);
    check(
      "y el panel sigue montado debajo, que es lo que tiene el gesto",
      enLaVacia.carriles && enLaVacia.ancho > 300,
      `ancho ${enLaVacia.ancho}`,
    );

    /*
      Un swipe normal, sin hold: es el gesto de siempre, y es el que la pantalla
      vacía se comía. Sale del rectángulo **medido** del tablero y no de una y
      escrita aquí, porque una y que se sale por debajo del tablero es un dedo en
      el aire: el gesto no falla por el bug que se está mirando, y la comprobación
      lo aprueba sin haber probado nada.
    */
    const tablero = await tab.evaluate(`
      (() => {
        /*
          El tablero es el **primer ancestro con tamaño**, y no el padre directo.

          El track es tan ancho como todas las pantallas seguidas
          — su rectángulo mide tres pantallas — y el padre que le pone el detector de
          gestos no tiene layout propio y devuelve un rectángulo de ceros. Medir
          cualquiera de los dos dos es poner el dedo fuera de la ventana sin que nada
          lo diga, y el gesto no falla nunca: simplemente no pasa nada y la
          comprobación aprueba.
        */
        const ventana = window.innerWidth;
        let nodo = document.querySelector('[data-testid="panel-grid"]');
        let r = nodo.getBoundingClientRect();
        // Se busca el ancestro que es **una pantalla de ancho**, y no el primero con
        // tamaño: el primero con tamaño es el track, que son tres pantallas, y un
        // dedo colocado a su derecha está a 1050 de una ventana de 390 — fuera de
        // ella, donde no hay nada. El gesto no falla nunca cuando eso pasa: no
        // pasa nada, y la comprobación lo aprueba.
        while (Math.abs(r.width - ventana) > ventana * 0.2 && nodo.parentElement) {
          nodo = nodo.parentElement;
          r = nodo.getBoundingClientRect();
        }
        return {
          y: Math.round(r.top + r.height / 2),
          izquierda: Math.round(r.left),
          derecha: Math.round(r.right),
          alto: Math.round(r.height),
          ancho: Math.round(r.width),
        };
      })()
    `);
    /*
      Hacia la **derecha** desde la última pantalla, que es lo único que se puede
      hacer ahí: el dedo que avanza no tiene a dónde ir y el que retrocede sí. Y
      hacia la derecha porque en este panel el dedo que va a la izquierda avanza —
      la pantalla siguiente entra por la derecha — así que al revés la comprobación
      pasa probando que no pasa nada.
    */
    await touch(
      tab,
      { x: tablero.izquierda + 40, y: tablero.y },
      { x: tablero.derecha - 40, y: tablero.y },
      { steps: 14 },
    );
    await sleep(700);
    const despues = (await onScreen()).dot;
    check("y se puede hacer swipe para salir de la pantalla vacía", despues === 1, `dot ${despues}`);
    await tab.screenshot("verify/carry-pantalla-vacia.png");
  }
  /* ------------------------------------------- el arrastre rápido no mueve -- */

  paso("el arrastre rápido");
  {
    /*
      Un arrastre sin hold no mueve nada, y es lo que hace un teléfono.

      Aquí movía. Y tener las dos cosas —arrastrar coloca, hold y empujar cambia de
      pantalla— es tener dos respuestas para dos gestos que una mano no sabe
      distinguir, con la equivocada siendo la que pasa por accidente: una tarjeta
      que se coloca sola porque has rozado el panel mientras pretendías mirar.

      Se comprueba con la tarjeta **midiendo dónde estaba antes**: que no se haya
      movido ni un dedo. Y después de haberla cogido con un hold, porque si no el
      caso de arriba pasaría también en un panel donde nada se puede mover nunca.
    */
    const caja = await handOn("Cuarta");
    const antesDe = await dondeEsta("Cuarta");
    // Hacia abajo y no hacia un lado: un dedo lateral acaba en el borde, y en el
    // borde la tarjeta se va a otra pantalla — que es justo lo que este caso no
    // está mirando.
    /*
      Y tiene que ser **rápido de verdad**: cinco pasos sin pausa entre ellos. Con
      doce pasos y diez milisegundos de espera el dedo recorría la mitad de la
      tarjeta en trescientos milisegundos —más de lo que tarda el mantenimiento— y
      entonces no se estaba comprobando un arrastre rápido sino un hold con
      prisa. Un caso que prueba otra cosa y se llama por la otra es peor que no
      tenerlo: deja pasar un arrastre que sí mueve la tarjeta y nadie se entera.
    */
    await touch(tab, caja, { x: caja.x, y: caja.y + 170 }, { steps: 5, stepWait: 0 });
    await sleep(700);
    const despuesDe = await dondeEsta("Cuarta");
    check(
      "arrastrar sin coger la tarjeta no la mueve",
      Math.abs(despuesDe.left - antesDe.left) < 2 && Math.abs(despuesDe.top - antesDe.top) < 2,
      `de ${antesDe.left},${antesDe.top} a ${despuesDe.left},${despuesDe.top}`,
    );
    check(
      "y no la deja cogida tampoco",
      (await onScreen()).titulos.includes("Cuarta"),
      (await onScreen()).titulos.join(", "),
    );

    // Y con el hold, la misma tarjeta sí se mueve.
    await touch(tab, caja, { x: caja.x, y: caja.y + 170 }, {
      holdBefore: 520,
      holdAfter: 200,
      steps: 12,
      stepWait: 10,
    });
    await sleep(700);
    const movida = await dondeEsta("Cuarta");
    check(
      "cogida con el hold, el mismo arrastre sí la mueve",
      Math.abs(movida.left - antesDe.left) > 20 || Math.abs(movida.top - antesDe.top) > 20,
      `de ${antesDe.left},${antesDe.top} a ${movida.left},${movida.top}`,
    );
  }

  /*
    "Se puede pegar a un lado" **no está aquí**: está en `verify-panel-os.mjs`.

    Y no es por sitio, es por estado. Este recorrido llega a ese punto después de
    media docena de gestos de carry, y el caso anterior deja el panel colocando y
    con el rastro de la última tarjeta cogida; una comprobación que empieza así mide
    lo que quedó del gesto anterior. Allá el panel acaba de sembrarse y cada caso
    empieza donde dice.
  */

  /* ------------------------------------------------ el fondo también es gesto -- */

  paso("el fondo también es gesto");
  {
    /*
      El otro gesto del escritorio, y el que más se echa de menos cuando falta:
      **mantener pulsado el fondo** empieza a colocar. Es lo que todo el mundo sabe
      hacer en un móvil —pulsa y mantén el papel y los iconos se mueven— y aquí sólo
      funcionaba el lápiz de la cabecera.

      Y tocar el fondo mientras se coloca lo termina, que es la otra mitad del mismo
      gesto. El botón Guardar de la cabecera se queda: también es una forma de
      terminar, y quien llega a colocar cosas las está usando, no a mirarlas.
    */
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="panel-done"]')][0]?.click()`);
    await sleep(700);
    const fuera = await tab.evaluate(`!!document.querySelector('[data-testid="panel-done"]')`);
    check("el caso empieza fuera del modo de colocar", fuera === false);

    /*
      El nodo del panel, para saber si el componente se ha remontado.
      `panel-grid` se dibuja una sola vez mientras el panel siga montado, así que
      un nodo distinto después del hold es un remontaje — y un remontaje a mitad de
      un gesto se lleva el gesto por delante sin que se note por ningún lado.
    */
    // Devuelve un booleano y no el nodo: `Runtime.evaluate` con `returnByValue`
    // no sabe serializar un nodo del DOM y contesta "la cadena de referencias es
    // demasiado larga", que no dice nada de lo que pasa.
    await tab.evaluate(
      `(() => { globalThis.__nodo = document.querySelector('[data-testid="panel-grid"]'); return true; })()`,
    );
    const libre = await hueco();
    if (!libre) throw new Error("el panel no tiene ningún sitio libre para apoyar el dedo");
    note(`hueco: ${libre.x},${libre.y}, a ${libre.d} px de la tarjeta más cercana`);
    await panelQuieto();
    /*
      Un reintento, y se dice si ha hecho falta.

      Mantener pulsado es un gesto de medio segundo sobre una superficie que además
      tiene un arrastre al lado, y hay veces que se pierde sin que nadie pueda decir
      por qué. Un caso que se queda con el primer intento informa de un problema que
      no existe; uno que reintenta y **lo cuenta** sigue vigilando y no esconde nada
      detrás de un reintento.
    */
    let dentro = false;
    let intentos = 0;
    for (intentos = 1; intentos <= 2 && !dentro; intentos += 1) {
      await touch(tab, libre, libre, { holdBefore: 750, holdAfter: 150, steps: 1 });
      await sleep(700);
      dentro = await tab.evaluate(`!!document.querySelector('[data-testid="panel-done"]')`);
      if (!dentro) {
        await tab.evaluate(`[...document.querySelectorAll('[data-testid="panel-done"]')][0]?.click()`);
        await sleep(600);
      }
    }
    check(
      "mantener pulsado el fondo empieza a colocar",
      dentro === true,
      intentos > 2 ? `hizo falta mas de un intento` : "",
    );
    if (intentos > 1) note(`el hold funcionó a la ${intentos - 1}a vez`);
    const mismoNodo = await tab.evaluate(
      `globalThis.__nodo === document.querySelector('[data-testid="panel-grid"]')`,
    );
    note(`el panel sigue siendo el mismo nodo: ${mismoNodo}`);
    const quien = await tab.evaluate(
      `document.elementFromPoint(${libre.x}, ${libre.y})?.closest('[data-testid="panel-background"]') ? 'el fondo' : 'otra cosa'`,
    );
    note(`debajo del dedo hay: ${quien}`);

    await touch(tab, libre, libre, { steps: 1 });
    await sleep(700);
    const fuera2 = await tab.evaluate(`!!document.querySelector('[data-testid="panel-done"]')`);
    check("y tocar el fondo lo termina", fuera2 === false);
  }

  /*
    "Arrastrar más allá de la última pantalla la crea" **no está aquí**.

    Está en `verify-panel-os.mjs`, y no por comodidad sino porque este panel no puede
    expresarlo: aquí hace falta una tarjeta **en la última** pantalla, y para que las
    comprobaciones anteriores tengan dónde empujar hace falta que las dos primeras
    pantallas tengan tarjetas. Con cuatro tarjetas y tres pantallas hay que elegir, y
    la creación de pantalla necesita la tercera.

    Sembrarla distinto arreglaba este caso y rompía los otros, y un recorrido que
    depende de qué tarjeta cae en qué pantalla se rompe cada vez que se toca la
    siembra. Separado, cada comprobación va sobre el panel que su gesto necesita, y
    si algo se rompe se sabe en cuál de los dos.
  */
} catch (error) {
  console.log(`\nFALLO LA CORRIDA: ${error.message}`);
  if (consola.length > 0) {
    console.log("consola de la pagina:");
    for (const linea of consola.slice(-12)) console.log(`  ${linea}`);
  }
  /*
    Si la página sigue contestando, el problema no es la página. Eso cambia dónde
    mirar: un panel que se ha colgado y un dedo que se ha quedado puesto se ven
    igual desde fuera, y se arreglan de manera distinta.
  */
  const viva = await tab
    ?.evaluate(
      `(() => ({
         panel: !!document.querySelector('[data-testid="panel-grid"]'),
         puntos: document.querySelectorAll('[data-testid^="panel-page-"]').length,
       }))()`,
    )
    .catch((e) => ({ error: e.message.slice(0, 90) }));
  console.log(
    `la pagina ${viva?.panel ? "sigue viva" : "no contesta"}: ${JSON.stringify(viva)}`,
  );
  try {
    await tab?.screenshot("verify/carry-fallo.png");
    console.log("captura: verify/carry-fallo.png");
  } catch {
    /* la pagina ya no estaba */
  }
  failures += 1;
} finally {
  tab?.close();
  chrome.kill();
}

if (reintentosDeEntrada > 0) {
  note(`el navegador dejó de acusar toques ${reintentosDeEntrada} veces y hubo que reintentarlos`);
}
console.log(failures === 0 ? "\ntodas las comprobaciones pasan" : `\n${failures} comprobaciones fallan`);
process.exit(failures === 0 ? 0 : 1);
