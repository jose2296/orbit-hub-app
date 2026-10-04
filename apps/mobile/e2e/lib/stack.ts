import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname } from 'node:path';

export type Service = {
  label: string;
  url: string;
  /** `false` cuando ya estaba corriendo: no lo paramos al terminar. */
  started: boolean;
  stop(): Promise<void>;
};

export type EnsureOptions = {
  label: string;
  url: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  logFile: string;
  timeoutMs?: number;
};

/**
 * Tope de la espera por un puerto. Alto a proposito, porque la API se da diez
 * segundos para cerrarse, y acotado a proposito tambien: un hijo colgado tiene
 * que poder hacer que el arnes salga igual, no dejarlo esperando para siempre.
 */
const STOP_TIMEOUT_MS = 12_000;
const STOP_POLL_MS = 100;

export async function isListening(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    // El cuerpo se tira aunque no interese: una espera larga pregunta cada medio
    // segundo, y una respuesta sin leer deja su socket cogido hasta que el
    // recolector pase por el.
    await respuesta.arrayBuffer();
    // Menor de 500, y no "ha contestado": la API responde 503 cuando su ping a la
    // base de datos falla, y un 503 con el puerto cogido no es un servicio listo.
    // Aceptarlo haria que el arnes dijera "arrancado" y le dejara al paso
    // siguiente una conexion que revienta en su primera consulta de verdad.
    return respuesta.status < 500;
  } catch {
    return false;
  }
}

export async function waitForHttp(
  url: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const limite = Date.now() + (opts.timeoutMs ?? 90_000);
  const cada = opts.intervalMs ?? 500;
  for (;;) {
    if (await isListening(url)) return true;
    if (Date.now() > limite) return false;
    await new Promise((r) => setTimeout(r, cada));
  }
}

/** Lo contrario que `waitForHttp`: espera a que la url deje de contestar. */
async function waitForPortFree(url: string, timeoutMs: number): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    if (!(await isListening(url))) return true;
    if (Date.now() > limite) return false;
    await new Promise((r) => setTimeout(r, STOP_POLL_MS));
  }
}

/**
 * La senal va al grupo entero, no solo al hijo. `npm run` deja nietos, el
 * servidor de la API y el de Metro entre ellos, que se quedan con el puerto
 * cogido, y a los nietos no les llega la senal que se manda al `npm`.
 */
function pararGrupo(pid: number | undefined): void {
  try {
    process.kill(-(pid as number), 'SIGTERM');
  } catch {
    /* ya estaba muerto, o nunca llego a existir */
  }
}

/**
 * Si el puerto se puede coger ahora mismo, intentandolo de verdad.
 *
 * Intentar y soltar es la unica respuesta fiable. Preguntar "hay alguien ahi" por
 * otra via -un `lsof`, un `/status`- dice lo mismo pero no sabe de quien es- deja
 * una carrera entre la pregunta y el uso, y ademas obliga a decidir con una
 * heuristica de quien es el dueno.
 *
 * Cierra el servidor y su socket antes de devolver, y no en un `finally`: si el
 * `listen` falla el servidor ya esta cerrado y no hay nada que cerrar.
 */
export async function puertoLibre(puerto: number): Promise<boolean> {
  // **Un solo bind no los ve a todos, y medido es asimetrico.** En macOS un socket en
  // `::` con IPv6 dual-stack choca con otro bind a `::` y con uno a `0.0.0.0`, pero un
  // servidor que solo escucha en `127.0.0.1` no se ve desde ninguno de los dos. Y al
  // reves, un servidor en `0.0.0.0` no se ve desde `::`. La tabla entera:
  //
  //     escucha      | bind ::  | bind 0.0.0.0 | bind 127.0.0.1
  //     -------------|----------|-------------|---------------
  //     127.0.0.1    | LIBRE    | LIBRE       | OCUPADO
  //     ::           | OCUPADO  | OCUPADO     | LIBRE
  //     0.0.0.0      | LIBRE    | OCUPADO     | LIBRE
  //
  // Por eso se prueban los tres y el puerto se da por ocupado en cuanto UNO falla:
  // cada fila de esa tabla tiene al menos un bind que la pilla, y preguntar por uno
  // solo deja un agujero. Con un solo bind el hueco es real y el arnes lo pisa: con
  // el bind a `::` creia tener el 8081, no arranco su Metro, reuso el del checkout
  // de al lado -que sirve otro codigo-, y los tres flujos de `01-onboarding` se
  // cayeron en su primera asercion sin que el arnes dijera por que.
  for (const host of DIRECCIONES_DE_BIND) {
    if (!(await bindUno(puerto, host))) return false;
  }
  return true;
}

