// The extension is not optional: `node e2e/run-android.ts` strips the types but
// keeps the ESM resolver, which does not guess `.ts`. Vitest does guess it, so
// this looks redundant in a test file and is not redundant here.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOneDevice } from './lib/android.ts';
import { ensureService, type Service } from './lib/stack.ts';

// Three levels up, not two: this file is `apps/mobile/e2e/`, and `capturas/` is
// where `scripts/verify-android-screens.mjs` has always written from the repo
// root. Two levels lands in `apps/`, which would be a second place to look.
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));
const CAPTURAS = join(RAIZ, 'capturas', 'android');
mkdirSync(CAPTURAS, { recursive: true });

const serial = requireOneDevice();
console.log(`arnes E2E: dispositivo ${serial}`);

const PUERTO_API = process.env.E2E_API_PORT ?? '4011';
const API = `http://127.0.0.1:${PUERTO_API}/api/v1`;
const SALIDA_API = join(CAPTURAS, 'api.log');

// Un directorio propio por carrera: la base de datos empieza vacia siempre, y lo
// que quedo de la carrera anterior no puede cambiar el resultado de esta. El
// directorio lleva la marca de tiempo en vez de vaciarse al empezar, porque
// vaciarlo aqui mataria la base de datos de una API que ya estaba en pie y que no
// es nuestra, y eso es justo lo que el arnes no debe hacer.
const PGDATA = join(CAPTURAS, 'pglite', new Date().toISOString().replace(/[:.]/g, '-'));

const servicios: Service[] = [];
try {
  servicios.push(
    await ensureService({
      label: 'la API',
      // `/api/v1` es el prefijo de la API, no un detalle: `/health` a secas cae
      // en el 404 y no comprueba nada.
      url: `http://127.0.0.1:${PUERTO_API}/api/v1/health`,
      cmd: 'npm',
      args: ['run', 'start', '--workspace', '@orbit-hub/api'],
      env: {
        PORT: PUERTO_API,
        PGLITE_DATA_DIR: PGDATA,
        EMAIL_TRANSPORT: 'console',
      },
      logFile: SALIDA_API,
    }),
  );
  servicios.push(
    await ensureService({
      label: 'Metro',
      url: 'http://127.0.0.1:8081/status',
      cmd: 'npm',
      args: ['run', 'start', '--workspace', '@orbit-hub/mobile', '--', '--port', '8081'],
      logFile: join(CAPTURAS, 'metro.log'),
    }),
  );
  for (const s of servicios) {
    console.log(`  ${s.started ? 'arrancado' : 'ya estaba en pie'}: ${s.label} (${s.url})`);
  }
  console.log(`  API para el seed: ${API}`);
  console.log(`  datos de la carrera: ${PGDATA}`);
} finally {
  for (const s of servicios) await s.stop();
}