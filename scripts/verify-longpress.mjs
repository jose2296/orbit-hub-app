/**
 * The long-press sheet, looked at with the name it actually has to handle.
 *
 * The name this exists for is a film with a very long title, and the worst case is a
 * title that is long **and** has no poster, because there the poster stops being a
 * way of recognising the row and the text is all there is. So that is what gets
 * pressed.
 *
 * It checks the three things the request was about: that the text is drawn much
 * bigger than a card's, that it is not flush against the sheet's edges, and that it
 * still fits when it is long — because making it bigger is exactly what would make a
 * long title overflow, and a sheet whose purpose is to show a whole name that then
 * cuts it off has failed.
 */
import { chromium } from "/tmp/orbit-e2e/node_modules/playwright/index.mjs";

const WEB = process.env.WEB ?? "http://localhost:8083";
const API = process.env.API ?? "http://localhost:4001/api/v1";
const OUT = process.env.OUT ?? "/tmp/orbit-shots";
const SEED = JSON.parse(process.env.SEED);

const problems = [];
const note = (m) => { problems.push(m); console.log(`  ! ${m}`); };
const ok = (m) => console.log(`  \u2713 ${m}`);

const LARGO =
  "Vengadores: Endgame, y todo lo que se dijo despues (edicion extendida conAKE scenes deleted)";

async function api(email, password) {
  const s = await (
    await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, device: { label: "V", platform: "web" } }),
    })
  ).json();
  return s?.data?.session?.accessToken;
}

const token = await api(SEED.login.email, SEED.login.password);

// A film with a punishing title and no poster, which is the case where the text is
// the only thing that identifies the row.
const spaceId = SEED.spaceId;
const listId = crypto.randomUUID();
await fetch(`${API}/sync/push`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    deviceId: crypto.randomUUID(),
    lastPulledAt: null,
    operations: [
      { operationId: crypto.randomUUID(), clientId: "seed-client-longpress", baseVersion: 0,
        payload: { workspaceId: spaceId, folderId: null, title: "Titulos largos", kind: "movies", position: 3 },
        kind: "create", entity: "list", entityId: listId, clientTimestamp: new Date().toISOString() },
      { operationId: crypto.randomUUID(), clientId: "seed-client-longpress", baseVersion: 0,
        payload: { listId, title: LARGO, position: 0, externalId: "tmdb-largo",
          metadata: { type: "movie", provider: "tmdb", year: "2019", releaseDate: "2019-04-24" } },
        kind: "create", entity: "list_item", entityId: crypto.randomUUID(), clientTimestamp: new Date().toISOString() },
    ],
  }),
});
console.log(`- creada una pelicula con un titulo de ${LARGO.length} caracteres y sin cartel`);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});
const page = await (await browser.newContext({ viewport: { width: 430, height: 940 } })).newPage();

await page.goto(WEB, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.locator('text=/Iniciar sesión/').first().click();
await page.waitForTimeout(1400);
await page.locator('input[type="email"]').first().fill(SEED.login.email);
await page.locator('input[type="password"]').first().fill(SEED.login.password);
await page.locator('button:has-text("Iniciar sesión")').last().click();
await page.waitForTimeout(5000);
await page.waitForTimeout(9000);

await page.goto(`${WEB}/list/${listId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/40-titulo-corto.png` });
console.log("  · 40-titulo-corto.png (el titulo en su tarjeta, para comparar)");

