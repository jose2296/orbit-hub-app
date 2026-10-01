/**
 * The bug: receiving a shared thing and being unable to file it anywhere.
 *
 * Reported as "You can only file it in one of your own spaces". The panel listed the
 * sender's space, it was the only row in the list, and choosing it was refused by the
 * server — because the recipient is not a member of it. And the reason it was the
 * *only* row is the whole shape of the failure: the person receiving their first
 * shared thing has no space of their own, so the cache holds exactly one space and it
 * belongs to somebody else.
 *
 * So the check that matters is not "does it work" — it works fine for anybody with a
 * space of their own, and it did before this too. It is **what the panel shows when
 * there is nowhere to put it**, which is the state this report is about.
 */
import { chromium } from "/tmp/orbit-e2e/node_modules/playwright/index.mjs";

const WEB = process.env.WEB ?? "http://localhost:8081";
const API = process.env.API ?? "http://localhost:4000/api/v1";
const OUT = process.env.OUT ?? "/tmp/orbit-shots";
const LOGIN = JSON.parse(process.env.LOGIN);

const problems = [];
const note = (m) => { problems.push(m); console.log("  ! " + m); };
const ok = (m) => console.log("  ✓ " + m);
const step = (m) => console.log("- " + m);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});
const page = await (await browser.newContext({ viewport: { width: 430, height: 940 } })).newPage();

step(`entrar como ${LOGIN.email}`);
await page.goto(WEB, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.locator("text=/Iniciar sesión/").first().click();
await page.waitForTimeout(2000);
await page.locator('input[type="email"]').first().fill(LOGIN.email);
await page.locator('input[type="password"]').first().fill(LOGIN.password);
await page.locator('button:has-text("Iniciar sesión")').last().click();
await page.waitForTimeout(7000);

step("esperar a que el sincronizador traje lo suyo");
await page.waitForTimeout(9000);

// The drawer row that opens the place panel.
step("abrir el menu lateral");
await page.screenshot({ path: `${OUT}/59-inicio.png` });
console.log(`  · 59-inicio.png`);

// The row is inside the drawer, which is closed to begin with, and clicking a row in
// a closed drawer times out rather than failing loudly.
const menu = page.locator('button[aria-label*="men" i], button[aria-label*="Menú" i]').first();
if (await menu.count()) {
  await menu.click({ timeout: 8000 }).catch(() => note("no se pudo abrir el menu lateral"));
  await page.waitForTimeout(2500);
} else {
  // Fall back to the first button in the header, which is the hamburger on every
  // screen that has a drawer.
  await page.locator("button").first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

step("abrir lo que me compartieron");
const recibido = page.locator('text=/Compartido conmigo/').first();
if (!(await recibido.count())) {
  // Dump what the drawer actually says, because a locator that does not match is
  // indistinguishable from a feature that is missing and this script cannot tell them
  // apart from the outside.
  console.log("  (lo que hay en pantalla):");
  console.log(
    (await page.locator("body").innerText())
      .split("\n")
      .filter(Boolean)
      .slice(0, 25)
      .map((l) => "    | " + l)
      .join("\n"),
  );
  note('no se encuentra la entrada "Compartido conmigo"');
} else {
  await recibido.click({ timeout: 8000 }).catch(() => note("no se pudo abrir la bandeja"));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/60-bandeja.png` });
  console.log(`  · 60-bandeja.png`);

  // Open the place panel on whatever is there.
  const item = page.locator('text=/Solo mirar|Lista de la compra/').first();
  if (!(await item.count())) {
    note("la bandeja no lista lo compartido");
  } else {
    await item.click({ timeout: 8000 }).catch(() => note("no se pudo pulsar el elemento"));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/61-colocar.png` });
    console.log(`  · 61-colocar.png`);

    const cuerpo = await page.locator("body").innerText();

    /*
     * Scoped to the list of spaces, and this scoping is the whole check.
     *
     * The drawer stays open behind the panel and it also lists spaces — including the
     * sender's. Reading the whole page finds "Casa" whether the panel is right or
     * broken, so the first version of this check failed against a panel that was
     * already correct. That is the failure mode worth writing down: a check that
     * cannot fail is not a check.
     */
    const lista = page.locator('[data-testid="place-spaces"]');
    if (!(await lista.count())) {
      note("el panel no tiene la lista de espacios con su marca: no se puede comprobar");
    } else {
      const dentro = await lista.innerText();
      if (dentro.includes(LOGIN.senderSpace)) {
        note(`el panel ofrece "${LOGIN.senderSpace}", que es el espacio de quien lo compartio`);
      } else {
        ok(`no ofrece "${LOGIN.senderSpace}": no es un espacio suyo`);
      }

      if (/no tienes ning[uú]n espacio propio/i.test(dentro)) {
        ok("dice por que no se puede y que hace falta un espacio propio");
      } else {
        note("no explica que hace falta un espacio propio: el panel queda mudo");
      }

      if (/Crear un espacio/i.test(dentro)) {
        ok("ofrece el camino: crear un espacio");
      } else {
        note("no ofrece ningun camino para salir de esta pantalla");
      }
    }
  }
}

if (problems.length) note(`${problems.length} problemas`);
else console.log("\n=== 0 problemas ===");

await browser.close();
process.exit(problems.length ? 1 : 0);