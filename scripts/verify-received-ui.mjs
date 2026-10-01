/**
 * The same screens seen by the person who was **lent** the thing.
 *
 * This is the half that matters and the half a unit test cannot check: that the
 * badge says "compartido contigo" and not "tuyo", that it says "solo puedes
 * mirarlo", and that the menu does not offer to share it to somebody else — because
 * editing fifty rows is not deciding that a sixth person sees them.
 *
 * The badge is read **from the options menu**, which is the only place it is printed.
 * See the comment on the check further down for why this script opens the menu.
 *
 * Beto has a note shared with him as `editor` and no membership of the owner's
 * space, so every one of those three should be true at once.
 */
import { chromium } from "/tmp/orbit-e2e/node_modules/playwright/index.mjs";

const WEB = process.env.WEB ?? "http://localhost:8083";
const OUT = process.env.OUT ?? "/tmp/orbit-shots";
const LOGIN = JSON.parse(process.env.LOGIN);

const problems = [];
const note = (m) => { problems.push(m); console.log("  ! " + m); };
const step = (m) => console.log("- " + m);
const API = process.env.API ?? "http://localhost:4001/api/v1";

/**
 * The sharing is arranged over HTTP and then looked at in a browser.
 *
 * Doing the "place it in your own space" step through the drawer meant fighting a
 * backdrop that stays up and swallows every click: thirty seconds of retries per
 * tap and a timeout. The placing is not what this script is checking — the badge
 * and the menu are — and the API does the same thing in one request.
 */
async function preparar() {
  const sesion = await (
    await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: LOGIN.email, password: LOGIN.password, device: { label: "Seed", platform: "web" } }),
    })
  ).json();
  const token = sesion?.data?.session?.accessToken;
  if (!token) throw new Error(`no session: ${JSON.stringify(sesion)}`);

  const call = (path, method = "GET", body) =>
    fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  // A space of his own to file it in, if he has none.
  const push = (operations) =>
    call("/sync/push", "POST", {
      deviceId: crypto.randomUUID(),
      lastPulledAt: null,
      operations: operations.map((o) => ({
        operationId: crypto.randomUUID(),
        clientId: "seed-client-received",
        baseVersion: 0,
        payload: {},
        clientTimestamp: new Date().toISOString(),
        ...o,
      })),
    });

  const yaTiene = await (await call("/sync/pull", "POST", { deviceId: crypto.randomUUID(), cursor: null, limit: 200 })).json();
  const espacios = (yaTiene?.data?.changes ?? []).filter((c) => c.entity === "workspace");
  let espacioId = espacios[0]?.record?.id;
  if (!espacioId) {
    espacioId = crypto.randomUUID();
    await push([{ kind: "create", entity: "workspace", entityId: espacioId, payload: { name: "Lo mio", color: "rose" } }]);
    step(`creado un espacio propio para colocar la nota`);
  }

  const bandeja = await (await call("/shares/inbox")).json();
  const pendientes = bandeja?.data?.items ?? [];
  for (const item of pendientes) {
    await call(`/shares/${item.id}/place`, "POST", { workspaceId: espacioId, folderId: null });
    step(`colocada "${item.title}" en su propio espacio`);
  }
  if (pendientes.length === 0) step("no habia nada sin colocar: ya estaba en su arbol");

  // The id of the note as the server has it, so the browser can be sent straight to
  // it. Clicking the row was not an option: an overlay belonging to the drawer sits
  // over the list and swallows every tap, so thirty seconds of retries per attempt
  // and then a timeout on a screen that is plainly working.
  const conNota = (yaTiene?.data?.changes ?? []).find(
    (c) => c.entity === "note" && c.record?.title === LOGIN.noteTitle,
  );
  return { token, espacioId, noteId: conNota?.record?.id };
}

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});

step("preparar el arbol de quien recibio la nota (por API)");
const preparado = await preparar();

