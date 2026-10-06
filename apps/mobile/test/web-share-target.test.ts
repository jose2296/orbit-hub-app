import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface WebManifest {
  name: string;
  start_url: string;
  display: string;
  theme_color?: string;
  icons: { src: string; sizes: string; purpose?: string }[];
  share_target?: {
    action: string;
    method: string;
    enctype: string;
    params: { title?: string; text?: string; url?: string };
  };
}

const manifest = JSON.parse(
  readFileSync(join(appRoot, 'public', 'manifest.webmanifest'), 'utf8'),
) as WebManifest;

describe('el manifest declara el share target', () => {
  it('tiene action POST a /share-target con title, text y url', () => {
    expect(manifest.share_target?.action).toBe('/share-target');
    expect(manifest.share_target?.method).toBe('POST');
    expect(manifest.share_target?.enctype).toBe('application/x-www-form-urlencoded');
    expect(manifest.share_target?.params).toEqual({ title: 'title', text: 'text', url: 'url' });
  });

  it('sigue siendo instalable: nombre, iconos, display, start_url y theme_color', () => {
    expect(manifest.name).not.toHaveLength(0);
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).not.toHaveLength(0);
  });
});

// El SW se carga con readFileSync + new Function: sin fetch real, sin red.
function cargarSw() {
  const codigo = readFileSync(join(appRoot, 'public', 'service-worker.js'), 'utf8');
  const oyentes = new Map<string, (event: any) => void>();
  const selfMock = {
    location: { origin: 'https://app.test' },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve() },
    addEventListener: (tipo: string, fn: (event: any) => void) => {
      oyentes.set(tipo, fn);
    },
  };
  new Function('self', codigo)(selfMock);
  return oyentes;
}

function peticionShare({
  method = 'POST',
  ruta = '/share-target',
  campos,
  formRoto = false,
}: {
  method?: string;
  ruta?: string;
  campos?: Record<string, string>;
  formRoto?: boolean;
}) {
  const datos = new Map(Object.entries(campos ?? {}));
  return {
    method,
    url: `https://app.test${ruta}`,
    formData: async () => {
      if (formRoto) throw new Error('cuerpo ilegible');
      return { get: (clave: string) => datos.get(clave) ?? null };
    },
  };
}

async function lanzarFetch(oyentes: Map<string, (event: any) => void>, request: unknown) {
  let promesa: Promise<unknown> | null = null;
  const event = {
    request,
    respondWith: (p: Promise<unknown>) => {
      promesa = p;
    },
  };
  oyentes.get('fetch')!(event);
  return promesa;
}

describe('el service worker del share', () => {
  it('un POST a /share-target con url redirige a la pagina con query', async () => {
    const oyentes = cargarSw();
    const promesa = await lanzarFetch(
      oyentes,
      peticionShare({ campos: { title: 'Mi titulo', text: 'nota', url: 'https://ejemplo.test/nota' } }),
    );
    const respuesta = (await promesa) as unknown as Response;
    expect(respuesta.status).toBe(303);
    const destino = new URL(respuesta.headers.get('location')!);
    expect(destino.pathname).toBe('/share-target');
    expect(destino.searchParams.get('title')).toBe('Mi titulo');
    expect(destino.searchParams.get('text')).toBe('nota');
    expect(destino.searchParams.get('url')).toBe('https://ejemplo.test/nota');
  });

  it('un texto de 100 KB se trunca al techo y no rompe el redirect', async () => {
    const oyentes = cargarSw();
    const largo = 'x'.repeat(100 * 1024);
    const promesa = await lanzarFetch(
      oyentes,
      peticionShare({ campos: { text: largo, url: 'https://ejemplo.test/largo' } }),
    );
    const respuesta = (await promesa) as unknown as Response;
    expect(respuesta.status).toBe(303);
    const destino = new URL(respuesta.headers.get('location')!);
    expect(destino.searchParams.get('text')).toHaveLength(4096);
    expect(destino.searchParams.get('url')).toBe('https://ejemplo.test/largo');
  });

  it('un GET a /share-target pasa (no lo intercepta)', async () => {
    const oyentes = cargarSw();
    const promesa = await lanzarFetch(oyentes, peticionShare({ method: 'GET' }));
    expect(promesa).toBeNull();
  });

  it('un POST a otra ruta pasa', async () => {
    const oyentes = cargarSw();
    const promesa = await lanzarFetch(
      oyentes,
      peticionShare({ ruta: '/otra-ruta', campos: { url: 'https://ejemplo.test/x' } }),
    );
    expect(promesa).toBeNull();
  });

  it('sin url en el form, redirige igual con lo que haya', async () => {
    const oyentes = cargarSw();
    const promesa = await lanzarFetch(oyentes, peticionShare({ campos: { text: 'solo texto' } }));
    const respuesta = (await promesa) as unknown as Response;
    expect(respuesta.status).toBe(303);
    const destino = new URL(respuesta.headers.get('location')!);
    expect(destino.searchParams.get('text')).toBe('solo texto');
    expect(destino.searchParams.get('url')).toBeNull();
  });

  it('con el form ilegible, redirige igual y la pagina dira "nada que guardar"', async () => {
    const oyentes = cargarSw();
    const promesa = await lanzarFetch(oyentes, peticionShare({ formRoto: true }));
    const respuesta = (await promesa) as unknown as Response;
    expect(respuesta.status).toBe(303);
    expect(new URL(respuesta.headers.get('location')!).pathname).toBe('/share-target');
  });
});

