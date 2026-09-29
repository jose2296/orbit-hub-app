import { readFile } from "node:fs/promises";
import { launchChrome, openTab, seedSession } from "./cdp.mjs";

/**
 * Does the panel show one screen, or does the track leak?
 *
 * `verify-panel-pager.mjs` answers "does the page arrive with the gesture", and it
 * measures visibility against the **track**. That is the wrong box: the track is
 * as wide as every screen side by side, so a neighbour sitting 30px outside the
 * window still counts as visible to it. The question is narrower — while the
 * panel is at rest, is any part of another screen on screen — and it can only be
 * answered against the box that clips.
 *
 * Which is why this checks the clip and not the rectangles. `getBoundingClientRect`
 * reports layout and does not know about `overflow`, so a screen that is clipped
 * away still measures 16px inside the window, and a check written on rectangles
 * either fails forever or has to be loosened until it means nothing. The board is
 * the box one screen wide that everything else is painted inside, so the thing
 * worth asserting is that it clips, and that the track cannot get outside it.
 */
const APP = process.env.APP_URL ?? "http://localhost:8081";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};

const chrome = await launchChrome({ width: 390, height: 844 });
let tab;
try {
  const session = JSON.parse(await readFile("/private/tmp/orbit-size-session.json", "utf8"));
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
  if (!ready) {
    const diag = await tab.evaluate(`(() => ({ url: location.pathname, head: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,160) }))()`);
    throw new Error(`el panel no aparecio — ${JSON.stringify(diag)}`);
  }
  await sleep(1500);

  const r = await tab.evaluate(`
    (() => {
      const track = document.querySelector('[data-testid="panel-grid"]');
      // The track's parent is a display:contents wrapper from the GestureDetector,
      // which has a 0x0 box. The board is the one after it, and it is the box one
      // screen wide.
      const board = track.parentElement.parentElement;
      const cs = getComputedStyle(board);
      const br = board.getBoundingClientRect();
      const tr = track.getBoundingClientRect();
      return {
        window: window.innerWidth,
        boardWidth: Math.round(br.width),
        boardOverflowX: cs.overflowX,
        boardOverflowY: cs.overflowY,
        trackWidth: Math.round(tr.width),
        // How far the track sticks out past the box that is supposed to hide it.
        trackEscapesBy: Math.round(tr.right - br.right),
        screens: [...track.querySelectorAll('[data-testid^="panel-screen-"]')].map((s) => {
          const rect = s.getBoundingClientRect();
          return { slot: s.getAttribute('data-testid'), left: Math.round(rect.left), right: Math.round(rect.right) };
        }),
        here: [...document.querySelectorAll('[data-testid^="panel-page-"]')]
          .findIndex((d) => d.getAttribute('data-testid') === 'panel-page-current'),
      };
    })()
  `);

  console.log(`      ventana ${r.window} · tablero ${r.boardWidth} · track ${r.trackWidth} · overflow ${r.boardOverflowX}/${r.boardOverflowY}`);
  console.log(`      pantallas montadas: ${r.screens.map((s) => `${s.slot}@${s.left}..${s.right}`).join("  ")}`);
  check(
    "el tablero recorta a una pantalla",
    r.boardOverflowX === "hidden" && r.boardOverflowY === "hidden",
    `overflow ${r.boardOverflowX}/${r.boardOverflowY}`,
  );
  check(
    "y el track es mas ancho que el tablero, o sea que lo que recorta es el tablero",
    r.trackWidth > r.boardWidth,
    `track ${r.trackWidth} contra tablero ${r.boardWidth}`,
  );
  check(
    "el track se sale del tablero por el lado que el recorte tiene que tapar",
    r.trackEscapesBy > 0,
    `se sale ${r.trackEscapesBy}px por la derecha`,
  );

  // The picture, because a clip is a claim about pixels. Openable by a person, and
  // the only thing that says for certain that nothing is painted past the edge.
  await tab.screenshot("/private/tmp/orbit/clipping/en-reposo.png");

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} COMPROBACIONES FALLIDAS`);
} catch (error) {
  console.log("fallo:", error.message);
  failures += 1;
} finally {
  tab?.close();
  await chrome.kill();
}
