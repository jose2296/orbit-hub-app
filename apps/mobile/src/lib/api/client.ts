import type { ApiErrorCode } from '@orbit-hub/contracts';

import { API_BASE_URL, DEFAULT_TIMEOUT_MS } from './config';

export type ApiErrorKind = ApiErrorCode | 'network' | 'timeout' | 'offline' | 'unknown';

/** Every failed request surfaces as this error, so screens have one shape to handle. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly fields: Record<string, string>;
  readonly requestId: string | null;

  constructor(params: {
    kind: ApiErrorKind;
    message: string;
    status?: number | null;
    fields?: Record<string, string>;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.kind = params.kind;
    this.status = params.status ?? null;
    this.fields = params.fields ?? {};
    this.requestId = params.requestId ?? null;
  }

  get isRetryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'rate_limited';
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    return new ApiError({ kind: 'unknown', message: error.message });
  }
  return new ApiError({ kind: 'unknown', message: 'Unexpected error' });
}

type TokenProvider = () => Promise<string | null>;
type UnauthorizedHandler = () => Promise<boolean>;

let getAccessToken: TokenProvider = async () => null;
let onUnauthorized: UnauthorizedHandler = async () => false;

/**
 * Wires the API client to the auth layer. Called once by the auth client so the
 * network layer never imports the session store (which would create a cycle).
 */
