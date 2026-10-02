#!/usr/bin/env node
/**
 * Entrar en cada pantalla de la app en un emulador de Android y decir cuál se rompe.
 *
 *   node scripts/verify-android-screens.mjs
 *
 * El `verify-app-regression.mjs` que ya hay es **web**: habla con Chrome por el
 * protocolo de DevTools y no ve nada nativo. Y lo nativo es donde se rompen las
 * cosas —un `window` que no existe, una activity que se queda esperando, un inset
 * gastado dos veces—, porque nada de eso aparece en un navegador.
 *
 * ---
 *
 * **Y el fallo que este script tiene que evitar, porque el primero que se escribió
 * lo tenia.** La regla ingenua es "despues de cada paso, si el proceso sigue vivo
 * y el buffer de crash esta limpio, el paso pasa". Con esa regla los seis pasos
 * dieron verde mientras **la app no se habia movido de sitio**: los taps no caian,
 * y un tap que no cae tampoco crashea.
 *
 * Un boton que no hace nada y una app que se cierra se miran igual desde fuera, y
 * por eso aqui el fallo se mira de dos formas a la vez:
 *
 *   1. **El proceso.** Si no hay pid, o si el pid ha cambiado, se cerro y relanzo:
 *      en nativo un crash muchas veces relanza la activity en silencio.
 *   2. **Que la pantalla haya cambiado.** Se saca el hash de los nodos de texto y
 *      de las clases del arbol de accesibilidad. Si dos pasos seguidos dejan el
 *      mismo hash, el paso **no hizo nada**, y eso es un fallo aunque no haya
 *      crasheado nada.
 *
 * La segunda comprobacion es la que hace que la primera signifique algo.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(RAIZ, 'capturas', 'android');
const ADB = process.env.ADB ?? join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb');
const PAQUETE = process.env.PAQUETE ?? 'com.jrzlabs.orbithub';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) =>
  execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function pid() {
  try {
    return (adb('shell', 'pidof', PAQUETE) || '').trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

function crashes() {
  try {
    return adb('logcat', '-d', '-b', 'crash', '-v', 'brief')
      .split('\n')
      .filter((l) => /FATAL EXCEPTION|JavascriptException/.test(l));
  } catch {
    return [];
  }
}

/**
 * Como se ve la pantalla ahora, en dos formas: un nombre para el informe y un
 * hash para saber si algo se movio de sitio.
 */
function estado() {
  try {
    adb('shell', 'uiautomator', 'dump', '/sdcard/_e.xml');
    const xml = adb('exec-out', 'cat', '/sdcard/_e.xml');
    const textos = [...xml.matchAll(/text="([^"]{1,80})"/g)].map((m) => m[1]).filter(Boolean);
    const clases = [...xml.matchAll(/class="([^"]+)"/g)].map((m) => m[1]);
    const hash = createHash('sha1').update(textos.join('|') + clases.join('|')).digest('hex').slice(0, 8);
    return { hash, nombre: textos.slice(0, 3).join(' · ') || '(sin texto)', total: textos.length };
  } catch {
    return { hash: 'ilegible', nombre: '(ilegible)', total: 0 };
  }
}

