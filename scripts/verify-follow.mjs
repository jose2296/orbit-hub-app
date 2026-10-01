/**
 * Following somebody, and the header bug, in a browser.
 *
 * Two things that only exist on screen:
 *
 * 1. **The three dots.** Open a film, then go to People: the header used to keep the
 *    film's button, and pressing it opened the film's options on a screen you had
 *    left. `useHeaderAction` cleared on unmount, and a stack never unmounts the
 *    screen underneath, so the button stayed. Checked here by leaving a list screen
 *    with a button, going to People, and asking whether the button is still there.
 *
 * 2. **Following.** Search somebody who has no relation with you, add them, and see
 *    them arrive in the directory and then in the share picker — which is the whole
 *    point of the feature and the only part of it a server test cannot show.
 */
import { chromium } from "/tmp/orbit-e2e/node_modules/playwright/index.mjs";

const WEB = process.env.WEB ?? "http://localhost:8085";
const API = process.env.API ?? "http://localhost:4002/api/v1";
const OUT = process.env.OUT ?? "/tmp/orbit-shots2";
const SEED = JSON.parse(process.env.SEED);

const problems = [];
const note = (m) => { problems.push(m); console.log(`  ! ${m}`); };
const ok = (m) => console.log(`  \u2713 ${m}`);
const step = (m) => console.log(`\n- ${m}`);

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  \u00b7 ${name}.png`);
}

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});
const page = await (await browser.newContext({ viewport: { width: 430, height: 940 } })).newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(e.message));

/**
 * The app is pointed at port 4000 by its own configuration, and that port belongs to
 * another piece of work. Instead of touching anyone's env — the repo `.env.local`
 * says, in writing, not to put this variable there — the calls are **redirected** from
 * the browser to the API this check seeded.
 *
 * A first version of this script did not redirect, and every search came back empty
 * because it was asking an API that has no search route. Which it drew as
 * "Nobody by that" — and that is why `people.tsx` now distinguishes a failed search
 * from an empty one: it is exactly the answer somebody would read as "that person
 * has no account here".
 */
const REAL = process.env.API_ORIGIN ?? "http://localhost:4002";
const DECLARADO = "http://localhost:4000";
await page.route(`${DECLARADO}/**`, async (route) => {
  await route.continue({ url: route.request().url().replace(DECLARADO, REAL) });
});

// ---------------------------------------------------------------- entrar ----
step(`entrar como ${SEED.login.email}`);
await page.goto(WEB, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.locator('text=/Iniciar sesión/').first().click();
await page.waitForTimeout(1500);
await page.locator('input[type="email"]').first().fill(SEED.login.email);
await page.locator('input[type="password"]').first().fill(SEED.login.password);
await page.locator('button:has-text("Iniciar sesión")').last().click();
await page.waitForTimeout(5000);
await page.waitForTimeout(8000);

// ------------------------------------------------------- el bug del header ---
step("los 3 puntitos de una pantalla no se quedan en la siguiente");
{
  // Una pantalla que publica un boton en la cabecera: una lista de peliculas con su
  // menu de fila, o la propia nota con el suyo. Cualquiera vale; lo que importa es
  // que la siguiente pantalla **no** lo herede.
  await page.goto(`${WEB}/list/${SEED.peliculasId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const botones = page.locator("button");
  const antes = await botones.count();
  await shot(page, "50-lista-con-boton");

  await page.goto(`${WEB}/people`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const despues = await botones.count();
  // El boton se va al perder el foco, no al desmontar. En un stack la pantalla de
  // abajo sigue montada, y por eso antes se quedaba.
  if (despues < antes) ok(`el boton se fue al cambiar de pantalla (${antes} -> ${despues} botones)`);
  else note(`el header conserva botones de la pantalla anterior (${antes} -> ${despues})`);

  const cuerpo = await page.locator("body").innerText();
  if (/Acciones de/.test(cuerpo)) note("la pantalla de Gente muestra el menu de acciones de una fila de la lista anterior");
  else ok("Gente no muestra ningun menu de la pantalla anterior");
  await shot(page, "51-gente-sin-boton-ajeno");
}

// ------------------------------------------------------------- seguir -------
step("buscar a alguien con quien no tienes nada y anadirlo");
{
  const campo = page.locator('input[placeholder*="Nombre"], input[placeholder*="nombre"]').first();
  if (!(await campo.count())) {
    note("no hay campo de busqueda en Gente");
  } else {
    // Con dos letras tiene que decir que faltan letras, no "nadie con eso": son dos
    // respuestas distintas y la app las pinta distinto.
    await campo.fill("el");
    await page.waitForTimeout(1200);
    let cuerpo = await page.locator("body").innerText();
    if (/al menos tres letras/.test(cuerpo)) ok("con dos letras avisa de que faltan letras");
    else note("con dos letras no avisa: el piso de tres no se explica");
    await shot(page, "52-corto");

    await campo.fill(SEED.elena.email);
    await page.waitForTimeout(2500);
    cuerpo = await page.locator("body").innerText();
    if (/Elena/.test(cuerpo)) ok("encuentra a Elena, con quien no tiene relacion");
    else note("no encuentra a Elena");
    await shot(page, "53-busqueda");

    const anadir = page.locator('button:has-text("Añadir")').first();
    if (await anadir.count()) {
      await anadir.click({ timeout: 8000 }).catch(() => note("no se pudo pulsar Añadir"));
      await page.waitForTimeout(2500);
      cuerpo = await page.locator("body").innerText();
      if (/La sigues/.test(cuerpo)) ok("sale en el directorio con 'La sigues'");
      else note("no sale en el directorio como seguida");
      await shot(page, "54-anadida");
    } else {
      note('no aparece el boton "Añadir" para la persona encontrada');
    }
  }
}

// ------------------------------------------- y sale al selector de compartir --
step("y sale al selector de compartir");
{
  await page.goto(`${WEB}/note/${SEED.noteId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  const botones = page.locator("button");
  const total = await botones.count();
  for (let i = total - 1; i >= 0; i -= 1) {
    await botones.nth(i).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1100);
    if (/Renombrar/.test(await page.locator("body").innerText())) break;
  }
  const compartir = page.locator('text=/Con quién/').first();
  if (!(await compartir.count())) {
    note("no se abrio el panel de compartir de la nota");
  } else {
    await compartir.click();
    await page.waitForTimeout(2500);
    const cuerpo = await page.locator("body").innerText();
    if (/Elena/.test(cuerpo)) ok("Elena sale en el selector de compartir");
    else note("Elena NO sale en el selector de compartir, y esa es la gracia de la feature");
    await shot(page, "55-selector-con-elena");
  }
}

if (errores.length) note(`errores de pagina: ${errores.slice(0, 3).join(" | ")}`);

await browser.close();
console.log(`\n=== ${problems.length} problemas ===`);
for (const p of problems) console.log("- " + p);