import type { AccountExport, CollectionExport, ExportFormat, ListExport } from '@orbit-hub/contracts';
import {
  accountExportSchema,
  collectionExportSchema,
  exportFilename,
  listExportSchema,
} from '@orbit-hub/contracts';
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
 * Los dos formatos que llevan sobre son JSON, asi que el mismo `Accept`, el mismo
 * sobre y el mismo nombre con distinta extension. Un CSV no lleva sobre —son
 * filas— y por eso los `counts` pueden ser `null` sin que eso sea un fallo.
 */
async function envelopeOf(
  response: Response,
): Promise<AccountExport | CollectionExport | ListExport | null> {
  try {
    // `json()` devuelve `any` en las typings de DOM, asi que el tipo lo pone el
    // contrato; lo que lo comprueba de verdad es `countsOf`, que vuelve a pasar
    // esos numeros por el schema.
    return (await response.json()) as AccountExport | CollectionExport | ListExport;
  } catch {
    return null;
  }
}

/**
 * Los numeros del sobre, leidos del contrato y no contados aqui.
 *
 * Que los diga el propio fichero y no el cliente es el punto: el numero que se
 * ensena es el que va a salir por pantalla.
 *
 * Se parsea **solo** `counts`, con el `shape.counts` del schema que sea. No es por
 * la memoria —el sobre entero ya esta construido y recorrido de todos modos, con
 * su `clone()` y su `json()`— sino por el trabajo del validador: recorrer y
 * comprobar diez mil elementos para descartar un numero ya bueno es lo que cuesta,
 * y no hace falta pagarlo para una linea de resumen.
 *
 * El de la cuenta va primero porque es el que no encaja dentro del otro: los
 * `counts` de una lista son solo `{items}` y el schema de la cuenta exige el
 * resto. Al reves no se puede distinguir —el schema de una lista acepta los de la
 * cuenta y se queda con el `items`— asi que el orden es lo unico que decide.
 *
 * Los tres `counts` son **mutuamente excluyentes por sus claves**, y eso es lo que
 * hace que un `safeParse` baste para distinguirlos: el de la cuenta pide los siete,
 * el de una lista pide `items` y el de una coleccion pide `bookmarks`. El par de
 * arriba **necesita** orden —por eso el de la cuenta va primero— porque el schema
 * de una lista acepta los `counts` de la cuenta y se queda con el `items`. El
 * tercero no lo necesita: ni `{items}` ni `{bookmarks}` se parecen al otro, asi que
 * su rama puede ir donde sea y no es un caso especial.
 *
 * Un sobre que no es ninguno de los tres da `null` y no un fallo: cuando se llega
 * aqui el fichero ya esta entregado, y un `counts` que no se reconoce es una
 * linea de menos, no una exportacion perdida.
 */
function countsOf(
  envelope: AccountExport | CollectionExport | ListExport | null,
): AccountExport['counts'] | CollectionExport['counts'] | ListExport['counts'] | null {
  if (!envelope) return null;

  const cuenta = accountExportSchema.shape.counts.safeParse(envelope.counts);
  if (cuenta.success) return cuenta.data;

  const lista = listExportSchema.shape.counts.safeParse(envelope.counts);
  if (lista.success) return lista.data;

  const coleccion = collectionExportSchema.shape.counts.safeParse(envelope.counts);
  return coleccion.success ? coleccion.data : null;
}

export interface ExportResult {
  /** Los numeros del sobre, o `null` cuando el formato no lleva sobre (un CSV). */
  counts:
    | AccountExport['counts']
    | CollectionExport['counts']
    | ListExport['counts']
    | null;
  /** Lo que paso de verdad: descargado en la web, compartido en un movil. */
  how: Awaited<ReturnType<typeof saveExport>>;
  /** El nombre del fichero entregado, que es lo que va en "Guardado como…". */
  filename: string;
}

export interface ExportRequest {
  path: string;
  format: ExportFormat;
  title: string;
  fallbackId: string;
}

/**
 * La exportacion entera: pedirla, entregarla y leer de ella los numeros.
 *
 * Vive fuera del hook, y no por separacion de intereses sino porque es lo unico
 * que se puede probar sin un telefono delante: `run` solo puede ejecutarse dentro
 * de un render, y en este repositorio no hay renderer. Las dos ramas —web y
 * movil— se ejecutan en los tests de `test/export.test.ts` poniendo el `Platform.OS`
 * del stub y suplantando los modulos nativos.
 *
 * Y son justo las dos mitades que hay que mirar: que el fichero se baje **una**
 * sola vez y que los numeros salgan del mismo fichero que se entrega.
 */