/** Coordenadas del primer nodo pulsable cuyo texto case con el fragmento. */
function donde(fragmento, { pulsable = true } = {}) {
  adb('shell', 'uiautomator', 'dump', '/sdcard/_d.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/_d.xml');
  /*
   * Se mira `content-desc` tambien, y no solo `text`, porque en Android los
   * botonessole vacio: el "Open the menu" del cajon vive ahi y en `text` no hay
   * nada. Un `donde()` que solo lea `text` encuentra la mitad de la pantalla.
   */
  for (const atributo of ['text', 'content-desc']) {
    const patron = new RegExp(
      `${atributo}="([^"]*${fragmento}[^"]*)"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
      'g',
    );
    for (const m of xml.matchAll(patron)) {
      const [, , x1, y1, x2, y2] = m.map(Number);
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2, texto: m[1] };
    }
  }
  if (!pulsable) {
    for (const m of xml.matchAll(/text="([^"]+)"/g)) {
      if (!m[1].includes(fragmento)) continue;
      const seg = xml.slice(m.index, m.index + 400);
      const b = seg.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (b) {
        const [, x1, y1, x2, y2] = b.map(Number);
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2, texto: m[1] };
      }
    }
  }
  return null;
}

const resultados = [];
let fallos = 0;

async function paso(nombre, accion, { esperarCambio = true } = {}) {
  adb('logcat', '-c');
  const pidAntes = pid();
  const antes = estado();

  let falloAccion = null;
  try {
    await accion();
  } catch (error) {
    falloAccion = error.message;
  }

  await sleep(3200);
  const pidDespues = pid();
  const crasheo = crashes();
  const despues = estado();

  const problemas = [];
  if (falloAccion) problemas.push(`la accion no se pudo hacer: ${falloAccion}`);
  if (!pidDespues) problemas.push('la app se cerro — no hay proceso');
  else if (pidAntes && pidDespues !== pidAntes) {
    problemas.push(`el proceso cambio (${pidAntes} -> ${pidDespues}): relanzo en silencio`);
  }
  if (crasheo.length) problemas.push(crasheo[0].slice(0, 150));
  if (!falloAccion && esperarCambio && despues.hash === antes.hash) {
    problemas.push('la pantalla NO ha cambiado: el paso no hizo nada');
  }

  const foto = join(SHOTS, `${String(resultados.length + 1).padStart(2, '0')}-${nombre}.png`);
  try {
    execFileSync('sh', ['-c', `"${ADB}" exec-out screencap -p > "${foto}"`]);
  } catch {}

  if (problemas.length) fallos += 1;
  resultados.push({
    nombre,
    pantalla: despues.nombre,
    ok: problemas.length === 0,
    detalle: problemas.join(' | ') || `ok (${despues.total} textos, ${despues.hash})`,
  });
  console.log(
    `  ${problemas.length ? 'FALLA' : ' ok  '}  ${nombre.padEnd(24)} ${
      problemas.length ? problemas.join(' | ') : despues.nombre.slice(0, 46)
    }`,
  );
}

const tapXY = (x, y) => async () => adb('shell', 'input', 'tap', String(x), String(y));
const volver = async () => {
  const d = donde('Back');
  if (d) adb('shell', 'input', 'tap', String(d.x), String(d.y));
};
/** El boton del cajon se busca por su etiqueta: las coordenadas fijas fallan\n * en cuanto cambia la barra. */
const menu = async () => {
  const d = donde('Open the menu');
  if (!d) throw new Error('no hay boton de menu');
  adb('shell', 'input', 'tap', String(d.x), String(d.y));
};
const atras = () => async () => adb('shell', 'input', 'keyevent', '4');

function irA(fragmento) {
  return async () => {
    const d = donde(fragmento);
    if (!d) throw new Error(`no aparece "${fragmento}"`);
    adb('shell', 'input', 'tap', String(d.x), String(d.y));
  };
}

/** Abre el cajon antes de cada destino, porque es donde estan. */
async function porElMenu(destino) {
  await menu();
  await sleep(1400);
  const d = donde(destino);
  if (!d) throw new Error(`el cajon no tiene "${destino}"`);
  adb('shell', 'input', 'tap', String(d.x), String(d.y));
}

mkdirSync(SHOTS, { recursive: true });
console.log(`\nRecorrido de pantallas en Android — ${PAQUETE}\n`);
adb('shell', 'monkey', '-p', PAQUETE, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(8000);

const destinos = [
  ['inicio', 'Hi,'],
  ['notas', 'Notes'],
  ['busqueda', 'Search'],
  ['personas', 'People'],
  ['ajustes', 'Settings'],
  ['sincronizacion', 'Sync centre'],
  ['espacios', 'All the spaces'],
];

for (const [nombre, destino] of destinos) {
  await paso(`menu: ${nombre}`, () => porElMenu(destino));
}

console.log('\n');
const linea = (r) =>
  `${r.ok ? 'PASA' : 'FALLA'}  ${r.nombre.padEnd(24)} ${r.pantalla.slice(0, 40).padEnd(42)} ${r.detalle}`;
writeFileSync(join(SHOTS, 'pantallas.txt'), resultados.map(linea).join('\n'), 'utf8');
for (const r of resultados) console.log(`  ${linea(r)}`);
console.log(`\n${resultados.length - fallos}/${resultados.length} pantallas sin fallo`);
console.log(`capturas e informe: capturas/android/\n`);
process.exit(fallos > 0 ? 1 : 0);
