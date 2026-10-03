// La extension no es opcional: `node e2e/run-android.ts` quita los tipos pero
// conserva el resolutor ESM, que no adivina `.ts`. Vitest si la adivina, asi que
// esto parece redundante en un fichero de test y no lo es aqui.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOneDevice } from './lib/android.ts';
import { ensureService, type Service } from './lib/stack.ts';
import { seed, writeSeedEnv } from './seed/e2e-account.ts';

// Tres niveles hacia arriba y no dos: este fichero es `apps/mobile/e2e/`, y
// `capturas/` es donde `scripts/verify-android-screens.mjs` ha escrito siempre
// desde la raiz. Dos niveles cae en `apps/`, que seria un segundo sitio donde
// mirar.
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));
const CAPTURAS = join(RAIZ, 'capturas', 'android');

// El dispositivo antes que el directorio: es la comprobacion mas barata y la que
// mas falla, y crear `capturas/` antes haria que una carrera sin dispositivo
// dejase el arbol de artefactos puesto sin haber hecho nada.
const serial = requireOneDevice();
console.log(`arnes E2E: dispositivo ${serial}`);

mkdirSync(CAPTURAS, { recursive: true });

const PUERTO_API = process.env.E2E_API_PORT ?? '4011';
const PUERTO_METRO = process.env.E2E_METRO_PORT ?? '8081';
const API = `http://127.0.0.1:${PUERTO_API}/api/v1`;
const WEB = `http://127.0.0.1:${PUERTO_METRO}`;

// Una marca por carrera, y con ella el nombre de todo lo que se queda en disco.
// Los logs llevan nombre propio en vez de acumularse en uno: la tarea siguiente
// saca de aqui el enlace de verificacion con un parser de "la ultima
// coincidencia", y sobre un log que crece entre carreras ese match es un token
// de una base de datos que ya no existe. Con nombre por carrera no hay nada que
// elegir.
const MARCA = new Date().toISOString().replace(/[:.]/g, '-');
const PGDATA = join(CAPTURAS, 'pglite', MARCA);
const SALIDA_API = join(CAPTURAS, `api-${MARCA}.log`);
const SALIDA_METRO = join(CAPTURAS, `metro-${MARCA}.log`);

const servicios: Service[] = [];
try {
  servicios.push(
    await ensureService({
      label: 'la API',
      // La ruta decide que servicio contesta. Un 404 tambien dice que hay algo
      // escuchando, asi que la ruta no es lo que prueba el puerto: es lo que
      // distingue a la API de cualquier otra cosa con el puerto ocupado, que es
      // justo lo que decide la rama de "ya estaba en pie".
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
      url: `http://127.0.0.1:${PUERTO_METRO}/status`,
      cmd: 'npm',
      args: [
        'run',
        'start',
        '--workspace',
        '@orbit-hub/mobile',
        '--',
        '--port',
        PUERTO_METRO,
      ],
      env: {
        // Sin esto la app apunta a 4000, que es lo que dice `.env.example`, y la
        // carrera se come un refused connection que parece un fallo de la app en
        // lugar de una variable que faltaba. Va en el entorno del hijo de Metro
        // y no en el de aqui porque `EXPO_PUBLIC_*` se lee al empaquetar, y el que
        // empaqueta es Metro.
        EXPO_PUBLIC_API_URL: API,
        // El mismo motivo y el mismo sitio: `WEB_ORIGIN` es donde la app manda
        // abrir los enlaces de verificacion e invitacion, y su valor por defecto
        // tiene el 8081 escrito dentro. Con el puerto de Metro cambiante, dejada
        // fuera, apuntaria a un sitio donde no hay nada.
        EXPO_PUBLIC_WEB_ORIGIN: WEB,
      },
      logFile: SALIDA_METRO,
    }),
  );
  for (const s of servicios) {
    console.log(`  ${s.started ? 'arrancado' : 'ya estaba en pie'}: ${s.label} (${s.url})`);
  }
  // El log de la API entra como variable y no como ruta escrita aqui: lo crea
  // `ensureService` con la marca de la carrera, y el enlace de verificacion sale
  // de ahi y de ningun otro sitio.
  const sembrado = await seed({ api: API, apiLog: SALIDA_API });
  // Con marca de carrera, como los logs: un `seed.env` de nombre fijo sobrevive
  // a la carrera siguiente y entonces sus credenciales apuntan a una base de
  // datos que ya no existe, que es un fallo que se lee como "el arnes no siembra".
  const envFile = join(CAPTURAS, `seed-${MARCA}.env`);
  writeSeedEnv(envFile, sembrado);
  console.log(`  sembrado: ${sembrado.email} (${sembrado.spaceName})`);
  console.log(`  credenciales para los flujos: ${envFile}`);
  console.log(`  datos de la carrera: ${PGDATA}`);
  console.log(`  logs: ${SALIDA_API} y ${SALIDA_METRO}`);
} finally {
  for (const s of servicios) await s.stop();
}
