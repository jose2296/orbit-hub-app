import { launch } from "chrome-launcher";

/**
 * Chrome by CDP, for driving the app in a real browser.
 *
 * The doc (docs/verificacion-en-navegador.md) says there is a `cdp.mjs` harness
 * and there is not one in the repo, so this is it. It exists because the typecheck
 * and the tests both pass on a screen that does not render — the bug that started
 * this was a `GestureDetector` with two children, which compiles, passes every
 * test, and throws the moment the panel is drawn.
 */

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Chrome with the flags a driven browser needs and a person does not want.
 *
 * It returns `{ port, kill }` and not the launcher object, because the launcher
 * resolves to a `Launcher` instance whose `toString` is `[object Object]` — and a
 * `new URL()` on that is a very confusing "Invalid URL".
 */
/**
 * `extraFlags` is for the checks that need the browser pointed somewhere else —
 * a proxy, a host rule — without changing what the app under test is.
 */
export async function launchChrome({
  port = 9222,
  width = 430,
  height = 932,
  extraFlags = [],
} = {}) {
  const chrome = await launch({
    chromePath: CHROME,
    port,
    chromeFlags: [
      "--headless=new",
      `--window-size=${width},${height}`,
      // Without this the window flag is ignored and the page comes up at
      // whatever size the last window was, which is how a "phone" check ends up
      // measuring a laptop.
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      ...extraFlags,
    ],
  });
  return { port: chrome.port, kill: () => chrome.kill() };
}

/**
 * A CDP session on a tab, with the page-side helpers this app needs.
 *
 * The argument is the debug port, not a URL and not a launcher: `chrome-launcher`
 * hands back `{ pid, port, kill, process }` and reading the port out of a
 * `new URL(launcher)` is an `Invalid URL` that reads like the harness is broken.
 */