// Pulsar largo sobre el texto. `mouse.down`, esperar mas que el delayLongPress y
// `mouse.up`: es el mismo gesto que hace un dedo y es lo que dispara el
// `onLongPress`.
const texto = page.locator(`text=${LARGO}`).first();
await texto.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
if (!(await texto.count())) {
  note("no aparece el titulo largo en la lista");
} else {
  const caja = await texto.boundingBox();
  if (!caja) note("no se pudo medir el titulo en pantalla");
  else {
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/41-titulo-completo.png` });
    console.log("  · 41-titulo-completo.png (el modal de pulsacion larga)");
  }

  const medida = await page.evaluate((textoLargo) => {
    // Todas las copias del titulo que hay en pantalla, y **la mas grande**. El titulo
    // aparece dos veces con el sheet abierto: en la tarjeta de detras, a 16px, y en el
    // sheet, a 32. Medir la primera que encuentre daba la de la tarjeta y decia que el
    // cambio no estaba hecho.
    const hojas = Array.from(document.querySelectorAll("div,span,p")).filter(
      (d) => (d.textContent || "").trim() === textoLargo && d.children.length === 0,
    );
    if (hojas.length === 0) return null;
    const puntos = hojas
      .map((nodo) => {
        const r = nodo.getBoundingClientRect();
        const cs = getComputedStyle(nodo);
        return {
          fontSize: parseFloat(cs.fontSize),
          lineHeight: parseFloat(cs.lineHeight),
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          nodo,
        };
      })
      .sort((a, b) => b.fontSize - a.fontSize);
    const mayor = puntos[0];

    return {
      copias: hojas.length,
      fontSize: mayor.fontSize,
      lineHeight: mayor.lineHeight,
      left: mayor.left,
      right: mayor.right,
      top: mayor.top,
      bottom: mayor.bottom,
      viewWidth: document.documentElement.clientWidth,
      viewHeight: window.innerHeight,
      // La hoja que lo envuelve, para saber si el texto se sale de ella.
      hoja: (() => {
        let p = mayor.nodo;
        while (p && p !== document.body) {
          const cs = getComputedStyle(p);
          if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
            const r = p.getBoundingClientRect();
            return {
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              alto: Math.round(r.height),
              desplazable: p.scrollHeight > p.clientHeight + 1,
            };
          }
          p = p.parentElement;
        }
        return null;
      })(),
    };
  }, LARGO);

  if (!medida) {
    note("el modal abrio pero no se encuentra el texto dentro");
  } else {
    console.log(`  ${JSON.stringify({ ...medida, hoja: Boolean(medida.hoja) })}`);
    console.log(`  copias del titulo en pantalla: ${medida.copias} (una en la tarjeta, otra en el sheet)`);
    if (medida.fontSize < 24) note(`el texto sale a ${medida.fontSize}px: se pedia mucho mas grande`);
    else ok(`el texto sale a ${medida.fontSize}px, frente a los 16px de una tarjeta`);
    const margenIzq = medida.left;
    const margenDer = medida.viewWidth - medida.right;
    if (margenIzq < 12 || margenDer < 12) {
      note(`el texto pega al borde: ${margenIzq}px a la izquierda y ${margenDer}px a la derecha`);
    } else {
      ok(`el texto tiene margen: ${margenIzq}px a cada lado`);
    }
    if (!medida.hoja) {
      note("el modal no se puede desplazar: un titulo largo se cortaria, que es justo lo que vino a evitar");
    } else {
      ok("el modal se puede desplazar");
      // Y que hoy no haga falta desplazarse es un dato, no una victoria: un titulo un
      // poco mas largo ya lo haria, y por eso la hoja se puede mover.
      if (medida.hoja.desplazable) {
        console.log(`  (la hoja necesita desplazamiento con este titulo: ${medida.hoja.alto}px de alto)`);
      }
    }
  }
}

// El mismo modal en oscuro, porque un texto grande sobre una superficie cualquiera
// es donde un color se pierde y no se nota en claro.
await page.evaluate(() => {
  window.localStorage.setItem("orbithub:appearance", JSON.stringify({ appearance: "dark", accent: "orbit" }));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
console.log(`  fondo en oscuro: ${fondo}`);
if (fondo === "rgb(246, 247, 251)") note("el tema oscuro no se aplica");

await page.goto(`${WEB}/list/${listId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
const t2 = page.locator(`text=${LARGO}`).first();
await t2.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
const c2 = await t2.boundingBox();
if (c2) {
  await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/42-titulo-oscuro.png` });
  console.log("  · 42-titulo-oscuro.png");
}

await browser.close();
console.log(`\n=== ${problems.length} problemas ===`);
for (const p of problems) console.log("- " + p);
