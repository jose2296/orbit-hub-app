import { Platform } from 'react-native';

import type { PendingRequest } from '@/lib/api/client';

/**
 * Donde acaba el fichero de una exportacion, y como se lee despues.
 *
 * `expo-sharing` esta aqui porque no hay otra manera de que el fichero llegue a
 * la persona en iOS o Android: `expo-file-system` por si solo escribe dentro del
 * sandbox, donde nadie lo alcanza, y `Linking.openURL('file://…')` en iOS abre una
 * vista previa y no un "guardar". Guardar en Archivos *es* compartir. En la web
 * la rama es el `blob`, sin ningun modulo nativo que tocar.
 *
 * El reparto es el de `lib/notes/image-store.ts`: `Platform.OS === 'web'` se
 * comprueba *antes* de tocar nada nativo, y los modulos nativos se traen con
 * `await import(...)` dentro de la rama. Un bundle web que arrastra un modulo
 * nativo al cargar es un bundle web que no carga.
 */

export type ExportOutcome = 'downloaded' | 'shared';

interface FileSystemModule {
  Paths: { cache: unknown };
  File: {
    new (...parts: unknown[]): {
      uri: string;
      exists: boolean;
      text(): Promise<string>;
    };
    downloadFileAsync(
      url: string,
      destination: unknown,
      options?: { headers?: Record<string, string>; idempotent?: boolean },
    ): Promise<unknown>;
  };
}

interface SharingModule {
  shareAsync(url: string, options?: { mimeType?: string; dialogTitle?: string }): Promise<void>;
}

async function fileSystem(): Promise<FileSystemModule | null> {
  if (Platform.OS === 'web') return null;
  try {
    return (await import('expo-file-system')) as unknown as FileSystemModule;
  } catch {
    // Un movil cuyo modulo de ficheros no carga no puede exportar el fichero, y
    // eso es un fallo que hay que poder contar: no un `null` silencioso que la
    // hoja podria leer como "no habia nada que guardar".
    return null;
  }
}

async function sharing(): Promise<SharingModule | null> {
  if (Platform.OS === 'web') return null;
  try {
    return (await import('expo-sharing')) as unknown as SharingModule;
  } catch {
    return null;
  }
}

/**
 * El tipo del fichero, deducido del nombre en vez de recibido.
 *
 * La extension ya la puso `exportFilename` con el formato que se pidio, asi que
 * el `mimeType` sale de ahi. Pasarlo como argumento aparte seria un segundo sitio
 * donde el formato puede mentir, y un CSV anunciado como `application/json` es un
 * fichero que Excel se niega a abrir.
 */
function mimeTypeOf(filename: string): string {
  return filename.endsWith('.csv') ? 'text/csv' : 'application/json';
}

/**
 * La descarga del navegador: el `blob` de la respuesta, un `<a>` que nadie ve, y
 * el blob devuelto al sistema en cuanto se ha pulsado.
 */
async function downloadInBrowser(
  pending: PendingRequest,
  filename: string,
): Promise<'downloaded'> {
  // `blob()` y no el `text()` de `apiRequest`: una exportacion de varios megas
  // pasada por una cadena de JS es una exportacion que se va a base64 y se copia
  // otra vez de camino al disco.
  const response = await pending.send();
  let objectUrl: string | null = null;

  try {
    objectUrl = URL.createObjectURL(await response.blob());

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    // Va al documento solo mientras dura el `click()` y se va en cuanto termina:
    // hay navegadores que no disparan la descarga desde un `<a>` suelto, y un
    // nodo que se queda en el DOM es un nodo que alguien puede pulsar.
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
    }

    return 'downloaded';
  } finally {
    // Lo unico que `image-store.ts` no hace, y lo unico aqui que no es
    // opcional: alla sus object URLs se guardan en un mapa porque se reutilizan
    // para pintar imagenes, y una descarga se usa una vez. Sin revocar, cada
    // exportacion deja un blob entero --su `ArrayBuffer` y la copia que el
    // navegador hace de el-- retenido hasta que se cierre la pestana, y el
    // recolector no lo libera nunca mientras la URL siga viva. En un `finally`
    // porque el `click()` tambien puede lanzar.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * El fichero en el cache y el panel de compartir encima.
 *
 * El destino es el fichero con su nombre, no un directorio: `downloadFileAsync`
 * quiere una ruta de fichero, y el nombre es ademas el `dialogTitle` del panel.
 */
async function downloadToCacheAndShare(
  pending: PendingRequest,
  filename: string,
): Promise<'shared'> {
  const fs = await fileSystem();
  const share = await sharing();
  if (!fs || !share) {
    throw new Error('Este dispositivo no puede guardar el fichero de la exportacion');
  }

  // El cache y no el directorio de documentos porque el cache es lo unico que el
  // sistema puede recoger cuando le falta sitio, y donde acaba el fichero lo
  // decide la persona en el panel que viene despues, no este modulo.
  const destino = new fs.File(fs.Paths.cache, filename);

  // `idempotent` porque el nombre lleva la fecha: exportar la misma lista dos
  // veces el mismo dia da el mismo fichero, y sin esto la segunda vez falla con
  // `DestinationAlreadyExists` en vez de sobrescribir el anterior.
  await fs.File.downloadFileAsync(pending.url, destino, {
    headers: pending.headers,
    idempotent: true,
  });

  // El fichero no se borra despues. La app que recibe lo lee por la `uri` cuando
  // la persona elige destino, y ese momento es posterior a este `await`.
  await share.shareAsync(destino.uri, {
    mimeType: mimeTypeOf(filename),
    dialogTitle: filename,
  });

  return 'shared';
}

/**
 * Entrega el fichero de una exportacion a donde la persona pueda sacarlo.
 *
 * En la web se descarga; en un movil se escribe en el cache y se abre el panel de
 * compartir. El `pending` llega composed y sin enviar —con su URL y sus
 * cabeceras— porque en nativo quien descarga es `expo-file-system`, no `fetch`:
 * es la unica forma de que los bytes no pasen por la memoria de JS.
 */
export async function saveExport(args: {
  pending: PendingRequest;
  filename: string;
}): Promise<ExportOutcome> {
  if (Platform.OS === 'web') {
    return downloadInBrowser(args.pending, args.filename);
  }
  return downloadToCacheAndShare(args.pending, args.filename);
}

/**
 * El sobre del fichero que se acaba de escribir en el cache, o `null` si no se
 * puede leer.
 *
 * Vive aqui y no en el hook porque este modulo es el unico que sabe donde ha
 * quedado el fichero. En la web devuelve `null` sin hacer nada: ahi los bytes los
 * tiene la respuesta de la red, y releerlos del disco del navegador no existe.
 *
 * Se relee entero —unos cuantos megas por JS— porque es la unica manera de que el
 * numero que se ensena sea el del fichero que sale por pantalla, y porque leer no
 * es lo caro que fue escribir.
 */
export async function readSavedEnvelope(filename: string): Promise<unknown | null> {
  const fs = await fileSystem();
  if (!fs) return null;

  try {
    const file = new fs.File(fs.Paths.cache, filename);
    if (!file.exists) return null;
    return JSON.parse(await file.text());
  } catch {
    // Un sobre ilegible no es una exportacion fallida: el fichero ya esta
    // entregado y lo que se ha perdido son los numeros de la linea de debajo.
    return null;
  }
}