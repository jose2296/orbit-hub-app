import type { AccountExport, ExportFormat, ListExport } from '@orbit-hub/contracts';
import { accountExportSchema, exportFilename, listExportSchema } from '@orbit-hub/contracts';
import { useState } from 'react';
import { Platform } from 'react-native';

import type { ApiError } from '@/lib/api/client';
import { apiRaw, toApiError } from '@/lib/api/client';
import { readSavedEnvelope, saveExport } from '@/lib/export/save';

/**
 * Dos minutos, y no el `DEFAULT_TIMEOUT_MS` de quince segundos.
 *
 * Ese esta puesto para un JSON pequeno —una lista, una nota— y una exportacion de
 * la cuenta son varios megas. En datos moviles eso se va de sobra en quince
 * segundos, y el resultado no es un timeout sino un "no se pudo descargar" sobre
 * una descarga que iba bien. Un timeout que se dispara pronto no cuesta nada: la
 * persona vuelve a pulsar.
 */
export const EXPORT_TIMEOUT_MS = 120_000;

/**
 * El sobre del que salen los numeros que se ensenan.
 *
 * Los dos formatos son JSON y por eso los dos tienen el mismo `Accept`, el mismo
 * sobre y el mismo nombre con distinta extension. Un CSV no lleva sobre —son
 * filas— y por eso los `counts` pueden ser `null` sin que eso sea un fallo.
 */
async function envelopeOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Los numeros del sobre, leidos del contrato y no contados aqui.
 *
 * Que los diga el propio fichero y no el cliente es el punto: el numero que se
 * ensena es el que va a salir por pantalla. Y se lee solo `counts`, con el
 * `shape.counts` del schema que sea, porque validar diez mil elementos para
 * descartar un numero ya bueno no es lo que se paga por una linea de resumen.
 *
 * El de la cuenta va primero porque es el que no encaja dentro del otro: los
 * `counts` de una lista son solo `{items}` y el schema de la cuenta exige el
 * resto. Al reves no se puede distinguir —el schema de una lista acepta los de la
 * cuenta y se queda con el `items`— asi que el orden es lo unico que decide.
 *
 * Un sobre que no es ninguno de los dos da `null` y no un fallo: cuando se llega
 * aqui el fichero ya esta entregado, y un `counts` que no se reconoce es una
 * linea de menos, no una exportacion perdida.
 */
function countsOf(envelope: unknown): AccountExport['counts'] | ListExport['counts'] | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const counts = (envelope as { counts?: unknown }).counts;

  const cuenta = accountExportSchema.shape.counts.safeParse(counts);
  if (cuenta.success) return cuenta.data;

  const lista = listExportSchema.shape.counts.safeParse(counts);
  return lista.success ? lista.data : null;
}

export interface ExportResult {
  /** Los numeros del sobre, o `null` cuando el formato no lleva sobre (un CSV). */
  counts: AccountExport['counts'] | ListExport['counts'] | null;
  /** Lo que paso de verdad: descargado en la web, compartido en un movil. */
  how: Awaited<ReturnType<typeof saveExport>>;
  /** El nombre del fichero entregado, que es lo que va en "Guardado como…". */
  filename: string;
}

export interface UseExport {
  /** Hay una exportacion en marcha: el boton que la lanza esta pulsado. */
  running: boolean;
  /** El fallo de la ultima, para pintoarlo como reintentable. */
  error: ApiError | null;
  /** El nombre del ultimo fichero entregado. */
  filename: string | null;
  /** Lo que salio de la ultima que llego bien. */
  result: ExportResult | null;
  run(args: {
    path: string;
    format: ExportFormat;
    title: string;
    fallbackId: string;
  }): Promise<ExportResult | null>;
}

/**
 * Descargar la cuenta entera, o una lista, y dejarla donde se pueda abrir.
 *
 * El estado es lo que hay: lo que va, lo que fallo y lo que salio. Un fallo no
 * borra lo anterior ni se relanza —vuelve como `null` y con `error` a mano—
 * porque quien llama es una hoja, y una hoja que desaparece con el error no
 * tiene nada que pintar ni boton de reintentar.
 */
export function useExport(): UseExport {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  async function run(args: {
    path: string;
    format: ExportFormat;
    title: string;
    fallbackId: string;
  }): Promise<ExportResult | null> {
    setRunning(true);
    // El error anterior se va al empezar y no al acabar: mientras va, lo que se
    // ve es "preparando el fichero", no el fallo de la vez anterior.
    setError(null);

    // El dia en UTC porque es lo unico que pueden ponerse de acuerdo el cliente
    // y el servidor sin preguntar la zona a nadie, y el nombre que puesto el
    // servidor en su `Content-Disposition` es este mismo.
    const name = exportFilename({
      title: args.title,
      fallbackId: args.fallbackId,
      extension: args.format,
      date: new Date().toISOString().slice(0, 10),
    });

    try {
      const pending = await apiRaw(args.path, {
        query: { format: args.format },
        timeoutMs: EXPORT_TIMEOUT_MS,
      });

      // Una sola peticion para las dos mitades del trabajo. En la web hay que
      // tener la `Response` a la vista —para el `blob` de la descarga y para el
      // sobre— asi que se envia aqui y a `saveExport` se le pasa la misma
      // respuesta ya enviada: el `send` de mentira no es una segunda descarga.
      // En nativo no se manda nada desde JS; los bytes los baja
      // `expo-file-system` desde la URL con las cabeceras del `pending`, y el
      // sobre se relee del cache, que es donde ha quedado.
      let envelope: unknown;
      let how: ExportResult['how'];

      if (Platform.OS === 'web') {
        const response = await pending.send();
        // `clone()` antes de que nadie lea el cuerpo: las dos ramas leen de la
        // misma respuesta y un cuerpo se consume una sola vez.
        envelope = args.format === 'json' ? await envelopeOf(response.clone()) : null;
        how = await saveExport({
          pending: { ...pending, send: async () => response },
          filename: name,
        });
      } else {
        how = await saveExport({ pending, filename: name });
        envelope = args.format === 'json' ? await readSavedEnvelope(name) : null;
      }

      const entregado: ExportResult = { counts: countsOf(envelope), how, filename: name };
      setResult(entregado);
      setFilename(name);
      return entregado;
    } catch (caught) {
      // Ni se borra lo de antes ni se relanza. Un 403 o un 404 tampoco lo
      // borran: no son un fallo de la descarga sino de lo que se pidio, y quien
      // esta mirando ya tiene delante lo que funcionaba la vez anterior.
      setError(toApiError(caught));
      return null;
    } finally {
      setRunning(false);
    }
  }

  return { running, error, filename, result, run };
}