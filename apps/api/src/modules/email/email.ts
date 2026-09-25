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
  return new ConsoleEmailSender();
}

/** Messages captured by the `noop` transport. Always empty outside tests. */
export function capturedEmails(): readonly EmailMessage[] {
  return capturedMessages;
}

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