/** Bind y cierre en una direccion. `false` si el puerto esta cogido ahi. */
function bindUno(puerto: number, host: string): Promise<boolean> {
  return new Promise<boolean>((resuelve) => {
    const servidor = createServer();
    servidor.once('error', () => resuelve(false));
    servidor.listen(puerto, host, () => servidor.close(() => resuelve(true)));
  });
}

/**
 * Las tres, y en este orden. La de `::` primero porque es donde escuchan Metro y la
 * API por defecto, y la de `127.0.0.1` la ultima porque es la unica que ve un
 * servidor atado solo al loopback -y la que hace falsa la pregunta si se prueba
 * sola-.
 */
const DIRECCIONES_DE_BIND = ['::', '0.0.0.0', '127.0.0.1'];

/**
 * El primer puerto libre a partir de `desde`, y `desde` si lo hay. La funcion pura
 * de `eligePuerto`, para poder probarla sin ocupar puertos de verdad.
 *
 * Sube y no baja, y no es capricho: los puertos que se elige son los que se pasan a
 * Metro y a la API, y bajando se acabaria en el rango de sistema.
 *
 * Lanza si en el rango no hay ninguno. Devolver el ultimo y dejar que el siguiente
 * paso falle al arrancar es peor: el fallo llegaria un minuto despues y sin decir
 * que el problema era el puerto.
 */
export async function primerLibre(
  desde: number,
  cuantos: number,
  libre: (puerto: number) => boolean | Promise<boolean>,
): Promise<number> {
  for (let i = 0; i < cuantos; i++) {
    if (await libre(desde + i)) return desde + i;
  }
  throw new Error(`no hay ningun puerto libre entre ${desde} y ${desde + cuantos - 1}`);
}

/** `primerLibre` sobre `puertoLibre`, que es como la usa el arnes. */
export function eligePuerto(desde: number, cuantos = 20): Promise<number> {
  return primerLibre(desde, cuantos, puertoLibre);
}

export async function ensureService(opts: EnsureOptions): Promise<Service> {
  if (await isListening(opts.url)) {
    return { label: opts.label, url: opts.url, started: false, stop: async () => {} };
  }

  mkdirSync(dirname(opts.logFile), { recursive: true });
  const log = openSync(opts.logFile, 'a');
  const hijo = spawn(opts.cmd, opts.args, {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, ...opts.env },
  });
  hijo.unref();

  // `spawn` no lanza cuando el comando no existe: el fallo sale en un evento
  // 'error' al siguiente tick, y sin un manejador se va como error no controlado
  // que no menciona el log. Convertido en promesa compite con la espera, y asi
  // los dos fallos, el comando que no esta y el servicio que no contesta, salen
  // con el mismo mensaje, que es lo que hace falta para diagnosticar cualquiera.
  const fallo = new Promise<never>((_listo, rechaza) => {
    hijo.once('error', (error) => rechaza(error));
  });

  const listo = await Promise.race([
    fallo,
    waitForHttp(opts.url, { timeoutMs: opts.timeoutMs }).then((respondio) => {
      if (!respondio) throw new Error(`nadie contesto en ${opts.url}`);
      return true;
    }),
  ]).catch((causa: unknown) => {
    pararGrupo(hijo.pid);
    const porque = causa instanceof Error ? `: ${causa.message}` : '';
    throw new Error(`${opts.label} no arranco. Su salida esta en ${opts.logFile}${porque}`);
  });

  return {
    label: opts.label,
    url: opts.url,
    started: listo,
    stop: async () => {
      pararGrupo(hijo.pid);
      // Y despues de la senal, esperar a que el puerto quede libre. Sin esa
      // espera el arnes se iria por encima de un servicio que aun no ha soltado
      // el puerto, y una carrera seguida de otra se engancharia a un proceso a
      // medio morir y lo leeria como "ya estaba en pie". Los dos servicios reales
      // sueltan el puerto en milisegundos -medido: 3ms la API, 21ms Metro-, asi
      // que esperar no cuesta nada; lo que cuesta es no depender de que eso siga
      // siendo cierto, y `stack.test.ts` lo fija con un hijo que se resiste.
      // Si dentro del tope no se libera, se avisa y se sigue. Avisa y no lanza a
      // proposito: este stop va dentro de un finally que tambien para al otro
      // servicio, y una excepcion aqui dejaria al segundo sin parar.
      if (!(await waitForPortFree(opts.url, STOP_TIMEOUT_MS))) {
        console.error(`  aviso: ${opts.label} sigue escuchando en ${opts.url} tras pararlo`);
      }
    },
  };
}
