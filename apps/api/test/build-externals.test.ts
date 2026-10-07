import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * Toda dependencia de produccion de terceros tiene que ir en `external` de
 * `build.mjs`: la imagen de runtime la instala con `npm ci --omit=dev`, y meterla
 * en el bundle rompe lo que lee ficheros por `__dirname` o usa top-level await.
 * jsdom llego al servidor asi y el contenedor no arrancaba
 * (`ERR_AMBIGUOUS_MODULE_SYNTAX`), con el typecheck y los tests en verde.
 */
describe('build.mjs', () => {
  it('deja fuera del bundle todas las dependencias de terceros', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const build = readFileSync(resolve(root, 'build.mjs'), 'utf8');

    const terceras = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@orbit-hub/'));
    const dentro = terceras.filter((name) => !build.includes(`'${name}'`));

    expect(dentro).toEqual([]);
  });
});
