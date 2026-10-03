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

export async function isListening(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
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

  const listo = await waitForHttp(opts.url, { timeoutMs: opts.timeoutMs });
  if (!listo) {
    try {
      process.kill(-(hijo.pid as number), 'SIGTERM');
    } catch {
      /* ya estaba muerto */
    }
    throw new Error(
      `${opts.label} no contesto en ${opts.url}. Su salida esta en ${opts.logFile}`,
    );
  }

  return {
    label: opts.label,
    url: opts.url,
    started: true,
    stop: async () => {
      try {
        // El grupo entero, no solo el hijo: `npm run` deja nietos que se quedan
        // con el puerto cogido y hacen que la siguiente carrera falle por un
        // puerto ocupado en lugar de por un fallo real.
        process.kill(-(hijo.pid as number), 'SIGTERM');
      } catch {
        /* ya estaba muerto */
      }
    },
  };
}