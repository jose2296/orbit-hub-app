/**
 * The whole social-and-sharing surface, walked in a browser by the person who owns
 * the things.
 *
 * Everything else this feature has is a test; this is the part where a person looks
 * at it. It signs in, and for each screen it checks three things a unit test cannot:
 * that the thing is **there**, that the thing that must **not** be there is **not**
 * there, and that nothing runs **off the edge** of the screen.
 *
 * The last one caught a badge that was unreadable on a colour band, so it is not
 * optional.
 *
 *   node scripts/verify-social.mjs
 */
import { chromium } from "/tmp/orbit-e2e/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const WEB = process.env.WEB ?? "http://localhost:8083";
const API = process.env.API ?? "http://localhost:4001/api/v1";
const OUT = process.env.OUT ?? "/tmp/orbit-shots";
const SEED = JSON.parse(process.env.SEED);

const problems = [];
const note = (m) => { problems.push(m); console.log(`  ! ${m}`); };
const ok = (m) => console.log(`  \u2713 ${m}`);
const step = (m) => console.log(`\n- ${m}`);

/** Only the right edge, and only things actually on screen. */
async function desborde(page, donde) {
  const malos = await page.evaluate(() => {
    const out = [];
    const w = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -w) continue;
      if (r.right > w + 1.5) out.push(`${el.tagName} right=${Math.round(r.right)}/${w}`);
    }
    return [...new Set(out)].slice(0, 5);
  });
  if (malos.length) note(`desborde a la derecha en ${donde}: ${malos.join(" | ")}`);
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name}.png`);
}

/** Clicks a button by its visible label, and says so plainly when it is not there. */
async function pulsa(page, texto, donde) {
  const b = page.locator(`button:has-text("${texto}"), [role="button"]:has-text("${texto}")`).first();
  if (!(await b.count())) { note(`no aparece "${texto}" en ${donde}`); return false; }
  await b.click({ timeout: 8000 }).catch(() => note(`el clic en "${texto}" (${donde}) no pudo`));
  await page.waitForTimeout(1400);
  return true;
}

async function entrar(page, email, password) {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const yaDentro = !(await page.locator('text=/Iniciar sesión/').count());
  if (yaDentro) return true;
  await page.locator('text=/Iniciar sesión/').first().click();
  await page.waitForTimeout(1400);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button:has-text("Iniciar sesión")').last().click();
  await page.waitForTimeout(5000);
  const sigue = await page.locator('text=/Demasiados intentos/').count();
  if (sigue) { note("el limite de intentos bloquea la verificacion"); return false; }
  const cuerpo = await page.locator("body").innerText();
  if (/Todo lo que necesitas/.test(cuerpo)) { note(`no se pudo entrar como ${email}`); return false; }
  return true;
}

async function insignia(page, testId = "shared-badge") {
  return page.locator(`[data-testid="${testId}"]`);
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});
const ctx = await browser.newContext({ viewport: { width: 430, height: 940 } });
const page = await ctx.newPage();
/**
 * The app is configured for port 4000, which belongs to another piece of work, so
 * the calls are redirected from the browser to the API this script seeded. The same
 * reason and the same refusal to touch anyone's env — the repo `.env.local` says in
 * writing not to put that variable there.
 */
const REAL = process.env.API_ORIGIN ?? "http://localhost:4002";
const DECLARADO = "http://localhost:4000";
await page.route(`${DECLARADO}/**`, async (route) => {
  await route.continue({ url: route.request().url().replace(DECLARADO, REAL) });
});

const errores = [];
page.on("pageerror", (e) => errores.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });

step(`entrar como ${SEED.login.email}`);
if (!(await entrar(page, SEED.login.email, SEED.login.password))) {
  console.log("\nNo se pudo entrar; se aborta.");
  await browser.close();
  process.exit(1);
}
// El sincronizador necesita su turno antes de que las pantallas tengan nada.
await page.waitForTimeout(9000);

// ---- 1. el menu lateral tiene Gente -----------------------------------------
step("el menu lateral ofrece Gente");
// The real test ids, read out of `drawer.tsx`. `header button` and
// `[role="banner"]` are not on this page on the web — there is no header element
// and no banner role — so both selectors waited thirty seconds on nothing.
await page.locator('[data-testid="drawer-button"]').first().click({ timeout: 10000 });
await page.waitForTimeout(2000);
const menu = await page.locator('[data-testid="drawer-panel"]').innerText().catch(() => "");
if (/Gente/.test(menu)) ok("Gente esta en el menu"); else note("Gente no esta en el menu lateral");
// No se comprueba la bandeja "Compartido conmigo": se dibuja solo cuando hay algo
// sin colocar, y Ana es duena de todo lo sembrado, asi que no recibe nada y
//correcto que no aparezca. Reclamar su presencia aqui seria un fallo del guion,
// no de la app.
await shot(page, "20-menu-gente");
// El menu abierto empuja la pantalla en web en vez de taparla, asi que el ancho de lo
// que hay detras no es el ancho del menu y el chequeo de desborde aqui mide otra
// cosa. Se salta.
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
await page.locator('[data-testid="drawer-button"]').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1200);

// ---- 2. Gente ----------------------------------------------------------------
step("la pantalla de Gente");
await page.goto(`${WEB}/people`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
let cuerpo = await page.locator("body").innerText();

if (/Carla/.test(cuerpo)) ok("Carla sale"); else note("Carla no sale en Gente");
if (/Beto/.test(cuerpo)) ok("Beto sale"); else note("Beto no sale en Gente");
if (/Dolo/.test(cuerpo)) note("Dolo sale y no deberia: no tiene relacion ninguna"); else ok("Dolo NO sale, como debe ser");
if (/Le has compartido algo/.test(cuerpo)) ok("dice por que aparece Carla"); else note("no dice por que aparece la gente");
if (/Compartís espacio/.test(cuerpo)) ok("Carla sale con las dos razones"); else note("Carla solo sale con una razon");
await shot(page, "21-gente");
await desborde(page, "gente");

step("el buscador de Gente filtra");
const campo = page.locator('input[placeholder*="Nombre"], input[placeholder*="nombre"]').first();
if (await campo.count()) {
  await campo.fill("carla");
  await page.waitForTimeout(1000);
  cuerpo = await page.locator("body").innerText();
  if (/Carla/.test(cuerpo) && !/Beto/.test(cuerpo)) ok("el buscador deja solo a Carla");
  else note("el buscador de Gente no filtra como debe");
  await shot(page, "22-gente-buscado");
  await campo.fill("");
  await page.waitForTimeout(600);
} else {
  note("no hay campo de busqueda en Gente");
}

// ---- 3. el espacio ------------------------------------------------------------
step("el espacio dice si es tuyo");
await page.goto(`${WEB}/workspace/${SEED.spaceId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
cuerpo = await page.locator("body").innerText();
if ((await page.locator('[data-testid="shared-badge"]').count()) === 0) ok("el espacio ya no lleva insignia arriba"); else note("el espacio vuelve a llevar insignia arriba");
await shot(page, "23-espacio");
await desborde(page, "espacio");

// ---- 4. la nota ---------------------------------------------------------------
step("la nota dice si es tuya");
await page.goto(`${WEB}/note/${SEED.noteId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
cuerpo = await page.locator("body").innerText();
if ((await page.locator('[data-testid="shared-badge"]').count()) === 0) ok("la nota ya no lleva insignia arriba"); else note("la nota vuelve a llevar insignia arriba");
await shot(page, "24-nota");
await desborde(page, "nota");

// ---- 5. compartir desde el menu de la nota -----------------------------------
step("compartir una nota con una persona del directorio");
// The header's right slot, which is where the note's menu button is published. Found
// by walking the buttons backwards and stopping at the one that opens the menu, since
// the slot has no stable id of its own.
let botones = page.locator("button");
for (let i = (await botones.count()) - 1; i >= 0; i -= 1) {
  await botones.nth(i).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (/Renombrar/.test(await page.locator("body").innerText())) break;
}
await shot(page, "25-menu-nota");

if ((await page.locator('[data-testid="shared-badge"]').count()) > 0) ok("el menu de la nota lleva la insignia");
else note("el menu de la nota no lleva insignia: es donde vive ahora");
if (/Con quién/.test(await page.locator("body").innerText())) ok("el menu ofrece compartir"); else note("el menu NO ofrece compartir");
await pulsa(page, "Con quién", "el menu de la nota");
await page.waitForTimeout(2200);
cuerpo = await page.locator("body").innerText();
await shot(page, "26-compartir-nota");
await desborde(page, "compartir");

if (/Carla/.test(cuerpo)) ok("el selector lista a Carla"); else note("el selector no lista a Carla");
if (/Beto/.test(cuerpo)) ok("el selector lista a Beto"); else note("el selector no lista a Beto");

// "Ya lo tiene" tiene que aparecer **solo** para quien ya la tiene, y no puede
// aparecer para nadie mas. Antes esto marcaba como problema cualquier aparicion, y
// Beto la tiene de verdad porque la siembra se la compartio: el guion estaba
//probando que el boton mas repetible de la app se niegue a repetir.
const filaBeto = page.locator('[role="radio"]:has-text("Beto")').first();
const filaCarla = page.locator('[role="radio"]:has-text("Carla")').first();
const betoLoTiene = (await filaBeto.innerText().catch(() => "")) ?? "";
const carlaLoTiene = (await filaCarla.innerText().catch(() => "")) ?? "";
if (/Ya lo tiene/.test(betoLoTiene)) ok("Beto sale como 'Ya lo tiene', que es verdad");
else note("Beto ya tiene la nota y su fila no lo dice");
if (/Ya lo tiene/.test(carlaLoTiene)) note("Carla sale como 'Ya lo tiene' sin tenerla");
else ok("Carla, que no la tiene, se puede elegir");

step("elegir a Dolo por su correo, que es la salida");
const campoCorreo = page.locator('input[type="email"]').first();
if (await campoCorreo.count()) {
  await campoCorreo.fill(SEED.dolo.email);
  await page.waitForTimeout(1200);
  const trasEscribir = await page.locator("body").innerText();
  if (/Dolo/.test(trasEscribir)) note("Dolo aparece en el selector escribiendo su correo: el directorio no deberia buscarla fuera");
  else ok("Dolo no sale: el directorio no busca fuera de tus relaciones");
  await campoCorreo.fill("");
  await page.waitForTimeout(600);
} else {
  note("no hay campo de correo en el panel de compartir");
}

step("compartir de verdad con Carla");
const carla = page.locator('[role="radio"]:has-text("Carla")').first();
if (await carla.count()) {
  await carla.click({ timeout: 6000 }).catch(() => note("no se pudo tocar la fila de Carla"));
  await page.waitForTimeout(1000);
  await shot(page, "27-persona-elegida");
  await pulsa(page, "Compartir", "el panel de compartir");
  await page.waitForTimeout(3000);
  await shot(page, "28-compartido");
  // No se busca un texto de confirmacion porque en esta via **no hay ninguna**: el
  // formulario es una pagina del menu de la nota, y al terminar se cierra el menu.
  // La unica prueba de que se compartio es la que viene ahora, en la API. Un panel
  // que cerrandose dejase un "compartido" durante un segundo informa peor, no mejor.
  cuerpo = await page.locator("body").innerText();
  if (/Renombrar/.test(cuerpo)) ok("el menu se cerro al compartir, como debe");
  else console.log("  (el menu sigue abierto: se comprueba por la API igualmente)");
} else {
  note("no se pudo elegir a nadie del selector");
}

// ---- 6. que lo compartido existe de verdad ----------------------------------
step("comprobar en la API que Carla lo tiene ahora");
{
  const s = await (await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SEED.carla.email, password: SEED.carla.password, device: { label: "V", platform: "web" } }),
  })).json();
  const token = s?.data?.session?.accessToken;
  const reach = await (await fetch(`${API}/shares/note/${SEED.noteId}/reach`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const correos = (reach?.data?.people ?? []).map((p) => p.email);
  if (correos.includes(SEED.carla.email)) ok(`el servidor dice que Carla tiene la nota (${correos.length} personas)`);
  else note(`la API dice que la nota la tienen: ${correos.join(", ") || "nadie"} — se esperaba a Carla`);
}

// ---- 7. la lista --------------------------------------------------------------
step("la lista dice si es tuya y se puede compartir");
await page.goto(`${WEB}/list/${SEED.listId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
cuerpo = await page.locator("body").innerText();
if ((await page.locator('[data-testid="shared-badge"]').count()) === 0) ok("la lista ya no lleva insignia arriba"); else note("la lista vuelve a llevar insignia arriba");
await shot(page, "29-lista");
await desborde(page, "lista");

// ---- 8. la carpeta ------------------------------------------------------------
step("la carpeta se puede compartir");
await page.goto(`${WEB}/workspace/${SEED.spaceId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
// El boton de opciones de la fila, no la fila. Una fila de contenido **no** se abre
// al tocarla: lleva sus puntos suspensivos, y ahi es donde vive el menu con la pagina
// de compartir. El guion estaba pulsando la carpeta y esperando que se abriera, que
// no es lo que hace.
const filaCarpeta = page.locator('text=Vacaciones').first();
let abiertoCarpeta = false;
if (await filaCarpeta.count()) {
  // Por su etiqueta accesible, "Acciones de Vacaciones", y no buscandolo por
  // posicion respecto al nombre. La fila tambien se llama "Vacaciones" y el boton de
  // sus puntos suspensivos esta en el mismo sitio, asi que medir "el boton que esta
  // thirty pixels mas abajo" acierta a veces y falla las demas segun como se monte
  // la pantalla. La etiqueta no cambia.
  const EN_MENU = /Renombrar|Crear lista aquí|Eliminar la carpeta/;
  const menu = page
    .locator('[aria-label*="Acciones de"][aria-label*="Vacaciones"]')
    .first();
  if (await menu.count()) {
    await menu.click({ timeout: 8000 }).catch(() => note("el clic en Acciones de no pudo"));
    await page.waitForTimeout(1800);
    abiertoCarpeta = EN_MENU.test(await page.locator("body").innerText());
  } else {
    note('no se encuentra el boton "Acciones de Vacaciones"');
  }
  if (abiertoCarpeta) {
    ok("el menu de la carpeta se abre");
    await shot(page, "30-menu-carpeta");
    const cuerpoCarpeta = await page.locator("body").innerText();
    if (/Con quién/.test(cuerpoCarpeta)) ok("la carpeta ofrece compartir");
    else note("el menu de la carpeta no ofrece compartir");
    if ((await page.locator('[data-testid="shared-badge"]').count()) > 0) {
      ok("la carpeta muestra insignia de propiedad");
    } else {
      note("el menu de la carpeta no lleva insignia");
    }
    // Y la pagina de compartir abre y lista a la gente.
    if (await pulsa(page, "Con quién", "el menu de la carpeta")) {
      await page.waitForTimeout(2000);
      await shot(page, "30b-compartir-carpeta");
      const enPanel = await page.locator("body").innerText();
      if (/Carla|Beto/.test(enPanel)) ok("compartir una carpeta lista a la gente");
      else note("compartir una carpeta no lista a nadie");
      await desborde(page, "compartir carpeta");
    }
  } else {
    note("no se pudo abrir el menu de la carpeta");
  }
} else {
  note("no se encuentra la carpeta en el espacio");
}

// ---- 9. el modal de reordenar --------------------------------------------------
step("el modal de reordenar: cada pelicula con su ano, sin que el ano se esconda");
await page.goto(`${WEB}/list/${SEED.peliculasId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await shot(page, "31-peliculas");
// "Ordenar" ya no es un boton suelto: los controles de una lista se agruparon en
// uno ("Filtrar · A mano") y lo de reordenar vive dentro. El boton se llama igual.
const suelto = await page.locator('button:has-text("Ordenar")').count();
if (suelto === 0) console.log('  (no hay boton suelto: vive dentro del control unico, como debe)');

let abierto = false;
if (suelto > 0) {
  abierto = await pulsa(page, "Ordenar", "la lista de peliculas");
} else {
  const control = page.locator('[data-testid="media-controls"] button, button:has-text("Filtrar")').first();
  if (await control.count()) {
    await control.click({ timeout: 8000 }).catch(() => note("no se pudo abrir el control unico"));
    await page.waitForTimeout(1800);
    await shot(page, "31b-controles");
    abierto = await pulsa(page, "Ordenar", "el control de la lista");
  } else {
    note("no se encuentra ningun control para filtrar y ordenar la lista");
  }
}
if (abierto) {
  await page.waitForTimeout(2500);
  await shot(page, "32-reordenar");
  await desborde(page, "modal de reordenar");

  const filas = await page.locator('[data-testid^="reorder-row-"]').count();
  if (filas >= 3) ok(`el modal lista las ${filas} peliculas`); else note(`el modal lista ${filas} peliculas, se esperaban 3`);

  // El ano tiene que leerse Y no puede estar debajo del asa: se comprueba que el
  // texto del ano cae a la izquierda del asa, que es lo unico que se ensures.
  const mesure = await page.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('[data-testid^="reorder-row-"]'));
    return filas.map((f) => {
      const textos = Array.from(f.querySelectorAll('div')).map((d) => (d.textContent || "").trim());
      const r = f.getBoundingClientRect();
      const ano = textos.find((t) => /^(19|20)\d{2}$/.test(t));
      const caja = ano ? (() => {
        for (const d of f.querySelectorAll("div")) {
          if ((d.textContent || "").trim() === ano) return d.getBoundingClientRect();
        }
        return null;
      })() : null;
      return { ano: ano ?? null, derecha: caja ? Math.round(caja.right) : null, fila: Math.round(r.right) };
    });
  });
  console.log(`  anos: ${JSON.stringify(mesure)}`);
  const sinAno = mesure.filter((m) => !m.ano);
  if (sinAno.length) note(`${sinAno.length} filas sin ano visible en el modal de reordenar`);
  const debajoDelAsa = mesure.filter((m) => m.derecha !== null && m.fila !== null && m.derecha > m.fila - 34);
  if (debajoDelAsa.length) note(`el ano se mete debajo del asa de arrastrar en ${debajoDelAsa.length} filas`);
  if (!sinAno.length && !debajoDelAsa.length) ok("cada fila enseña su ano y queda a la izquierda del asa");
}

// ---- resumen ------------------------------------------------------------------
const ruido = errores.filter((e) => !/favicon|manifest|DevTools|source map|Failed to load resource.*favicon/i.test(e));
if (ruido.length) note(`errores de consola: ${ruido.slice(0, 4).join(" | ")}`);

await browser.close();
writeFileSync(`${OUT}/social.json`, JSON.stringify({ problems }, null, 2));
console.log(`\n=== ${problems.length} problemas ===`);
for (const p of problems) console.log("- " + p);
