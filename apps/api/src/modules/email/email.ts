import type { Locale } from '@orbit-hub/contracts';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  readonly transport: string;
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Development transport: logs the message instead of sending it. Never used in
 * production, where a real provider must be configured explicitly.
 */
class ConsoleEmailSender implements EmailSender {
  readonly transport = 'console';

  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, text: message.text },
      'email (console transport)',
    );
  }
}

/**
 * Test transport: keeps messages in memory so integration tests can read the
 * verification and reset links. Enabled with EMAIL_TRANSPORT=noop, which is the
 * only configuration that ever fills this buffer.
 */
const capturedMessages: EmailMessage[] = [];

class NoopEmailSender implements EmailSender {
  readonly transport = 'noop';

  async send(message: EmailMessage): Promise<void> {
    capturedMessages.push(message);
  }
}

export function createEmailSender(): EmailSender {
  if (env.EMAIL_TRANSPORT === 'noop') return new NoopEmailSender();
  if (env.EMAIL_TRANSPORT === 'resend') return new ResendEmailSender();
  return new ConsoleEmailSender();
}

/** Messages captured by the `noop` transport. Always empty outside tests. */
export function capturedEmails(): readonly EmailMessage[] {
  return capturedMessages;
}

/* ------------------------------------------------------------------ resend -- */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
const RESEND_ATTEMPTS = 3;

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resend transport.
 *
 * Delivery is retried on rate limits and server errors, because a verification
 * email that never arrives is indistinguishable from a broken sign-up. The
 * caller still gets a successful HTTP response: the account exists, and the
 * failure is recorded in the audit trail instead of becoming a 500.
 */
export class ResendEmailSender implements EmailSender {
  readonly transport = 'resend';

  private readonly apiKey = env.RESEND_API_KEY as string;
  private readonly from = env.EMAIL_FROM;

  async send(message: EmailMessage): Promise<void> {
    let lastError: EmailDeliveryError | null = null;

    for (let attempt = 1; attempt <= RESEND_ATTEMPTS; attempt += 1) {
      try {
        await this.post(message);
        logger.info(
          { to: message.to, subject: message.subject, attempt },
          'email sent through resend',
        );
        return;
      } catch (error) {
        const failure =
          error instanceof EmailDeliveryError
            ? error
            : new EmailDeliveryError('The email provider could not be reached', null, 'resend');

        lastError = failure;

        const retryable = failure.status === null || failure.status === 429 || failure.status >= 500;
        if (!retryable || attempt === RESEND_ATTEMPTS) {
          break;
        }

        // Exponential backoff: 250ms, 750ms.
        await sleep(250 * 3 ** (attempt - 1));
      }
    }

    throw lastError ?? new EmailDeliveryError('The email could not be sent', null, 'resend');
  }

  private async post(message: EmailMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ResendResponse;
        if (!payload.id) {
          throw new EmailDeliveryError(
            'Resend accepted the request but returned no id',
            response.status,
            'resend',
          );
        }
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as ResendResponse;
      throw new EmailDeliveryError(
        payload.message ?? `Resend rejected the message with status ${response.status}`,
        response.status,
        'resend',
      );
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new EmailDeliveryError('Resend did not answer in time', null, 'resend');
      }
      throw new EmailDeliveryError('Resend could not be reached', null, 'resend');
    } finally {
      clearTimeout(timer);
    }
  }
}

/* --------------------------------------------------------------- templates -- */

function link(path: string, token: string): string {
  const base = env.WEB_ORIGIN.replace(/\/$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COPY = {
  es: {
    verifySubject: 'Verifica tu correo en OrbitHub',
    verifyTitle: 'Confirma tu correo',
    verifyBody: 'Pulsa el botón para activar tu cuenta. El enlace caduca en 24 horas.',
    verifyCta: 'Verificar mi correo',
    verifyIgnore: 'Si no te has registrado en OrbitHub, ignora este mensaje.',
    resetSubject: 'Restablece tu contraseña de OrbitHub',
    resetTitle: 'Cambia tu contraseña',
    resetBody: 'Este enlace caduca en 1 hora. Si no lo has solicitado, no hagas nada.',
    resetCta: 'Elegir nueva contraseña',
    resetIgnore: 'Si no has solicitado el cambio, tu contraseña actual sigue siendo válida.',
  },
  en: {
    verifySubject: 'Verify your email for OrbitHub',
    verifyTitle: 'Confirm your email',
    verifyBody: 'Tap the button to activate your account. The link expires in 24 hours.',
    verifyCta: 'Verify my email',
    verifyIgnore: 'If you did not sign up for OrbitHub, ignore this message.',
    resetSubject: 'Reset your OrbitHub password',
    resetTitle: 'Choose a new password',
    resetBody: 'This link expires in 1 hour. If you did not request it, do nothing.',
    resetCta: 'Set a new password',
    resetIgnore: 'If you did not request this, your current password is still valid.',
  },
} satisfies Record<Locale, Record<string, string>>;

function layout(title: string, body: string, cta: string, href: string, ignore: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#F6F7FB;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0E1220;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;border:1px solid #E2E6EF;">
      <tr><td style="padding:28px;">
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#59627A;">OrbitHub</p>
        <h1 style="margin:0 0 12px;font-size:22px;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#59627A;">${escapeHtml(body)}</p>
        <p style="margin:0 0 24px;">
          <a href="${escapeHtml(href)}" style="display:inline-block;background:#3B63E0;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;">${escapeHtml(cta)}</a>
        </p>
        <p style="margin:0;font-size:13px;color:#8A93A8;">${escapeHtml(ignore)}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

export interface TemplateInput {
  to: string;
  token: string;
  locale: Locale;
}

export function verificationEmail(input: TemplateInput): EmailMessage {
  const copy = COPY[input.locale] ?? COPY.es;
  const href = link('/verify-email', input.token);

  return {
    to: input.to,
    subject: copy.verifySubject,
    text: `${copy.verifyTitle}\n\n${copy.verifyBody}\n\n${href}\n\n${copy.verifyIgnore}`,
    html: layout(copy.verifyTitle, copy.verifyBody, copy.verifyCta, href, copy.verifyIgnore),
  };
}

export function passwordResetEmail(input: TemplateInput): EmailMessage {
  const copy = COPY[input.locale] ?? COPY.es;
  const href = link('/reset-password', input.token);

  return {
    to: input.to,
    subject: copy.resetSubject,
    text: `${copy.resetTitle}\n\n${copy.resetBody}\n\n${href}\n\n${copy.resetIgnore}`,
    html: layout(copy.resetTitle, copy.resetBody, copy.resetCta, href, copy.resetIgnore),
  };
}
