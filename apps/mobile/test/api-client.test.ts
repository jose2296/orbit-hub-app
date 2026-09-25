import { ApiError, apiRequest, configureApiClient } from '../src/lib/api/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-request' },
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('apiRequest', () => {
  it('unwraps the { data, meta } envelope', async () => {
    const payload = { status: 'authenticated', session: { accessToken: 'a' } };
    globalThis.fetch = async () => jsonResponse({ data: payload, meta: { requestId: 'r1' } });

    const result = await apiRequest<typeof payload>('/auth/login', { method: 'POST' });

    expect(result).toEqual(payload);
  });

  it('returns the payload untouched when there is no envelope', async () => {
    globalThis.fetch = async () => jsonResponse({ hello: 'world' });

    const result = await apiRequest<{ hello: string }>('/anything');

    expect(result).toEqual({ hello: 'world' });
  });

  it('attaches the bearer token when one is available', async () => {
    let seenAuthorization: string | null = null;
    globalThis.fetch = async (_url, init) => {
      seenAuthorization = new Headers(init?.headers).get('Authorization');
      return jsonResponse({ data: {}, meta: { requestId: 'r' } });
    };

    configureApiClient({ getAccessToken: async () => 'token-123' });
    await apiRequest('/auth/me');

    expect(seenAuthorization).toBe('Bearer token-123');
  });

  it('skips the Authorization header for anonymous requests', async () => {
    let seenAuthorization: string | null = 'unset';
    globalThis.fetch = async (_url, init) => {
      seenAuthorization = new Headers(init?.headers).get('Authorization');
      return jsonResponse({ data: {}, meta: { requestId: 'r' } });
    };

    configureApiClient({ getAccessToken: async () => 'token-123' });
    await apiRequest('/auth/login', { method: 'POST', anonymous: true });

    expect(seenAuthorization).toBeNull();
  });

  it('refreshes once and retries the original request after a 401', async () => {
    const calls: string[] = [];
    let currentToken = 'stale';

    globalThis.fetch = async (url, init) => {
      const href = String(url);
      calls.push(href);

      if (href.endsWith('/auth/me')) {
        const auth = new Headers(init?.headers).get('Authorization');
        return auth === 'Bearer fresh'
          ? jsonResponse({ data: { id: 'u1' }, meta: { requestId: 'r' } })
          : jsonResponse({ error: { code: 'unauthorized', message: 'nope' } }, 401);
      }

      return jsonResponse({
        data: { accessToken: 'fresh', refreshToken: 'r2', expiresIn: 900, user: { id: 'u1' } },
        meta: { requestId: 'r' },
      });
    };

    configureApiClient({
      getAccessToken: async () => currentToken,
      onUnauthorized: async () => {
        // The auth client refreshes here and reports whether it succeeded.
        currentToken = 'fresh';
        return true;
      },
    });

    const result = await apiRequest<{ id: string }>('/auth/me');

    expect(result).toEqual({ id: 'u1' });
    expect(calls.filter((url) => url.endsWith('/auth/me'))).toHaveLength(2);
  });

  it('does not retry more than once', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return jsonResponse({ error: { code: 'unauthorized', message: 'nope' } }, 401);
    };

    configureApiClient({ onUnauthorized: async () => true });

    await expect(apiRequest('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(attempts).toBe(2);
  });

  it('maps a structured error into ApiError', async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        { error: { code: 'validation_failed', message: 'Invalid payload', fields: { email: 'Bad' } } },
        422,
      );

    const error = (await apiRequest('/auth/register', { method: 'POST' }).catch((caught) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('validation_failed');
    expect(error.status).toBe(422);
    expect(error.fields).toEqual({ email: 'Bad' });
    expect(error.isRetryable).toBe(false);
  });

  it('reports a network failure as a retryable ApiError', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('Network request failed');
    };

    const error = (await apiRequest('/health').catch((caught) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('network');
    expect(error.isRetryable).toBe(true);
  });

  it('reports a timeout distinctly', async () => {
    globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });

    const error = (await apiRequest('/health', { timeoutMs: 20 }).catch((caught) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('timeout');
  });
});