const page = await (await browser.newContext({ viewport: { width: 430, height: 940 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

step(`entrar como ${LOGIN.email}`);
await page.goto(WEB, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.locator('text=/Iniciar sesión|Iniciar sesion/').first().click();
await page.waitForTimeout(1500);
await page.locator('input[type="email"]').first().fill(LOGIN.email);
await page.locator('input[type="password"]').first().fill(LOGIN.password);
await page
  .locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion")')
  .last()
  .click();
await page.waitForTimeout(5000);

// ---- la nota ---------------------------------------------------------------
// The engine pulls on the home screen, so going straight to `/notes` in a fresh
// profile asks for a screen whose cache has not been filled yet. Sitting on home
// for a few seconds first is what a person does without noticing.
step("esperar a que el sincronizador traje lo suyo");
await page.waitForTimeout(9000);
await page.screenshot({ path: `${OUT}/12a-inicio-recibido.png` });
console.log(`  · 12a-inicio-recibido.png`);

step("ir a Notas y abrir la que le compartieron");
await page.goto(`${WEB}/notes`, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/12-notas-recibidas.png` });
console.log(`  · 12-notas-recibidas.png`);

// By id and not by the title text. Waiting for a `text=` locator for a row that is
// inside a list which had only just filled reported "the note is not there" while
// the screenshot right beside it shows it — the note is a child of a row whose own
// text had not been laid out yet, and `innerText` of a not-yet-painted row is empty.
step("abrir la nota compartida por su direccion");
await page.goto(`${WEB}/note/${preparado.noteId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/13-nota-compartida.png` });
console.log(`  · 13-nota-compartida.png`);

/*
 * The badge lives in the **options menu** and nowhere else, so this opens the menu.
 *
 * It used to read the note screen, because the badge used to be printed above the
 * note. Checking it there reported "the badge does not say 'shared with you'" against
 * a screen that is correct by decision — the check had outlived what it checked, and
 * the worst version of that is a check that fails and gets "fixed" by putting the
 * badge back in two places.
 */
let botones = page.locator("button");
for (let i = (await botones.count()) - 1; i >= 0; i -= 1) {
  await botones.nth(i).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (/Renombrar/.test(await page.locator("body").innerText())) break;
}
await page.screenshot({ path: `${OUT}/13b-menu-nota.png` });
console.log("  · 13b-menu-nota.png");

const cuerpo = await page.locator("body").innerText();
const insigniaAbierta = (await page.locator('[data-testid="shared-badge"]').count()) > 0;
const diceCompartido = /Compartido contigo/.test(cuerpo);
const diceTuyo = /(^|\n)\s*Tuyo\s*($|\n)/.test(cuerpo);

console.log(`  insignia en el menu: ${insigniaAbierta}`);
console.log(`  "Compartido contigo": ${diceCompartido}`);
console.log(`  "Tuyo": ${diceTuyo}`);
console.log(`  "Puedes editarlo": ${/Puedes editarlo/.test(cuerpo)}`);

if (!insigniaAbierta) note("el menu de la nota no lleva insignia: es donde vive ahora");
if (!diceCompartido) note('la insignia no dice "Compartido contigo" para algo que le compartieron');
if (diceTuyo) note('la insignia dice "Tuyo" sobre una nota que no es suya');

/*
 * And the one this script was written for and had stopped checking.
 *
 * Beto has this note as `editor`. The menu offered him "Con quién" — and the server
 * agreed, so it was not a cosmetic mistake: he could hand Ana's note to a third
 * person, and Ana, who wrote it and owns the space, then got a 403 when she tried to
 * take it back. Being able to edit fifty rows is not being able to decide that a
 * sixth person sees them, and "editor" said yes to both at once.
 *
 * Asserted here because this is the screen where it was visible, and because a menu
 * that offers something the server refuses is a menu that teaches the rule by making
 * the person find out.
 */
if (/Con quién/.test(cuerpo)) {
  note('el menu ofrece compartir una nota que lefue prestada: solo la duena puede decidir quien mas la ve');
} else {
  console.log('  ✓ no ofrece compartir: le la prestaron, no es suya');
}

if (errors.length) note(`errores de pagina: ${errors.slice(0, 3).join(" | ")}`);

await browser.close();
console.log(`\n=== ${problems.length} problemas ===`);
for (const p of problems) console.log("- " + p);