export async function openTab(debugPort) {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: "PUT",
  });
  const target = await res.json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result);
      return;
    }
    for (const handler of listeners.get(message.method) ?? []) {
      handler(message.params);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const on = (method, handler) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(handler);
  };

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    }
    return result.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");

  /**
   * The browser talks to the API on this machine, whatever the app was built with.
   *
   * `apps/mobile/.env.local` points `EXPO_PUBLIC_API_URL` at `10.0.2.2:4000`,
   * which is the alias the **Android emulator** uses to reach the host. It is the
   * right value for a phone and the wrong one for a browser on this Mac, where
   * the address simply does not resolve. The consequence is quiet and nasty: the
   * app renders from its cache, the write lands locally, and the request never
   * reaches the API — so the log of the API shows **no request at all** and a
   * verification run reports a broken sync when the truth is that it never sent
   * anything.
   *
   * Three things were tried before this and none of them work, which is why this
   * is here and not a note in the README:
   *
   * - Exporting `EXPO_PUBLIC_API_URL` in the shell does not help. Measured, not
   *   assumed: with the variable exported and a second Metro running, the API log
   *   recorded zero requests from a browser.
   * - Starting a second Metro does not help either, for the same reason.
   * - Rewriting `.env.local` **would** work, and it would break the emulator,
   *   which is the one thing that address is for. So the file is left alone and
   *   the redirect goes where the wrong value is harmless: in the browser.
   *
   * `addScriptToEvaluateOnNewDocument` and not an `evaluate` after the fact,
   * because the first request the app makes happens before anybody gets a chance
   * to patch anything, and a patch installed after a `goto` is gone after the
   * next one.
   *
   * Both hosts are this same machine, so nothing is faked: the app, the code and
   * the API are the real ones, and only the address changes.
   *
   * **Y esto es un apaño de las comprobaciones, no la solución.** La solución es
   * `apps/mobile/src/lib/api/host.ts`, que trabaja el host por plataforma y es lo
   * que hace que la misma dirección sirva para el navegador, el simulador y el
   * emulador. Con ese módulo, poner `EXPO_PUBLIC_API_URL=http://localhost:4000` en
   * el `.env.local` lo arregla todo y este bloque sobra: se puede borrar entero.
   * Está aquí porque el `.env.local` es de quien lo tiene y cambiarlo no es cosa
   * de un script, y duplicar una solución buena en la herramienta de pruebas es
   * peor que tener un apaño declarado como tal.
   */
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        const real = window.fetch;
        const url = (entrada) =>
          typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
        const mover = (destino) => (entrada, init) => {
          if (typeof entrada === "string") {
            return real(entrada.replace("10.0.2.2:4000", destino), init);
          }
          if (entrada && entrada.url && entrada.url.indexOf("10.0.2.2:4000") >= 0) {
            return real(entrada.url.replace("10.0.2.2:4000", destino), init);
          }
          return real(entrada, init);
        };
        window.fetch = mover("localhost:4000");
        // Y lo mismo para XHR, por si un camino usa el otro.
        const abrir = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (metodo, ruta, ...resto) {
          return abrir.call(this, metodo, String(ruta).replace("10.0.2.2:4000", "localhost:4000"), ...resto);
        };
      })();
    `,
  });

  return {
    targetId: target.id,
    send,
    on,
    evaluate,
    close: () => ws.close(),
    /**
     * A picture of what is on screen, right now.
     *
     * For the gestures that cannot be checked by reading numbers. A resize that
     * animates and a page that arrives with the swipe are both claims about what
     * the eye sees between two instants, and a measurement taken after the fact
     * says nothing about either. A file on disk that a person can open is the only
     * way to look at the middle of a gesture.
     *
     * The viewport and not the full page: the panel fills the window and has no
     * scroll, so anything below the fold belongs to a different story.
     */
    async screenshot(path) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
      await writeFile(path, Buffer.from(data, "base64"));
      return path;
    },
    /**
     * Navigate and wait for the app, not for a fixed time.
     *
     * `document.readyState === 'complete'` is true for an error page too, so it
     * is not enough on its own: a navigation that lands somewhere without an
     * origin has a complete document and throws `SecurityError` on every
     * `localStorage` read afterwards, which looks exactly like a bug in the app.
     * So the wait also requires a same-origin document, and the seed below
     * checks it before it writes anything.
     */
    async goto(url, { readyExpression = "document.readyState === 'complete'" } = {}) {
      await send("Page.navigate", { url });
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          const ready = await evaluate(
            `(() => {
              if (${readyExpression} !== true) return false;
              try { return location.origin !== 'null' && !!location.origin; }
              catch { return false; }
            })()`,
          );
          if (ready) return;
        } catch {
          // A navigation in flight throws on evaluate; that is the point.
        }
      }
      throw new Error(`la pagina no llego a estar lista: ${url}`);
    },
  };
}

/**
 * Puts a session where the app looks for it.
 *
 * The tokens go in the three keys the app reads, which is the whole contract
 * between the app and the browser: it restores from storage on boot, so writing
 * them before the second load is what makes the app come up signed in without
 * driving the sign-up form.
 */
export async function seedSession(tab, session, appUrl) {
  const write = () => tab.evaluate(`
    (() => {
      localStorage.setItem("orbithub:access-token", ${JSON.stringify(session.accessToken)});
      localStorage.setItem("orbithub:refresh-token", ${JSON.stringify(session.refreshToken)});
      localStorage.setItem("orbithub:session-meta", JSON.stringify({
        expiresIn: ${JSON.stringify(session.expiresIn)},
        issuedAt: Date.now(),
        user: ${JSON.stringify(session.user)},
        device: ${JSON.stringify(session.device ?? null)},
      }));
      return true;
    })()
  `);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await tab.goto(appUrl);
    const origin = await tab.evaluate("location.origin");
    if (!origin || origin === "null") {
      throw new Error(
        `la pagina no tiene origen (${origin}), asi que localStorage no existe. ` +
          "Suele pasar cuando la navegacion anterior dejo una pagina de error.",
      );
    }
    await write();

    // Loaded and checked, not written and trusted.
    //
    // The app boots anonymous on that first load and clears the session keys on
    // its way past, which lands *after* the write and silently undoes it — so a
    // script that writes once and reloads lands on the welcome screen and
    // concludes the panel is broken. Verified, retried, and only then believed.
    await tab.goto(appUrl);
    const survived = await tab.evaluate(
      "localStorage.getItem('orbithub:access-token') === " +
        JSON.stringify(session.accessToken),
    );
    if (survived) return;

    // Give the app a moment to finish deciding, then write over whatever it did.
    await new Promise((r) => setTimeout(r, 1500));
    await write();
  }

  throw new Error(
    "la sesion no sobrevive a la carga de la app: la borra al arrancar. " +
      "Se ha reescrito tres veces.",
  );
}

/**
 * The console errors, unhandled rejections and failed requests of a session.
 *
 * The rule from the doc: a console error is a bug even when the screen looks
 * right, so this collects and the script fails on it.
 */
export function collectProblems(tab) {
  const problems = [];

  tab.on("Runtime.consoleAPICalled", (params) => {
    if (params.type !== "error") return;
    const text = (params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? "")
      .join(" ");
    if (text.includes("Download the React DevTools")) return;
    problems.push({ kind: "console", text });
  });

  tab.on("Runtime.exceptionThrown", (params) => {
    problems.push({
      kind: "exception",
      text:
        params.exceptionDetails?.exception?.description ??
        params.exceptionDetails?.text ??
        "excepción sin texto",
    });
  });

  tab.on("Log.entryAdded", (params) => {
    if (params.entry.level !== "error") return;
    problems.push({ kind: "log", text: params.entry.text });
  });

  tab.on("Network.responseReceived", (params) => {
    if (params.response.status < 400) return;
    problems.push({
      kind: "http",
      text: `${params.response.status} ${params.response.url}`,
    });
  });

  return problems;
}

/** A button by the name a person would read, without the icon glph inside it. */
export const FIND = `
  (name) => {
    const clean = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
    const wanted = clean(name);
    const all = [...document.querySelectorAll("button, [role=button], a")];
    return all.filter((el) => {
      const label =
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.textContent ||
        "";
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return clean(label).toLowerCase().includes(wanted.toLowerCase());
    });
  }
`;