vi.mock('expo-sharing', () => ({
  getSharedPayloads: () => [],
  clearSharedPayloads: () => {},
}));

import {
  borrarShareWeb,
  guardarShareWeb,
  hayQueryShare,
  leerShareWeb,
  parsearQueryShare,
} from '../src/lib/bookmarks/web-share';

// Almacen en memoria: el localStorage del navegador no existe en Node y la
// pagina lo recibe inyectado, asi que aqui se suple con un Map.
function almacenFalso() {
  const datos = new Map<string, string>();
  return {
    getItem: (clave: string) => (datos.has(clave) ? datos.get(clave)! : null),
    setItem: (clave: string, valor: string) => {
      datos.set(clave, valor);
    },
    removeItem: (clave: string) => {
      datos.delete(clave);
    },
  };
}

describe('la pagina share-target', () => {
  it('?url= sola da payload con titulo null', () => {
    expect(parsearQueryShare({ url: 'https://ejemplo.test/nota' })).toEqual({
      url: 'https://ejemplo.test/nota',
      title: null,
      text: null,
    });
  });

  it('?text= con URL adentro la extrae (reusa sacarUrlDelTexto)', () => {
    expect(
      parsearQueryShare({ text: 'mira esto https://ejemplo.test/nota que bueno' }),
    ).toEqual({
      url: 'https://ejemplo.test/nota',
      title: 'mira esto que bueno',
      text: 'mira esto https://ejemplo.test/nota que bueno',
    });
  });

  it('?title= + ?url= respeta el titulo que mando el navegador', () => {
    expect(
      parsearQueryShare({ title: 'Mi titulo', url: 'https://ejemplo.test/nota' }),
    ).toEqual({
      url: 'https://ejemplo.test/nota',
      title: 'Mi titulo',
      text: null,
    });
  });

  it('sin params da null y la pagina dice "nada que guardar"', () => {
    expect(parsearQueryShare({})).toBeNull();
    expect(hayQueryShare({})).toBe(false);
    const fuente = readFileSync(join(appRoot, 'src', 'app', 'share-target.tsx'), 'utf8');
    expect(fuente).toContain('share.save.emptyTitle');
    expect(fuente).toContain('share.save.emptyBody');
  });

  it('tras leer, la URL queda limpia (replace sin query)', () => {
    const fuente = readFileSync(join(appRoot, 'src', 'app', 'share-target.tsx'), 'utf8');
    expect(fuente).toContain(`router.replace('/share-target')`);
  });

  it('el parseo no esta copiado: sale de lib/bookmarks/share-intent', () => {
    const fuente = readFileSync(join(appRoot, 'src', 'lib', 'bookmarks', 'web-share.ts'), 'utf8');
    expect(fuente).toContain('sacarUrlDelTexto');
    expect(fuente).not.toContain('https?');
  });

  it('el anonimo vuelve con next a /share-target, como share/save', () => {
    const fuente = readFileSync(join(appRoot, 'src', 'app', 'share-target.tsx'), 'utf8');
    expect(fuente).toContain(`next: '/share-target'`);
  });

  it('la hoja es la misma de nativo, sin fork', () => {
    const fuente = readFileSync(join(appRoot, 'src', 'app', 'share-target.tsx'), 'utf8');
    expect(fuente).toContain(
      `import { ShareSaveSheet } from '@/components/bookmarks/share-save-sheet'`,
    );
    expect(fuente).toContain('<ShareSaveSheet');
  });

  it('onSaved borra la clave y onClose sin guardar no borra', () => {
    const fuente = readFileSync(join(appRoot, 'src', 'app', 'share-target.tsx'), 'utf8');
    const guardar = fuente.indexOf('const alGuardar');
    expect(guardar).toBeGreaterThan(-1);
    expect(fuente.slice(guardar, guardar + 400)).toContain('borrarShareWeb()');
    const volver = fuente.indexOf('const volver');
    expect(volver).toBeGreaterThan(-1);
    expect(fuente.slice(volver, volver + 200)).not.toContain('borrarShareWeb');
  });
});

describe('el pendiente del share web en localStorage', () => {
  it('guardar y leer devuelve el mismo payload', () => {
    const almacen = almacenFalso();
    const payload = { url: 'https://ejemplo.test/nota', title: 'Mi titulo', text: null };
    guardarShareWeb(payload, almacen);
    expect(leerShareWeb(almacen)).toEqual(payload);
  });

  it('borrar deja la lectura en null', () => {
    const almacen = almacenFalso();
    guardarShareWeb({ url: 'https://ejemplo.test/x', title: null, text: null }, almacen);
    borrarShareWeb(almacen);
    expect(leerShareWeb(almacen)).toBeNull();
  });

  it('un JSON roto se lee como null, no revienta', () => {
    const almacen = almacenFalso();
    almacen.setItem('orbithub:pending-share-web', '{roto');
    expect(leerShareWeb(almacen)).toBeNull();
  });

  it('un JSON sin url valida se lee como null', () => {
    const almacen = almacenFalso();
    almacen.setItem('orbithub:pending-share-web', JSON.stringify({ title: 'sin enlace' }));
    expect(leerShareWeb(almacen)).toBeNull();
  });
});
