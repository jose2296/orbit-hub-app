import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los iconos son una fuente web, no iconos sueltos: `Ionicons.ttf`, 131 glifos,
 * un solo fichero. `<Ionicons>` no dibuja nada hasta que la fuente ha llegado,
 * y su propio codigo devuelve un `<Text />` vacio mientras tanto.
 *
 * La app no la esperaba en ninguna parte. Cada uno de los 131 iconos arrancaba
 * su propia carga asincrona desde su propio `componentDidMount`, sin ningun gate,
 * y en web la promesa puede rechazar en silencio — con un timeout de 12s y un
 * `try/catch` que solo captura thrown sincronicos — dejando los iconos vacios de
 * forma permanente con un unico error en consola.
 *
 * Esto ya estaba escrito en el repo (`docs/roadmap.md`, "no era que la fuente no
 * llegara nunca; es que nadie la estaba esperando") y se sorteo esperando 20s en
 * el arnes de capturas. La app no espera nada.
 *
 * Estos tests leen el fuente porque el gate es una condicion sobre un hook y no
 * una funcion: no hay forma honesta de testear que se llama sin renderizar la
 * raiz de Expo Router, y un mock de `useFonts` solo probaria el mock.
 */

const SRC = join(import.meta.dirname, '..', 'src');
const LAYOUT = readFileSync(join(SRC, 'app', '_layout.tsx'), 'utf8');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }

  return found;
}

describe('la raiz espera a la fuente de los iconos', () => {
  it('carga la fuente desde la raiz, no desde cada icono', () => {
    assert.match(
      LAYOUT,
      /useFonts\(/,
      'la raiz tiene que pedir la fuente; si no, la pide cada icono por su cuenta y se pierde el error',
    );
  });

  it('carga la fuente de Ionicons, que es la que dibuja los items', () => {
    assert.match(
      LAYOUT,
      /Ionicons\.font/,
      'sin el `.font` de Ionicons el gate espera a una fuente que nadie ha pedido',
    );
  });

  it('no pinta la app hasta que la fuente ha llegado o ha fallado', () => {
    // Las dos mitades: `loaded` para no pintar iconos vacios, y `error` para no
    // quedarse esperando a una fuente que no va a llegar nunca. Gatear solo con
    // `loaded` convierte un 404 en una pantalla en blanco permanente.
    assert.match(LAYOUT, /\bfontsLoaded\b|\bloaded\b/, 'el gate tiene que mirar si esta lista');
    assert.match(
      LAYOUT,
      /\bfontError\b|\berror\b/,
      'el gate tiene que mirar tambien si fallo, o un 404 deja la app colgada',
    );
  });

  it('reutiliza la espera que ya existe en vez de anadir un segundo spinner', () => {
    // La pantalla de arranque ya existe y ya esta despues del stack. Un segundo
    // spinner seria una animacion mas, y el primer frame visible distinto.
    assert.match(LAYOUT, /session-booting/, 'la espera deberia caer en el overlay que ya hay');
  });
});

describe('los iconos no se dibujan a ciegas', () => {
  it('nadie mas pide la fuente por su cuenta', () => {
    // Si algo vuelve a llamar a `Font.loadAsync` para una fuente suelta, el gate
    // de la raiz deja de ser la unica espera y vuelve el fallo silencioso que
    // este arreglo quita.
    const offenders = sourceFiles(SRC).filter((path) =>
      /Font\.loadAsync|Font\.loadFontAsync/.test(readFileSync(path, 'utf8')),
    );

    expect(offenders, 'la carga de fuentes tiene que pasar por la raiz').toEqual([]);
  });
});
