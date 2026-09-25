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
 * Single entry point for network calls: JSON in, JSON out, typed errors, and one
 * transparent refresh + retry on 401.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    anonymous = false,
    noRetryOnUnauthorized = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    headers = {},
  } = options;

  const execute = async (): Promise<Response> => {
    const request = createRequestSignal(signal);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      request.abort();
    }, timeoutMs);

    try {
      const requestHeaders: Record<string, string> = {
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

      return await fetch(buildUrl(path, query), {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiError({ kind: 'timeout', message: 'The request timed out' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      request.dispose();
    }
  };

  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError({ kind: 'network', message: 'Network request was cancelled' });
    }
    throw new ApiError({ kind: 'network', message: 'Network request failed' });
  }

  if (response.status === 401 && !anonymous && !noRetryOnUnauthorized) {
    const refreshed = await onUnauthorized();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, noRetryOnUnauthorized: true });
    }
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
