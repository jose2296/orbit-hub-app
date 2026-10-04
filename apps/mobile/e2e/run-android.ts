// La extension no es opcional: `node e2e/run-android.ts` quita los tipos pero
// conserva el resolutor ESM, que no adivina `.ts`. Vitest si la adivina, asi que
// esto parece redundante en un fichero de test y no lo es aqui.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, appPid, apuntaMetro, clearLogcat, crashLines, forceStop, limpiaDatos, requireOneDevice, screenshot } from './lib/android.ts';
import { corrida, parseAreaFlag, resolveAreas } from './lib/areas.ts';
import { verdict } from './lib/guard.ts';
import { runMaestro } from './lib/maestro.ts';
import {
  renderReport,
  writeReport,
  fallosDeMaestro,
  saleEnRojo,
  veredictoArea,
  type AreaResult,
} from './lib/report.ts';
import { eligePuerto, ensureService, type Service } from './lib/stack.ts';
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

// Los puertos se eligen libres, no se toman. El pedido `8081` es solo el primero
// que se mira: si lo tiene alguien, el arnes sube. No es una comodidad.
//
// La razon es `apuntaMetro` de mas abajo leida al reves: sin saber de quien es un
// puerto no hay forma de decir si el Metro que contesta es el de este checkout, y
// un Metro ajeno no es "un Metro que ya estaba en pie": sirve otro codigo, y la app
// se baja ese bundle. Medido: el bundle del dispositivo tenia los `testID` de `main`
// y ninguno de los de esta rama, con los tres flujos de `01-onboarding` en rojo.
//
// La API se busca a partir de la siguiente al de Metro, no desde su pedido: si
// ambos|subieran por separado desde 8081 podrian parar en el mismo puerto, y el
// segundo `ensureService` encontraria al primero ya escuchando.
const pedidoMetro = Number(process.env.E2E_METRO_PORT ?? 8081);
const pedidoApi = Number(process.env.E2E_API_PORT ?? 4011);
const PUERTO_METRO = await eligePuerto(pedidoMetro);
// La API empieza por encima del puerto que se le acabo de dar a Metro, y no por el
// suyo, para que los dos no puedan parar en el mismo sitio: `primerLibre` pregunta
// por uno solo y no sabe nada del otro.
const PUERTO_API = await eligePuerto(Math.max(pedidoApi, PUERTO_METRO + 1));
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
        PORT: String(PUERTO_API),
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
        String(PUERTO_METRO),
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
  // Y se dice de donde salio el puerto. Sin esta linea, una carrera que arranque en
  // 8083 porque el 8081 lo tiene otro proceso parece la de siempre y no explica por
  // que los puertos de este informe no son los del `.env.example`.
  if (PUERTO_METRO !== pedidoMetro || PUERTO_API !== pedidoApi) {
    console.log(`  puertos: Metro ${PUERTO_METRO} (pedido ${pedidoMetro}), API ${PUERTO_API} (pedido ${pedidoApi})`);
  }
  // `adb reverse` y no `adb forward`, y los dos puertos: la app corre DENTRO del
  // emulador y su loopback es el suyo propio. Sin excepcion que capturar: un reverse
  // que no se puede poner es un fallo de la carrera, no un aviso.
  for (const puerto of [PUERTO_METRO, PUERTO_API]) {
    adb(['reverse', `tcp:${puerto}`, `tcp:${puerto}`], serial);
  }
  // Y despues lo que hace que el reverseSirva de algo, que va antes de los reverses
  // en la explicacion y despues en el codigo porque no se puede probar hasta que los
  // puertos estan puestos.
  //
  // Y despues lo que hace que el reverse sirva de algo, que va antes de los
  // reverses en la explicacion y despues en el codigo porque no se puede probar
  // hasta que los puertos estan puestos.
  //
  // `adb reverse` solo, NO basta, y esto se creyo al reves durante semanas: la app no
  // pide el bundle por su loopback. React Native lee la preferencia
  // `debug_http_host` y, si no esta, cae a `10.0.2.2` -la IP del host vista desde el
  // emulador-, que no pasa por ningun reverse. Medido: la conexion TCP de la app era
  // `10.0.2.2:8081` (`1F91` en hex) mientras el reverse apuntaba a otro sitio, y el
  // bundle que ejecutaba traia los `testID` que ya existian en `main` y ninguno de los
  // de esta rama, con los tres flujos de `01-onboarding` en rojo sin que el arnes
  // dijera por que.
  //
  // **El orden de las dos lineas de aqui es lo que no se puede cambiar.** `pm clear`
  // antes que la preferencia, nunca al reves: el primero borra el directorio de datos
  // -y con el la propia preferencia-, y `limpiaDatos` deja escrito por que.
  limpiaDatos(serial);
  apuntaMetro(String(PUERTO_METRO), serial);
  console.log(`  adb reverse: ${PUERTO_METRO} y ${PUERTO_API} apuntando al host`);
  console.log(`  dev server de la app: localhost:${PUERTO_METRO} (preference debug_http_host)`);
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
    // Y aqui tambien, antes de la preferencia: si un flujo limpio los datos -y
    // `welcome` lo hace-, la preferencia se ha ido con ellos y el area siguiente
    // bajaria el bundle del host equivocado. Es el mismo orden que arriba y por el
    // mismo motivo, y va aqui porque por area es donde un flujo puede haber limpiado.
    limpiaDatos(serial);
    apuntaMetro(String(PUERTO_METRO), serial);
    const antes = { pid: appPid(serial) };

    const { flujo, cuantos } = corrida(area, flags.flow);
    // La siembra entera en el entorno, no solo lo que los flujos de hoy necesitan:
    // es lo que le hara falta a un flujo con sesion, y `Seeded` ya es un mapa de
    // cadenas. Sin escribir un `.env`: Maestro lee `${...}` del entorno, y ahi es
    // donde el plan prohibio escribir ficheros.
    const { code, output } = runMaestro(flujo, {
      cwd: RAIZ,
      env: { ...sembrado },
    });

    const guard = verdict(antes, { pid: appPid(serial) }, crashLines(serial));
    screenshot(serial, join(CAPTURAS, `${area.name}.png`));

    // `fallidos` sale de la salida de Maestro, que ya estaba en la mano y se
    // tiraba. Sin el, `Maestro fallo` en el informe es el nombre de la
    // herramienta que fallo y no el motivo, y el unico sitio donde estaba el
    // motivo son las lineas que se imprimen aqui y se pierden al salir.
    //
    // Y `flows` es `cuantos` de `corrida`, no `area.flows.length`: lo que se ha
    // corrido. Con `--flow` son uno, y decir tres era el informe pesando su propia
    // cobertura -el numero va en la fila y en la cuenta de caidos, y los dos
    // mienten a la vez-.
    const resultado: AreaResult = {
      area: area.name,
      flows: cuantos,
      maestroOk: code === 0,
      guard,
      fallidos: fallosDeMaestro(output),
    };
    resultados.push(resultado);
    // El veredicto sale de `veredictoArea`, la misma funcion que pinta la fila del
    // informe, y no de una condicion escrita aqui. Estaba escrita, y era
    // `guard.ok && code === 0`: `true` para un area sin flujos, mientras el
    // `verdict` de esa area es rojo porque a un area vacia nada la levanta. La
    // consola decia `FALLA ... la app se cerro` y el informe de la vez decia
    // `NADA ... sin flujos que probar`, y de los dos solo uno era verdad. Aqui ya
    // no hay nada que decidir: el area vacia es `NADA`, y `saleEnRojo` no cuenta un
    // `NADA`.
    const { estado, motivo } = veredictoArea(resultado);
    console.log(`  ${estado.padEnd(5)} ${area.name.padEnd(16)} ${motivo}`);
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
  //
  // Y el rojo sale de `saleEnRojo`, no de un contador que se lleva aqui: un
  // `fallos += 1` por area era la mitad del `exitCode` duplicada al lado de la otra
  // mitad que pinta el informe, y solo una de las dos estaba comprobada. La que
  // no se miraba era justo la que decidia el codigo de salida.
  if (areas.length === 0) {
    console.error('  no hay ningun area que recorrer');
    process.exitCode = 1;
  } else if (saleEnRojo(resultados)) {
    process.exitCode = 1;
  }
} finally {
  for (const s of servicios) await s.stop();
}
