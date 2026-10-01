import type { Locale, ShareNodeType } from '@orbit-hub/contracts';

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

/**
 * Picks the transport named in the environment.
 *
 * Declared before the classes on purpose and called at the very bottom of this
 * file, not here: a `class` is not hoisted, so calling this while
 * `ResendEmailSender` is still in its temporal dead zone crashes the process at
 * import time — and only for the one transport nobody was running. The tests
 * use `noop` and development used `console`, so `resend` was the one line of
 * this module that had never been executed. Order of declaration is not a
 * style preference here; it was a bug.
 */
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
  return `${absoluteLink(path)}?token=${encodeURIComponent(token)}`;
}

/** A link into the app that carries no secret and does not expire. */
function absoluteLink(path: string): string {
  return `${env.WEB_ORIGIN.replace(/\/$/, '')}${path}`;
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
    inviteSubject: 'Te han invitado a {workspace} en OrbitHub',
    inviteTitle: 'Invitación a {workspace}',
    inviteBody: '{inviter} te ha invitado como {role}. Pulsa el botón para entrar en el espacio. El enlace caduca el {expires}.',
    inviteCta: 'Ver las invitaciones',
    inviteIgnore: 'La respuesta se da dentro de la app, y nadie se une sin que pulses el botón. Si no reconoces a quien te invita, ignora este correo.',
    shareSubject: '{owner} ha compartido {node} contigo en OrbitHub',
    shareSubjectOf: '{owner} ha compartido {node} de {space} contigo en OrbitHub',
    shareTitle: '{node} está en tu bandeja',
    shareBodyEditor: '{owner} te lo ha compartido y puedes editarlo. Elige dónde ponerlo y aparecerá en tu menú junto a lo demás.',
    shareBodyViewer: '{owner} te lo ha compartido y puedes verlo, pero no cambiarlo.',
    shareCta: 'Ver lo que me han compartido',
    shareIgnore: 'El enlace abre OrbitHub. Si no reconoces a quien te lo ha compartido, no pulses nada: dentro de la app puedes quitarlo.',
    shareNodeSpace: 'un espacio',
    shareNodeFolder: 'una carpeta',
    shareNodeList: 'una lista',
    shareNodeItem: 'un elemento',
    shareRoleEditor: 'puedes editarlo',
    shareRoleViewer: 'solo puedes verlo',
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
    inviteSubject: 'You have been invited to {workspace} on OrbitHub',
    inviteTitle: 'Invitation to {workspace}',
    inviteBody: '{inviter} invited you as {role}. Tap the button to join the space. The link expires on {expires}.',
    inviteCta: 'See the invitations',
    inviteIgnore: 'You answer it inside the app, and nobody joins anything without tapping the button. If you do not know who invited you, ignore this email.',
    shareSubject: '{owner} shared {node} with you on OrbitHub',
    shareSubjectOf: '{owner} shared {node} from {space} with you on OrbitHub',
    shareTitle: '{node} is in your inbox',
    shareBodyEditor: '{owner} shared it with you and you can edit it. Choose where to put it and it shows up in your menu with everything else.',
    shareBodyViewer: '{owner} shared it with you and you can look at it, but not change it.',
    shareCta: 'See what was shared with me',
    shareIgnore: 'The button opens OrbitHub. If you do not know who shared this, do not tap it: inside the app you can remove it.',
    shareNodeSpace: 'a space',
    shareNodeFolder: 'a folder',
    shareNodeList: 'a list',
    shareNodeItem: 'an item',
    shareRoleEditor: 'you can edit it',
    shareRoleViewer: 'you can only look at it',
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

/**
 * The invitation mail.
 *
 * The button is the whole point of the mail, and the text below it says so: a
 * link is not a membership until somebody presses it, and the person reading
 * this is about to be told what role they would get. The role is named in the
 * body rather than left to be discovered inside the app, because "te han
 * invitado" and "te han invitado a ver" are different decisions.
 */
export function invitationEmail(input: {
  to: string;
  locale: Locale;
  workspaceName: string;
  inviterName: string;
  role: 'editor' | 'viewer';
  expiresAt: Date;
}): EmailMessage {
  const copy = COPY[input.locale] ?? COPY.es;
  /**
   * **Not the token link, and that is the decision.** This mail used to point at
   * `/invite/<token>`, which made the notification the only door: lose the mail, or
   * search for it, or have it land in a folder, and the invitation is invisible and
   * the space never happens.
   *
   * So the button goes to `/invitations`, where the invitation is a row next to
   * everything else and both answers are one tap away. The token link still exists and
   * still works — it is in the mails people already have — and the app answers with the
   * same two endpoints, so there is one way to accept and not two.
   */
  const href = absoluteLink('/invitations');
  const fill = (value: string) =>
    value
      .replace('{workspace}', input.workspaceName)
      .replace('{inviter}', input.inviterName)
      .replace(
        '{role}',
        input.role === 'editor'
          ? input.locale === 'en'
            ? 'an editor'
            : 'editor'
          : input.locale === 'en'
            ? 'a viewer'
            : 'lector',
      )
      .replace('{expires}', input.expiresAt.toISOString().slice(0, 10));

  return {
    to: input.to,
    subject: fill(copy.inviteSubject),
    text: `${fill(copy.inviteTitle)}\n\n${fill(copy.inviteBody)}\n\n${href}\n\n${fill(copy.inviteIgnore)}`,
    html: layout(
      fill(copy.inviteTitle),
      fill(copy.inviteBody),
      copy.inviteCta,
      href,
      fill(copy.inviteIgnore),
    ),
  };
}

/**
 * "Somebody shared something with you".
 *
 * Three things this mail has to say and no more: **what** was shared, **who** shared
 * it, and **whether you can change it or only look at it**. The last one is the whole
 * point — somebody who receives a list they can only read has to know that now, in the
 * mail, and not by discovering it when the checkbox does not answer.
 *
 * It points at the inbox and not at the thing. There is no link to a thing that lives
 * in somebody else's space until you have decided where it goes in yours, and a link
 * that guesses is a link to a 404.
 */
export function sharedWithYouEmail(input: {
  to: string;
  locale: Locale;
  nodeTitle: string;
  nodeType: ShareNodeType;
  /** The space it lives in, when it is not the space itself. */
  spaceName: string | null;
  ownerName: string;
  role: 'editor' | 'viewer';
}): EmailMessage {
  const copy = COPY[input.locale] ?? COPY.es;
  const href = absoluteLink('/shared');

  const nodeKind = copy[`shareNode${cap(input.nodeType)}` as keyof typeof copy];
  const node = `${nodeKind} «${input.nodeTitle}»`;

  const fill = (value: string) =>
    value
      .replace('{node}', node)
      .replace('{owner}', input.ownerName)
      .replace('{space}', input.spaceName ?? '');

  // A shared space has no other space to point at, so the subject loses the second
  // half rather than reading "de  con".
  const subject =
    input.nodeType === 'workspace' || input.spaceName === null
      ? fill(copy.shareSubject)
      : fill(copy.shareSubjectOf);

  return {
    to: input.to,
    subject,
    text: `${fill(copy.shareTitle)}\n\n${
      input.role === 'editor' ? fill(copy.shareBodyEditor) : fill(copy.shareBodyViewer)
    }\n\n${href}\n\n${copy.shareIgnore}`,
    html: layout(
      fill(copy.shareTitle),
      input.role === 'editor' ? fill(copy.shareBodyEditor) : fill(copy.shareBodyViewer),
      copy.shareCta,
      href,
      copy.shareIgnore,
    ),
  };
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

/* --------------------------------------------------------------- singleton -- */

/**
 * The sender the whole API uses.
 *
 * One instance for the process, so a test that swaps the transport and the
 * verification mail and the invitation mail all go through the same door.
 *
 * Built here, at the bottom, on purpose: see the note on `createEmailSender`.
 * Putting it next to the factory is where it was, and that is a crash.
 */
export const emailSender: EmailSender = createEmailSender();