export async function deliverExport(args: ExportRequest): Promise<ExportResult> {
  // El dia en UTC porque es lo unico que pueden ponerse de acuerdo el cliente y el
  // servidor sin preguntar la zona a nadie, y el nombre que pone el servidor en su
  // `Content-Disposition` es este mismo.
  const filename = exportFilename({
    title: args.title,
    fallbackId: args.fallbackId,
    extension: args.format,
    date: new Date().toISOString().slice(0, 10),
  });

  const pending = await apiRaw(args.path, {
    query: { format: args.format },
    timeoutMs: EXPORT_TIMEOUT_MS,
  });

  // Una sola peticion para las dos mitades del trabajo. En la web hay que tener la
  // `Response` a la vista —para el `blob` de la descarga y para el sobre— asi que
  // se envia aqui y a `saveExport` se le pasa esa misma respuesta ya enviada: el
  // `send` de mentira no es una segunda descarga, y por eso `saveExport` recibe un
  // `pending` y no una URL. En nativo no se manda nada desde JS; los bytes los baja
  // `expo-file-system` desde la URL con las cabeceras del `pending`, y el sobre se
  // relee del cache, que es donde ha quedado.
  let envelope: AccountExport | CollectionExport | ListExport | null;
  let how: ExportResult['how'];

  if (Platform.OS === 'web') {
    const response = await pending.send();
    // `clone()` antes de que nadie lea el cuerpo: las dos ramas leen de la misma
    // respuesta y un cuerpo se consume una sola vez.
    envelope = args.format === 'json' ? await envelopeOf(response.clone()) : null;
    how = await saveExport({
      pending: { ...pending, send: async () => response },
      filename,
    });
  } else {
    how = await saveExport({ pending, filename });
    envelope = await readSavedEnvelope({ filename, format: args.format });
  }

  return { counts: countsOf(envelope), how, filename };
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
  run(args: ExportRequest): Promise<ExportResult | null>;
}

/**
 * Descargar la cuenta entera, o una lista, y dejarla donde se pueda abrir.
 *
 * El estado es lo que hay: lo que va, lo que fallo y lo que salio — **y nada de
 * la vez anterior sobrevive a un intento nuevo.** `run` vacia `error`, `result` y
 * `filename` al empezar y no al acertar, por una sola razon: un error nuevo
 * pegado al `result` de una exportacion buena es una contradiccion en pantalla.
 * Los dos se dibujan a la vez y el panel acabaria atribuyendo a este intento unos
 * numeros que salieron de otro fichero. Despues de un fallo hay `error` y nada
 * mas, y el `result` de antes ya no esta en ninguna parte.
 *
 * Un fallo **no se relanza**: vuelve como `null` y con `error` a mano, porque
 * quien llama es una hoja, y una hoja a la que se le relanza el error no tiene
 * nada que pintar ni boton de reintentar.
 */
export function useExport(): UseExport {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  async function run(args: ExportRequest): Promise<ExportResult | null> {
    setRunning(true);
    // Los tres estados del intento anterior se van aqui y no al acertar; el
    // porqué esta en el doc de `run` y no cabe en una linea. Un intento empieza
    // sin nada de la vez anterior encima, y un fallo no los devuelve.
    setError(null);
    setResult(null);
    setFilename(null);

    try {
      const entregado = await deliverExport(args);
      setResult(entregado);
      setFilename(entregado.filename);
      return entregado;
    } catch (caught) {
      // Solo `error`. Lo que se vacio al entrar no vuelve aqui, asi que despues
      // de este fallo no hay ningun `result` al lado — y **no se relanza**, que es
      // la otra mitad de lo que dice el doc de `run`: quien llama es una hoja, y
      // `null` con `error` a mano es lo que le deja pintar un motivo y ofrecer el
      // reintento. Que un 422 o un 409 no tengan frase propia lo decide
      // `exportErrorKey`, no este hook — un 403 y un 404 si la tienen—; aqui solo
      // se guarda lo que fallo.
      setError(toApiError(caught));
      return null;
    } finally {
      setRunning(false);
    }
  }

  return { running, error, filename, result, run };
}
