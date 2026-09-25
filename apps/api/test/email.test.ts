import { describe, expect, it, vi } from 'vitest';

import { EmailDeliveryError, ResendEmailSender } from '../src/modules/email/email.js';

/**
 * The Resend transport is exercised against a stubbed fetch: retries, the
 * happy path and the shape of the error a caller will see.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSender(fetchImpl: typeof fetch) {
  const sender = new ResendEmailSender();
  // The key is validated at boot; the tests bypass that on purpose.
  Reflect.set(sender, 'apiKey', 're_test_key_for_unit_tests_0000');
  Reflect.set(sender, 'from', 'no-reply@orbithub.test');
  vi.stubGlobal('fetch', fetchImpl);
  return sender;
}

const message = {
  to: 'user@example.com',
  subject: 'Verifica tu correo',
  text: 'texto',
  html: '<p>html</p>',
};

describe('ResendEmailSender', () => {
  it('posts the message and returns nothing on success', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const sender = createSender(async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ id: 'email_123' });
    });

    await expect(sender.send(message)).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.resend.com/emails');

    const headers = new Headers(call?.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer re_test_key_for_unit_tests_0000');

    const body = JSON.parse(String(call?.init?.body));
    expect(body.from).toBe('no-reply@orbithub.test');
    expect(body.to).toEqual(['user@example.com']);
    expect(body.subject).toBe('Verifica tu correo');
  });

  it('fails when the provider accepts the request but returns no id', async () => {
    const sender = createSender(async () => jsonResponse({}));

    await expect(sender.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it('does not retry a request the provider rejected as invalid', async () => {
    let calls = 0;
    const sender = createSender(async () => {
      calls += 1;
      return jsonResponse({ message: 'Invalid from address' }, 422);
    });

    const error = await sender.send(message).catch((caught) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).status).toBe(422);
    expect(calls).toBe(1);
  });

  it('retries a rate limit and then succeeds', async () => {
    let calls = 0;
    const sender = createSender(async () => {
      calls += 1;
      return calls < 3 ? jsonResponse({ message: 'Too many requests' }, 429) : jsonResponse({ id: 'ok' });
    });

    await expect(sender.send(message)).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  it('retries a server error up to the limit and then gives up', async () => {
    let calls = 0;
    const sender = createSender(async () => {
      calls += 1;
      return jsonResponse({ message: 'Upstream error' }, 500);
    });

    const error = await sender.send(message).catch((caught) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(calls).toBe(3);
  });

  it('treats an unreachable provider as retryable', async () => {
    let calls = 0;
    const sender = createSender(async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    });

    const error = await sender.send(message).catch((caught) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).status).toBeNull();
    expect(calls).toBe(3);
  });
});
