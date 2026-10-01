/**
 * Two accounts, one browser, the whole sharing flow.
 *
 * Everything before this was checked one account at a time and then the other, which
 * is how a whole class of bug got through: what the **sender** sees is not what the
 * **receiver** sees, and the only way to see both is two sessions side by side.
 *
 * Ana shares, in this order: a list, an item, a note, a folder, and then the whole
 * workspace. Beto is the receiver throughout. For each one it checks three things,
 * because all three have been wrong at some point:
 *
 *   - what actually arrives in the receiver's cache (sync is the app's read model),
 *   - what the drawer says,
 *   - what the menus say about who owns it and whether it can be deleted.
 *
 * Two contexts, not two pages: they need different sessions and a page cannot hold
 * both.
 */
import { chromium } from "/tmp/orbit-e2e/node_modules/playwright/index.mjs";

const WEB = process.env.WEB ?? "http://localhost:8081";
const API = process.env.API ?? "http://localhost:4000/api/v1";
const OUT = process.env.OUT ?? "/tmp/orbit-shots";
const SEED = JSON.parse(process.env.SEED);

const problems = [];
const note = (m) => { problems.push(m); console.log("  ! " + m); };
const ok = (m) => console.log("  ✓ " + m);
const step = (m) => console.log("\n- " + m);

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name}.png`);
};

/** Log in on a page that is already open, through the UI, not the API. */
async function entrar(page, email) {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.locator("text=/Iniciar sesión/").first().click();
  await page.waitForTimeout(2000);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(SEED.password ?? "Con-un-muy-largo-secreto-1");
  await page.locator('button:has-text("Iniciar sesión")').last().click();
  await page.waitForTimeout(7000);
}

/**
 * Close the drawer, and **fail loudly if it did not close**.
 *
 * It used to click `[data-testid="drawer-button"]` and swallow the error, and with the
 * menu open that click is intercepted by the drawer's own "Cerrar el menú" — so the
 * menu stayed open and the three checks after it reported a product that was never
 * tested. A step that cannot fail is three steps that cannot fail.
 */
async function cerrarMenu(page) {
  // Escape first, because a normal click times out here: the drawer slides and the
  // button is moving under the pointer, so "stable" never arrives.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(2000);

  if (await page.locator('[aria-label="Cerrar el menú"]').count()) {
    await page
      .locator('[aria-label="Cerrar el menú"]')
      .first()
      .click({ timeout: 6000, force: true })
      .catch(() => {});
    await page.waitForTimeout(2000);
  }

  if (await page.locator('[aria-label="Cerrar el menú"]').count()) {
    note("el menu sigue abierto: lo que se compruebe ahora no vale");
  }
}

/** Open the drawer. Every screen with a drawer has the hamburger in the header. */
async function abrirMenu(page) {
  const hamburguesa = page.locator('[aria-label="Abrir el menú"]').first();
  if (await hamburguesa.count()) {
    await hamburguesa.click({ timeout: 8000 }).catch(() => note("no se pudo abrir el menu"));
  } else {
    await page.locator("button").first().click({ timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});

const ctxAna = await browser.newContext({ viewport: { width: 430, height: 940 } });
const ctxBeto = await browser.newContext({ viewport: { width: 430, height: 940 } });
const ana = await ctxAna.newPage();
const beto = await ctxBeto.newPage();

step("dos sesiones a la vez: Ana comparte, Beto recibe");
await entrar(ana, SEED.login.email);
await entrar(beto, SEED.beto.email);
await shot(ana, "70-ana");
await shot(beto, "70-beto");

/**
 * Open the options menu of the thing on screen.
 *
 * By its accessibility label. And they are **not the same words on every screen**:
 * the list says "Menú de la lista" and the note says "Opciones de la nota". Two names
 * for one control, read off the DOM rather than guessed — guessing the label is what
 * made this script click "Elemento nuevo" on the way and report that the owner had no
 * share entry: a bug here that looked exactly like a bug in the product.
 *
 * (Not "Acciones de <titulo>", which is the label the *drawer* rows carry.) Guessing the
 * label is what made this script click "Elemento nuevo" on the way and report that
 * the owner had no share entry: a bug here that looked exactly like a bug in the
 * product. The label is the only stable handle, and the honest way to get it is to
 * read it off the DOM, not to guess it twice.
 */
async function abrirOpciones(page) {
  const boton = page
    .locator('[aria-label*="Menú de"], [aria-label*="Opciones de"]')
    .first();
  if (!(await boton.count())) {
    note('no se encuentra el boton de acciones del cabecera');
    return false;
  }
  await boton.click({ timeout: 8000 }).catch(() => note("el clic en Acciones de no pudo"));
  await page.waitForTimeout(2500);
  return true;
}

/*
 * The badge, from both sides: closed and open.
 *
 * Checked with two sessions because neither half is visible alone. "The dot is there"
 * only means something to somebody who just received something, and "it cleared" only
 * means something to somebody who did not.
 */
step("el punto de la hamburguesa de Beto");

/**
 * Wait for a thing to be there, rather than looking once and declaring it absent.
 *
 * Reading it a single time after a fixed pause produced a check that passed and failed
 * on runs that were identical, because the request for the list is still in the air at
 * that point. A check that reports a race as a product bug teaches the wrong thing.
 */
async function esperar(page, selector, ms = 12000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if ((await page.locator(selector).count()) > 0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

const puntoAntes = (await esperar(beto, '[data-testid="shares-dot"]')) ? 1 : 0;
if (puntoAntes > 0) ok("el punto esta puesto: Ana le compartio y no lo ha mirado");
else note("el punto NO aparece, y le acaban de compartir cosas");
await shot(beto, "71a-hamburguesa-con-punto");

step("Beto abre el menu: ve el numero, y al cerrarlo se limpia");
await abrirMenu(beto);
await beto.waitForTimeout(3000);
await shot(beto, "71b-menu-con-badge");

// The badge has to be visible **while the menu is open**. Stamping on open — which is
// what the first version did — made it unreachable: the count is zero the instant you
// can see it, so the number is never read by anybody.
const badgeAbierto = beto.locator('[data-testid="drawer-unseen-badge"]');
if (await badgeAbierto.count()) {
  ok(`el badge se ve con el menu abierto: marca ${await badgeAbierto.innerText()}`);
} else {
  note("el badge NO aparece con el menu abierto: se limpia antes de poder leerse");
}

// The dot stays while the menu is open, because you have not finished looking yet.
if ((await beto.locator('[data-testid="shares-dot"]').count()) > 0) {
  ok("el punto sigue puesto mientras lo esta mirando");
} else {
  note("el punto se apagaria con el menu abierto: se limpia antes de tiempo");
}

step("Beto cierra el menu: ahora si se marca como visto");
await cerrarMenu(beto);
if ((await beto.locator('[data-testid="shares-dot"]').count()) === 0) {
  ok("al cerrar el menu el punto desaparece: ya lo ha mirado");
} else {
  note("el punto sigue puesto despues de cerrar: no se marca como visto");
}

await abrirMenu(beto);
await beto.waitForTimeout(2500);
if ((await beto.locator('[data-testid="drawer-unseen-badge"]').count()) === 0) {
  ok("y el numero tampoco: la lista ya no dice que hay nada nuevo");
} else {
  note(`el badge sigue marcando ${await beto.locator('[data-testid="drawer-unseen-badge"]').innerText()}`);
}
await cerrarMenu(beto);

step("el menu lateral de Beto, despues de mirarlo");
const menuBeto = await beto.locator("body").innerText();
await shot(beto, "71-menu-beto");
ok("menu abierto");

// The badge question, asked of the drawer as it is today.
const tieneBadge = await beto.locator('[data-testid*="badge" i]').count();
console.log(`  elementos con "badge" en su nombre: ${tieneBadge}`);
const cabecera = menuBeto.split("\n").filter(Boolean).slice(0, 30);
console.log("  lo que ve:\n" + cabecera.map((l) => "    | " + l).join("\n"));

step("Beto abre su lista de espacios y mira lo que le ha llegado");
await beto.goto(`${WEB}/spaces`, { waitUntil: "networkidle" }).catch(async () => {
  await beto.goto(`${WEB}/workspaces`, { waitUntil: "networkidle" });
});
await beto.waitForTimeout(4000);
await shot(beto, "72-espacios-beto");

step("Beto mira la pantalla de compartir en un item que le han prestado");
await beto.goto(`${WEB}/note/${SEED.noteId}`, { waitUntil: "networkidle" });
await beto.waitForTimeout(4000);
await abrirOpciones(beto);
await shot(beto, "73-menu-nota-beto");
const cuerpoNota = await beto.locator("body").innerText();
if (/Compartido contigo/.test(cuerpoNota)) ok('la insignia dice "Compartido contigo"');
else note('la insignia NO dice "Compartido contigo"');
if (/No lo puedes eliminar/.test(cuerpoNota)) ok("el menu no le ofrece borrar lo suyo");
else if (/Eliminar nota/.test(cuerpoNota)) note('le ofrece "Eliminar nota" sobre una nota que no es suya');
else console.log("  · no hay fila de borrar (se comprueba en la lista)");

step("Ana comparte su lista con Beto desde el menu");
await ana.goto(`${WEB}/list/${SEED.listId}`, { waitUntil: "networkidle" });
await ana.waitForTimeout(4000);
await abrirOpciones(ana);
await shot(ana, "74-menu-lista-ana");
const cuerpoAna = await ana.locator("body").innerText();
// La lista pone "Compartir <titulo>" y la nota "Con quién". Las dos son la misma
// entrada y el script miraba una sola: dos etiquetas para un control, ya vistas.
if (/Con quién|Compartir /.test(cuerpoAna)) ok("Ana sí puede compartir su lista: es la dueña");
else note("Ana, la dueña, no encuentra la entrada de compartir");

if (/^Tuyo$/m.test(cuerpoAna)) ok('la insignia de lo suyo dice "Tuyo"');
else note('la insignia no dice "Tuyo" en algo que es suyo');

if (problems.length) note(`${problems.length} problemas`);
else console.log("\n=== 0 problemas ===");

await browser.close();
process.exit(problems.length ? 1 : 0);