export function configureApiClient(options: {
  getAccessToken?: TokenProvider;
  onUnauthorized?: UnauthorizedHandler;
}): void {
  if (options.getAccessToken) getAccessToken = options.getAccessToken;
  if (options.onUnauthorized) onUnauthorized = options.onUnauthorized;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the Authorization header (login, register, refresh). */
  anonymous?: boolean;
  /** Do not attempt a token refresh + retry on 401. */
  noRetryOnUnauthorized?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalisedPath}`;

  if (!query) return url;

  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return params.length > 0 ? `${url}?${params.join('&')}` : url;
}

/**
 * React Native ships narrower AbortController typings than the DOM, so the
 * controller is used through this minimal local interface.
 */
interface AbortableController {
  signal: AbortSignal;
  abort: () => void;
}

function createRequestSignal(external?: AbortSignal): {
  signal: AbortSignal;
  abort: () => void;
  dispose: () => void;
} {
  const controller = new AbortController() as AbortableController;
  const cleanups: (() => void)[] = [];

  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      external.addEventListener('abort', onAbort);
      cleanups.push(() => external.removeEventListener('abort', onAbort));
    }
  }

  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const errorBody =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } })
          .error
      : undefined;

  return new ApiError({
    kind: (errorBody?.code as ApiErrorKind) ?? 'unknown',
    message: errorBody?.message ?? `Request failed with status ${response.status}`,
    status: response.status,
    fields: errorBody?.fields,
    requestId: response.headers.get('x-request-id'),
  });
}

/**
 * Un fallo del envio, en la unica forma de error que ve una pantalla.
 *
 * Compartido por las dos rutas porque un timeout y un `AbortError` externo no
 * pueden reportarse de una forma cuando se pide JSON y de otra cuando se piden
 * bytes: el fallo es del envio, no del formato de lo que viene de vuelta.
 */
function networkError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new ApiError({ kind: 'network', message: 'Network request was cancelled' });
  }
  return new ApiError({ kind: 'network', message: 'Network request failed' });
}

/**
 * El nucleo que comparten las dos rutas: construir la URL, la cabecera `Accept`
 * (la del llamante gana a la de por defecto), `Authorization` cuando la peticion
 * no es anonima, y un `execute` que arma el timeout y envia una sola vez.
 *
 * Es un nucleo compartido y no dos copias porque el timeout y el refresh de 401
 * no pueden portarse de una forma en un camino y de otra en el otro: el timeout
 * vive aqui y el refresh en `retryAfterUnauthorized`, y los dos los usan
 * `apiRequest` y `send()`. Y componer y enviar van separados porque `apiRaw`
 * devuelve la peticion sin enviarla: el timeout cuenta desde que se envia, no
 * desde que se compone, y el llamante puede tardar todo lo que quiera entre las
 * dos cosas.
 */
async function request(
  path: string,
  options: RequestOptions,
): Promise<{
  url: string;
  headers: Record<string, string>;
  execute: () => Promise<Response>;
}> {
  const {
    method = 'GET',
    body,
    query,
    anonymous = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    headers = {},
  } = options;

  let url: string;
  let requestHeaders: Record<string, string>;

  try {
    url = buildUrl(path, query);

    requestHeaders = {
      Accept: 'application/json',
      ...headers,
    };

    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    if (!anonymous) {
      const token = await getAccessToken();
      if (token) {
        requestHeaders.Authorization = `Bearer ${token}`;
      }
    }
  } catch (error) {
    // Componer tambien puede fallar: `getAccessToken` es estado inyectado y
    // puede rechazar, y `buildUrl` puede tropezar con un valor raro en el query.
    // Antes de partir el nucleo esto caia dentro del `try` de `execute` y salia
    // mapeado; sin este `catch` la excepcion suelta cruzaria el punto de entrada
    // y una pantalla la veria como el `unknown` de `toApiError`, que no se
    // reintenta, en vez de como `network`, que si.
    throw networkError(error);
  }

  const execute = async (): Promise<Response> => {
    const requestSignal = createRequestSignal(signal);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      requestSignal.abort();
    }, timeoutMs);

    try {
      return await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestSignal.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiError({ kind: 'timeout', message: 'The request timed out' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      requestSignal.dispose();
    }
  };

  return { url, headers: requestHeaders, execute };
}

/**
 * La unica decision sobre un 401: refrescar el token y devolver las opciones del
 * reintento, o `null` si no toca.
 *
 * Es una funcion y no dos porque las dos rutas prometieron tratar igual un token
 * caducado. Si el camino de JSON reintentara y el de bytes no, la diferencia
 * solo apareceria en unas exportaciones que fallan en el movil de alguien y en
 * ningun test. El `noRetryOnUnauthorized` va en las opciones de salida porque un
 * segundo 401 tiene que terminar la historia y no volver a preguntar por un
 * token que hace un momento se renovo.
 */
async function retryAfterUnauthorized(
  response: Response,
  options: RequestOptions,
): Promise<RequestOptions | null> {
  if (response.status !== 401 || options.anonymous || options.noRetryOnUnauthorized) {
    return null;
  }

  const refreshed = await onUnauthorized();
  return refreshed ? { ...options, noRetryOnUnauthorized: true } : null;
}

/**
 * Single entry point for network calls: JSON in, JSON out, typed errors, and one
 * transparent refresh + retry on 401.
 *
 * A response that is not JSON — a CSV export — cannot come back through here,
 * because this path ends in `text()` + `JSON.parse`. Those responses go through
 * `apiRaw`, which sends on the same core and through the very same
 * `retryAfterUnauthorized`, so neither the timeout nor the retry on a stale
 * token can behave one way here and another way there.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { execute } = await request(path, options);

  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    throw networkError(error);
  }

  const retry = await retryAfterUnauthorized(response, options);
  if (retry) {
    return apiRequest<T>(path, retry);
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError({ kind: 'unknown', message: 'Malformed JSON response' });
  }

  // The API answers with the { data, meta } envelope (apiResponseSchema in the
  // shared contracts). Screens work with the payload, never with the envelope.
  if (payload && typeof payload === 'object' && 'data' in payload && 'meta' in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

/**
 * Una peticion compuesta y todavia no enviada.
 *
 * Devuelve URL y cabeceras en vez de un `Response` porque en un movil la
 * respuesta tiene que llegar a un fichero, no a la memoria: un `Response`
 * obligaria a leer varios megas de exportacion en JS y pasarlos por base64,
 * que es justo lo que `lib/notes/attachments.ts` ya explica que no se hace en
 * las subidas. `expo-file-system` escribe la respuesta directamente a disco
 * desde la URL, asi que quien decide como se mueven los bytes es el llamante,
 * no este modulo.
 *
 * `send()` envia con el timeout y el refresh de 401 de siempre, y un fallo
 * sale como `ApiError` igual que en `apiRequest`. Lo que no hace es tocar la
 * respuesta buena: el cuerpo son bytes del llamante, no un sobre de JSON.
 */
export interface PendingRequest {
  url: string;
  headers: Record<string, string>;
  send(): Promise<Response>;
}

/**
 * Compone la peticion sin enviarla: la URL, el `Accept` (el del llamante gana)
 * y `Authorization` si la peticion no es anonima.
 *
 * El token se lee aqui y no dentro de `send()` porque el llamante puede
 * entregar la URL a `expo-file-system` sin llamar a `send()` nunca, y las
 * cabeceras que expone tienen que ser las que ese envio usaria.
 */
export async function apiRaw(path: string, options: RequestOptions = {}): Promise<PendingRequest> {
  const composed = await request(path, options);

  const send = async (): Promise<Response> => {
    let response: Response;
    try {
      response = await composed.execute();
    } catch (error) {
      throw networkError(error);
    }

    const retry = await retryAfterUnauthorized(response, options);
    if (retry) {
      // Se compone otra vez porque el token acaba de cambiar: reenviar con las
      // cabeceras de antes del refresh volveria a recibir el mismo 401.
      const reattempt = await apiRaw(path, retry);
      return reattempt.send();
    }

    if (!response.ok) {
      throw await parseError(response);
    }

    return response;
  };

  return { url: composed.url, headers: composed.headers, send };
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
