import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

export const ADB =
  process.env.ANDROID_ADB ?? `${homedir()}/Library/Android/sdk/platform-tools/adb`;
export const PAQUETE = process.env.PAQUETE ?? 'com.jrzlabs.orbithub';

export type Device = { serial: string; state: string };

/**
 * Tope de la salida de un hijo de adb, en bytes.
 *
 * `execFileSync` corta en un megasibyte por defecto y lanza `ENOBUFS` al pasarse,
 * asi que el tope hay que ponerlo aqui y no donde duela: `crashLines` lee
 * `logcat -d -b crash` por esta misma funcion, y esa es la lectura de la que
 * depende el veredicto entero. Un `ENOBUFS` ahi no es un fallo de la lectura, es el
 * harness entero tirando la prueba que no podia hacer -y `crashLines` lanza a
 * proposito cuando adb falla, porque un buffer de fallos que no se ha podido leer no
 * es un buffer limpio-.
 *
 * 64 MB es muy superior a lo que devuelve cualquiera de estas llamadas en la
 * practica -`logcat -c` no devuelve nada, `devices` dos lineas, `pidof` un numero-,
 * y sigue siendo un tope: `adb` colgado escribiendo sin parar no se come la memoria
 * de la maquina sin limite.
 */
const MAX_BUFFER_ADB = 64 * 1024 * 1024;

