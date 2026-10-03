import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
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
