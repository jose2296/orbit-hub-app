#!/usr/bin/env node
/**
 * Exportar la web y dejar el título del documento puesto.
 *
 *   node scripts/export-web.mjs
 *
 * Existe por un motivo concreto: **`expo export --platform web` genera la
 * página principal sin nombre**, y eso no bloquea la verificación de OAuth de
 * Google.
 *
 * Lo que sale del export es esto, y son dos `<title>`:
 *
 *     1. <title data-rh="true"></title>   ← vacío
 *     2. <title>OrbitHub</title>          ← el de `+html.tsx`
 *
 * Y de dos `<title>` en un documento **se lee el primero**, así que el nombre
 * que se veía en el código no era el que se leía. Google compara el nombre de la
 * app en la pantalla de consentimiento con el de tu página principal, no
 * encuentra con qué compararlo y rechaza la verificación con *"El nombre de la
 * app no coincide con el nombre de la app de tu página principal"*.
 *
 * Por qué no se arregla donde parecería:
 *
 * - Un `<title>` en `+html.tsx` sale **después** del de expo-router. Es el
 *   segundo, y el segundo no cuenta.
 * - `screenOptions.title` en `_layout.tsx` no lo llena. Verificado con un export
 *   real: el título sigue saliendo vacío. Los títulos de pantalla los pone
 *   `useScreenTitle`, que los asigna en un efecto, y en el render estático ese
 *   efecto todavía no se ha ejecutado.
 * - El componente `Title` de expo-router, que es lo que rellena ese hueco, **no
 *   existe en la versión 57** (`expo-router/head` solo exporta `Head`, y
 *   `expo/head` no está instalado). Comprobado, no supuesto.
 *
 * Así que el título se escribe aquí, después del export, que es el único punto
 * donde se puede asegurar.
 *
 * La regla es dejar **un solo `<title>` por página**, con el primer título no
 * vacío que haya —el de `+html.tsx`—, y si no hay ninguno, `OrbitHub`. El
 * título de expo-router se queda en su sitio, con su `data-rh`, para que
 * React siga hidratar el mismo elemento que antes.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(RAIZ, 'apps', 'mobile');
const DIST = join(APP, 'dist');

/** El nombre que Google compara, y el que hay que dejar en la página principal. */
const NOMBRE_APP = 'OrbitHub';

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

/**
 * Deja un único `<title>`, con el primer contenido no vacío que hubiera.
 *
 * Se conserva el primer elemento —el de react-hydrate, con su `data-rh`— en
 * lugar de borrar todos y escribir uno nuevo: el cliente busca ese nodo para
 * hidratarlo, y si desaparece del HTML inicial el árbol del servidor y el del
 * cliente dejan de casar.
 */
function fixTitle(html) {
  const matches = [...html.matchAll(/<title(\s[^>]*)?>([\s\S]*?)<\/title>/gi)];
  if (matches.length === 0) return { html, changed: false };

  /*
   * El nombre sale del primer `<title>` que ya tenga algo escrito —el de
   * `+html.tsx`—, y si ninguno lo tiene se usa el de la app. Da igual cuál se
   * elija: lo que cuenta es que quede **uno**, y que ese uno tenga el nombre.
   */
  const conNombre = matches.find((m) => (m[2] ?? '').trim().length > 0);
  const titulo = (conNombre?.[2] ?? NOMBRE_APP).trim();

  const [primero] = matches;
  const yaEsta = matches.length === 1 && (primero[2] ?? '').trim() === titulo;
  if (yaEsta) return { html, changed: false };

  /*
   * El nombre va en el **primero**, que es el que react-hydrate reclama para
   * hidratar, y los sobrantes se borran del documento. No se sustituye el
   * elemento por otro nuevo: si el nodo que el cliente busca no está en el
   * HTML inicial, el árbol del servidor y el del cliente dejan de casar.
   */
  let vistos = 0;
  const salida = html.replace(
    /<title(\s[^>]*)?>([\s\S]*?)<\/title>/gi,
    (todo, attrs) => {
      vistos += 1;
      return vistos === 1 ? `<title${attrs ?? ''}>${titulo}</title>` : '';
    },
  );

  return { html: salida, changed: true };
}

console.log('> expo export --platform web');
execFileSync('npx', ['expo', 'export', '--platform', 'web'], {
  cwd: APP,
  stdio: 'inherit',
});

const ficheros = htmlFiles(DIST);
let arreglados = 0;

for (const file of ficheros) {
  const antes = readFileSync(file, 'utf8');
  const { html, changed } = fixTitle(antes);
  if (!changed) continue;
  writeFileSync(file, html);
  arreglados += 1;
}

if (arreglados === 0) {
  console.error(
    '\nNo se encontró ningún <title> en el export. Si el export ha cambiado de\n' +
      'formato, esto hay que rehacerlo: la página principal se queda sin nombre\n' +
      'y la verificación de OAuth vuelve a fallar.',
  );
  process.exit(1);
}

const titulo = readFileSync(join(DIST, 'index.html'), 'utf8').match(
  /<title(\s[^>]*)?>([\s\S]*?)<\/title>/i,
);

console.log(`\n${arreglados} de ${ficheros.length} páginas con el título puesto.`);
console.log(`index.html: <title>${titulo?.[2] ?? '(NINGUNO)'}</title>`);
if (titulo?.[2]?.trim() !== NOMBRE_APP) {
  console.error(
    `\nLa página principal no se llama "${NOMBRE_APP}", y es el nombre que\n` +
      'Google compara contra el de la pantalla de consentimiento.',
  );
  process.exit(1);
}