export function adb(args: string[], serial?: string): string {
  return execFileSync(ADB, [...(serial ? ['-s', serial] : []), ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_ADB,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The pure half of `adb devices`: everything not in state `device` is dropped
 * here. Split out so it can be tested — `devices()` itself shells out to adb and
 * cannot be.
 *
 * The header goes because it does not look like a device row, not because it is
 * the first line. Dropping by position throws away whatever happens to be first,
 * and if that happens to be a real device then `pickDevice` sees fewer devices
 * than exist — the one thing it exists to prevent.
 */
export function parseDevices(salida: string): Device[] {
  return salida
    .split('\n')
    .map((linea) => linea.trim().split(/\s+/))
    .filter((partes): partes is [string, string] => partes.length >= 2 && partes[1] === 'device')
    .map(([serial, state]) => ({ serial, state }));
}

export function devices(): Device[] {
  return parseDevices(adb(['devices']));
}

export function pickDevice(conectados: Device[]): string {
  if (conectados.length === 0) throw new Error('no hay ningun dispositivo android conectado');
  if (conectados.length > 1) {
    throw new Error(
      `hay mas de un dispositivo android conectado: ${conectados.map((d) => d.serial).join(', ')}. ` +
        'Deja uno solo, o reinicia el emulador.',
    );
  }
  return conectados[0]!.serial;
}

export function requireOneDevice(): string {
  return pickDevice(devices());
}

/**
 * `pidof` returns nothing both when the app is dead and when it never ran, so
 * `null` here means "no hay proceso" and the caller treats it as a fault.
 */
export function appPid(serial: string, pkg: string = PAQUETE): string | null {
  try {
    return (adb(['shell', 'pidof', pkg], serial) || '').trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

/**
 * The crash lines the device admits to, `FATAL EXCEPTION` first.
 *
 * An adb failure is NOT an empty buffer. Swallowing it here would let a harness
 * with a wrong `adb` path see a clean crash log and pass every flow, which is the
 * worst way for this harness to be wrong. It throws instead, so the run dies at
 * the step that could not talk to the device.
 *
 * `FATAL EXCEPTION` is a dead native process; `JavascriptException` is a red
 * screen that may well have recovered. Reporting the native crash in preference
 * to the JS one matches the order the signals are checked in, and this array is
 * ordered so `crashes[0]` is the one that matters. Order within each kind is the
 * buffer's own.
 */
export function crashLines(serial: string): string[] {
  const lineas = adb(['logcat', '-d', '-b', 'crash', '-v', 'brief'], serial)
    .split('\n')
    .filter((linea) => /FATAL EXCEPTION|JavascriptException/.test(linea));
  return [
    ...lineas.filter((linea) => linea.includes('FATAL EXCEPTION')),
    ...lineas.filter((linea) => linea.includes('JavascriptException')),
  ];
}

export function clearLogcat(serial: string): void {
  adb(['logcat', '-c'], serial);
}

/**
 * Asks the system to kill the app. Swallows the failure on purpose: a package
 * that was not running is the state this is trying to reach.
 *
 * It does NOT reset the baseline pid, and it does not clear the log. Reading a
 * baseline that belongs to this run is the caller's job, and it needs clearLogcat
 * and forceStop in that order, before the first `appPid`.
 */
export function forceStop(serial: string, pkg: string = PAQUETE): void {
  try {
    adb(['shell', 'am', 'force-stop', pkg], serial);
  } catch {
    /* si no estaba corriendo, no hay nada que parar */
  }
}

export function screenshot(serial: string, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  // Straight to the file, with no shell in between. Interpolating a serial and a
  // path into `sh -c` means a space, a quote or a `$` in either one decides what
  // runs; passing the same words as an argv cannot.
  //
  // `maxBuffer` es obligatorio y no es un adorno. `execFileSync` corta la salida
  // del hijo en un megasibyte por defecto y lanza `ENOBUFS` al pasarse: un PNG de
  // 1080x2400 pesa entre 1 y 2 megas, y el de este emulador medido 1_058_378
  // bytes -nueve mil por encima del limite-. Con el limite por defecto esta funcion
  // falla en una pantalla con muchos pixeles distintos y se pasa en otra con menos,
  // que es peor que no funcionar: el harness escribe la captura que prueba que ha
  // mirado la app, y que falle depende de lo que haya en la pantalla. 32 MB es muy
  // superior a cualquier captura real y sigue siendo un tope.
  writeFileSync(
    file,
    execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 32 * 1024 * 1024 }),
  );
}

/**
 * `pm clear`: borra el directorio de datos de la app entera.
 *
 * Va en el arnes y no en los flujos a proposito, y por el orden. El flujo de
 * bienvenida necesita arrancar sin sesion -un emulador que alguien dejo con la sesion
 * abierta devuelve el panel, y el flujo se pasa probando el panel-, y lo hace con
 * `clearState: true`, que es exactamente este `pm clear`. Pero `clearState` borra
 * tambien la SharedPreferences `debug_http_host` de la que depende `apuntaMetro`,
 * asi que si el runner escribe la preferencia y luego el flujo limpia, la
 * preferencia se va con los datos.
 *
 * Medido de las dos formas, con el 8081 del host ocupado por el Metro de otro
 * checkout: `pm clear` y luego la preferencia deja la app en `screen-welcome` con
 * sus `testID`; la preferencia y luego `pm clear` deja la app en el panel, sin un
 * solo `testID` de esta rama, y los tres flujos del area caen en su primera
 * asercion. El orden lo elige quien puede hacer las dos cosas, y ese es el arnes.
 *
 * Traga el fallo: un `pm clear` que no va es un flujo que va a arrancar con el
 * estado que hubiera, que es justo lo que este borra para que no pase. Un aviso
 * aqui seria un flujo verde probando el panel de la sesion de ayer.
 */
export function limpiaDatos(serial: string, pkg: string = PAQUETE): void {
  const salida = adb(['shell', 'pm', 'clear', pkg], serial).trim();
  // `pm clear` responde `Success` y sale con codigo 0 tambien cuando no lo ha hecho.
  // `Failure` y el texto de "no se puede" son la unica senal, y medido en un paquete
  // que no existe: `Failed` y nada mas. Sin esta comprobacion el arnes sigue como
  // si hubiera limpiado.
  if (!/^Success/i.test(salida)) {
    throw new Error(`pm clear de ${pkg} no salio con Success, salio con: ${salida || '(nada)'}`);
  }
}

/**
 * El XML de las preferencias por defecto de la app con el host del dev server
 * dentro. La funcion pura de `apuntaMetro`, para poder probarla sin un dispositivo.
 *
 * El nombre del fichero no es libre y lo pone `apuntaMetro`, no esta funcion: lo
 * decide `PreferenceManager.getDefaultSharedPreferences`, que es
 * `<paquete>_preferences.xml`. Aqui solo se escribe el contenido.
 *
 * **Por que hace falta esto y no basta con `adb reverse`.** React Native lee la
 * preferencia `debug_http_host` en `PackagerConnectionSettings.getDebugServerHost()`
 * y, si esta vacia, cae a `AndroidInfoHelpers.getServerHost()`, que en un emulador
 * es `10.0.2.2`. Ahi esta la clave: `10.0.2.2` es la IP del host tal y como la ve el
 * emulador, asi que la peticion sale por ahi y **`adb reverse` no participa**. Medido
 * en este harness: con el 8081 del host ocupado por el Metro de otro checkout, la app
 * recibia el bundle de alli -con los `testID` de ahi, no con los de esta rama- y los
 * tres flujos de `01-onboarding` se caian en su primera asercion sin que nada mas
 * pareciera roto. Con el 8081 del host libre el mismo arnes daba verde, lo que lo
 * hacia depender de un puerto que no le pertenece.
 *
 * Con `localhost:<puerto>` la peticion sale por el loopback del emulador, que si
 * honra `adb reverse`, y el arnes deja de depender de que el 8081 este libre.
 */
export function xmlPrefsMetro(host: string): string {
  // `&` primero a proposito: si se escapara al final, lo ya escapado se escaparia
  // otra vez y `&lt;` acabaria siendo `&amp;lt;`.
  const escapado = host.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n" +
    `<map><string name="debug_http_host">${escapado}</string></map>\n`
  );
}

/**
 * Le dice a la app de donde es su Metro, y la deja parada para que el proceso
 * siguiente lo lea. Es lo que hace que el arnes no dependa del 8081: ver
 * `xmlPrefsMetro` para la medicion.
 *
 * El `forceStop` va dentro y no lo elige el llamador porque el orden es parte de lo
 * que se garantiza: el host se cachea en un companion object estatico
 * (`PackagerConnectionSettings._cachedOrOverrideHost`) que solo se limpia al construir
 * `PackagerConnectionSettings`, o sea al arrancar el proceso. Escribir la preferencia
 * con la app viva no cambiaria nada hasta el siguiente arranque, que es justo cuando
 * el bundle ya se ha pedido al sitio equivocado.
 *
 * Falla si `run-as` no va, y tiene que fallar: es una app `debuggable` o no lo es, y
 * un "bundle del host equivocado" silencioso es el fallo que esta funcion evita.
 */
export function apuntaMetro(puerto: string | number, serial: string, pkg: string = PAQUETE): void {
  // Las comillas van DENTRO del argumento de `-c`, y no se las pone el shell de
  // fuera. Dos cosas medidas aqui, y las dos por el mismo motivo -`adb shell` junta
  // sus argumentos con espacios y se los pasa al shell del dispositivo como una
  // sola cadena, asi que el quoting lo decide quien arma esa cadena:
  //
  //   1. Sin la comilla interior, `sh -c` recibe solo la primera palabra de la
  //      cadena: `mkdir` sin argumentos, y el `cat > ...` ejecutandose en el shell
  //      del dispositivo en vez de en el de `run-as`. Medido:
  //      `mkdir: Needs 1 argument (see "mkdir --help")`, y el fichero no existe
  //      despues.
  //   2. Rutas absolutas, no `shared_prefs/...`. El `sh` de `run-as` si arranca en el
  //      directorio de datos de la app, pero el `cat` del punto 1 no, y ahi no hay
  //      nada que resolver. El directorio de datos es `/data/user/0/<paquete>` sin
  //      multiusuario.
  //
  // Y el `mkdir -p` va del DIRECTORIO, nunca del fichero: `mkdir -p` sobre
  // `<fichero>.xml` lo crea como directorio vacio y el `cat` de despues falla con
  // `Is a directory`. Medido, y por eso el fichero que hay en el dispositivo ahora
  // mismo es un directorio con el nombre del XML dentro, que hay que borrar a mano
  // antes de volver a medir nada. El `shared_prefs` puede no existir: lo crea el
  // primer arranque de la app, y `pm clear` lo borra.
  const dir = `/data/user/0/${pkg}/shared_prefs`;
  const destino = `${dir}/${pkg}_preferences.xml`;
  execFileSync(
    ADB,
    ['-s', serial, 'shell', 'run-as', pkg, 'sh', '-c', `'mkdir -p ${dir} && cat > ${destino}'`],
    {
      input: xmlPrefsMetro(`localhost:${String(puerto)}`),
      maxBuffer: MAX_BUFFER_ADB,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  forceStop(serial, pkg);
}