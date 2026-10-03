// La extension no es opcional: `node e2e/run-android.ts` quita los tipos pero
// conserva el resolutor ESM, que no adivina `.ts`. Vitest si la adivina, asi que
// esto parece redundante en un fichero de test y no lo es aqui.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, appPid, clearLogcat, crashLines, forceStop, requireOneDevice, screenshot } from './lib/android.ts';
import { parseAreaFlag, resolveAreas } from './lib/areas.ts';
import { verdict } from './lib/guard.ts';
import { runMaestro } from './lib/maestro.ts';
import { renderReport, writeReport, fallosDeMaestro, type AreaResult } from './lib/report.ts';
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

// Las banderas se leen antes que nada mas porque no pueden fallar, y asi el error
// de una bandera mal escrita sale antes que el de un servicio que no arranco.
const flags = parseAreaFlag(process.argv.slice(2));

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
  // `adb reverse` y no `adb forward`, y los dos puertos: la app corre DENTRO del
  // emulador y pide `127.0.0.1:8081` a Metro y `127.0.0.1:4011` a la API, porque
  // esas son las direcciones que se le han pasado. El loopback de un emulador es el
  // suyo propio -el host es `10.0.2.2`-, asi que sin esto el bundle no se descarga
  // y la API no contesta, y el fallo se lee como "la app esta rota" en vez de como
  // "falta un puerto". Sin excepcion que capturar: un reverse que no se puede poner
  // es un fallo de la carrera, no un aviso.
  for (const puerto of [PUERTO_METRO, PUERTO_API]) {
    adb(['reverse', `tcp:${puerto}`, `tcp:${puerto}`], serial);
  }
  console.log(`  adb reverse: ${PUERTO_METRO} y ${PUERTO_API} apuntando al host`);
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

  const areas = resolveAreas(join(RAIZ, 'apps/mobile/e2e/maestro/flows'), flags.only);
  const vacias = areas.filter((a) => a.flows.length === 0);
  for (const a of vacias) console.log(`  aviso: el area ${a.name} no tiene flujos`);

  // `AreaResult` y no la forma escrita aqui: el informe se pinta a partir de esta
  // lista y de nada mas, asi que las dos cosas tienen que ser el mismo tipo. Con
  // la forma duplicada, anadir un campo al informe obliga a acordarse de tocar
  // las dos copias, y la copia que se olvida no da error de tipos: da un informe
  // con un `undefined` en una fila.
  const resultados: AreaResult[] = [];
  let fallos = 0;

  for (const area of areas) {
    // El estado y el buffer se limpian por area: sin esto, el primer area hereda
    // el pid de la anterior y el crash que dejo la ultima corrida, y se los
    // carga a el.
    //
    // Y por eso `antes.pid` es `null` en TODAS las areas, no solo en la primera.
    // **La segunda rama de `verdict` -el pid que cambia, el relanzamiento en
    // silencio, el fallo que este reposito ha tenido dos veces (`8b75b37` y
    // `513bbbb`)- no se puede ejecutar nunca con este cableado.** Medido y escrito
    // aqui al lado, como la tabla del contrato de la siembra, para que no se lea
    // como que funciona.
    //
    // Por que no se arregla aqui: llegar a esa rama pide leer el pid con la app ya
    // en pie, y la app solo la levanta el `launchApp` de Maestro, que va dentro
    // del area. Quitarel `forceStop` de aqui subiria el pid de un area al que la
    // anterior dejo como lo dejo -una hoja abierta, una sesion, un proceso a
    // medio morir-, y el pid del area siguiente seria el de un estado que nadie ha
    // comprobado. Review Focus 3, y es un problema peor que una rama que no se
    // ejecuta. El arreglo de verdad es que Maestro devuelva el pid que levanto la
    // app, o que el propio flujo lo deje escrito; ninguno de los dos cabe en esta
    // tarea, asi que aqui se deja el agujero abierto y a la vista.
    forceStop(serial);
    clearLogcat(serial);
    const antes = { pid: appPid(serial) };

    const flows = flags.flow ? [join(area.dir, flags.flow)] : area.dir;
    // La siembra entera en el entorno, no solo lo que los flujos de hoy necesitan:
    // es lo que le hara falta a un flujo con sesion, y `Seeded` ya es un mapa de
    // cadenas. Sin escribir un `.env`: Maestro lee `${...}` del entorno, y ahi es
    // donde el plan prohibio escribir ficheros.
    const { code, output } = runMaestro(flows, {
      cwd: RAIZ,
      env: { ...sembrado },
    });

    const guard = verdict(antes, { pid: appPid(serial) }, crashLines(serial));
    screenshot(serial, join(CAPTURAS, `${area.name}.png`));

    // `fallidos` sale de la salida de Maestro, que ya estaba en la mano y se
    // tiraba. Sin el, `Maestro fallo` en el informe es el nombre de la
    // herramienta que fallo y no el motivo, y el unico sitio donde estaba el
    // motivo son las lineas que se imprimen aqui y se pierden al salir.
    resultados.push({
      area: area.name,
      flows: area.flows.length,
      maestroOk: code === 0,
      guard,
      fallidos: fallosDeMaestro(output),
    });
    const mal = !guard.ok ? guard.problems.join(' | ') : code === 0 ? 'ok' : 'Maestro fallo';
    const bien = guard.ok && code === 0;
    if (!bien) fallos += 1;
    console.log(`  ${bien ? ' ok ' : 'FALLA'} ${area.name.padEnd(16)} ${mal}`);
    if (code !== 0) console.log(output.split('\n').slice(-15).join('\n'));
  }

  // El informe, antes de decidir nada: es el artefacto de la carrera y se escribe
  // tambien cuando la carrera sale bien. Va antes del `exitCode` y no dentro del
  // `else` porque un informe que solo existe cuando algo fallo no sirve para
  // comparar dos carreras, y comparar dos carreras es la mitad de para que exista.
  // La tabla va tambien a pantalla porque el `exitCode` no se ve: una carrera que
  // falla en un script se lee por su codigo, y una que se lee por sus lineas dice
  // QUE fallo.
  const informe = join(CAPTURAS, 'informe.txt');
  writeReport(informe, resultados);
  console.log(`\n${renderReport(resultados)}\n`);
  console.log(`informe: ${informe}`);

  // Un area vacia no es un fallo, pero una carrera sin un solo area tampoco es una
  // carrera: `resolveAreas` lanza si el directorio no existe, y esto avisa del otro
  // caso, que es un directorio con subdirectorios y ninguno con flujos.
  if (areas.length === 0) {
    console.error('  no hay ningun area que recorrer');
    process.exitCode = 1;
  } else if (fallos > 0) {
    process.exitCode = 1;
  }
} finally {
  for (const s of servicios) await s.stop();
}
