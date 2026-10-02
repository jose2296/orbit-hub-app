#!/usr/bin/env node
/**
 * Recorrer la app en un emulador de Android diciendo donde se rompe.
 *
 *   node scripts/verify-android-regression.mjs
 *
 * El `verify-app-regression.mjs` que ya hay es **web**: habla con Chrome por el
 * protocolo de DevTools y no ve nada nativo. Y el nativo es donde se rompen las
 * cosas: un `window` que no existe, una activity que se queda esperando, un
 * inset que se gasta dos veces. Nada de eso aparece en un navegador.
 *
 * Asi que este usa `adb`, y la idea es simple: **despues de cada paso, si el
 * proceso sigue vivo y el buffer de crash esta limpio, el paso pasa.** Un
 * boton que no hace nada y una app que se cierra se miran igual desde fuera, y
 * por eso lo que se mira es el proceso, no la pantalla.
 *
 * Las capturas van a `capturas/android/` —que ya esta ignorado— y el informe
 * sale en la salida, para no dejar que lo unico que se vea sea una foto.
 */

import { execFileSync } from 'node:child_process';
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

/** El pid de la app, o null si no esta corriendo — que es un fallo, no un dato. */
function pid() {
  try {
    return (adb('shell', 'pidof', PAQUETE) || '').trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

/** Los crashes del buffer dedicated de Android, que es donde van los JS exceptions. */
function crashes() {
  try {
    return adb('logcat', '-d', '-b', 'crash', '-v', 'brief')
      .split('\n')
      .filter((l) => /FATAL EXCEPTION|JavascriptException/.test(l));
  } catch {
    return [];
  }
}

/** Lo que se ve ahora, para poder nombrar la pantalla en el informe. */
function pantalla() {
  try {
    adb('shell', 'uiautomator', 'dump', '/sdcard/_v.xml');
    const xml = adb('exec-out', 'cat', '/sdcard/_v.xml');
    const textos = [...xml.matchAll(/text="([^"]{2,60})"/g)].map((m) => m[1]);
    // Los nombres de pantalla que nos interesan: los titulos, no cada palabra.
    const titulo = textos.find((t) => t.length > 3 && t.length < 40 && !/[.!?]$/.test(t));
    return titulo ?? textos.slice(0, 2).join(' / ') ?? '(sin texto)';
  } catch {
    return '(ilegible)';
  }
}

const resultados = [];
let fallos = 0;

async function paso(nombre, accion) {
  adb('logcat', '-c');
  const antes = pid();
  const donde = pantalla();
  try {
    await accion();
  } catch (error) {
    fallos += 1;
    resultados.push({ nombre, donde, ok: false, detalle: `la accion fallo: ${error.message}` });
    return;
  }
  await sleep(2600);
  const despues = pid();
  const crasheo = crashes();

  let problema = null;
  if (!despues) {
    problema = 'la app se cerro — no hay proceso';
  } else if (antes && despues !== antes) {
    problema = `el proceso cambio (${antes} -> ${despues}): reinicio, que en nativo suele ser un crash que se relanza`;
  } else if (crasheo.length > 0) {
    problema = crasheo[0].slice(0, 160);
  }

  const foto = join(SHOTS, `${String(resultados.length + 1).padStart(2, '0')}-${nombre}.png`);
  try {
    execFileSync('sh', ['-c', `"${ADB}" exec-out screencap -p > "${foto}"`]);
  } catch {
    /* la foto es un extra, no un requisito */
  }

  if (problema) fallos += 1;
  resultados.push({ nombre, donde, ok: !problema, detalle: problema ?? '' });
  const marca = problema ? 'FALLA' : ' ok  ';
  console.log(`  [${marca}] ${nombre.padEnd(26)} ${problema ?? donde}`);
}

const tap = (x, y) => async () => adb('shell', 'input', 'tap', String(x), String(y));
const swipe = (x1, y1, x2, y2) => async () =>
  adb('shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), '260');

/** Toca el primer nodo cuyo texto contenga el fragmento. Coordenadas de verdad. */
function tapTexto(fragmento) {
  return async () => {
    adb('shell', 'uiautomator', 'dump', '/sdcard/_t.xml');
    const xml = adb('exec-out', 'cat', '/sdcard/_t.xml');
    for (const m of xml.matchAll(/text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
      if (!m[1].includes(fragmento)) continue;
      const [, , x1, y1, x2, y2] = m.map(Number);
      adb('shell', 'input', 'tap', String((x1 + x2) / 2), String((y1 + y2) / 2));
      return;
    }
    throw new Error(`no hay ningun elemento con "${fragmento}"`);
  };
}

mkdirSync(SHOTS, { recursive: true });

console.log(`\nRegresion en Android — ${PAQUETE}\n`);
adb('shell', 'pm', 'clear', PAQUETE);

await sleep(1500);
await paso('arranque', async () => {
  adb('shell', 'monkey', '-p', PAQUETE, '-c', 'android.intent.category.LAUNCHER', '1');
  await sleep(9000);
});

await paso('crear cuenta', tapTexto('Create account'));
await paso('registro: nombre', tapTexto('Name'));
await paso('registro: email', tapTexto('Email'));
await paso('registro: password', tapTexto('Password'));
await paso('registro: enviar', tapTexto('Create account'));

console.log('\n');
const linea = (r) =>
  `${r.ok ? 'PASA' : 'FALLA'}  ${r.nombre.padEnd(26)} ${r.donde.padEnd(28)} ${r.detalle}`;
writeFileSync(join(SHOTS, 'informe.txt'), resultados.map(linea).join('\n'), 'utf8');

for (const r of resultados) console.log(`  ${linea(r)}`);
console.log(`\n${resultados.length - fallos}/${resultados.length} pasos sin crash`);
console.log(`capturas e informe: capturas/android/\n`);
process.exit(fallos > 0 ? 1 : 0);
