/**
 * Sends a real email through the configured transport, to check delivery.
 *
 *   npm run email-test --workspace @orbit-hub/api -- you@example.com
 *
 * Never prints credentials and never writes to the database.
 */
import { createEmailSender, EmailDeliveryError } from '../modules/email/email.js';

const target = process.argv[2] ?? process.env['EMAIL_TEST_TO'];

async function main(): Promise<void> {
  if (!target) {
    console.error('Usage: npm run email-test --workspace @orbit-hub/api -- you@example.com');
    process.exit(1);
  }

  const sender = createEmailSender();

  if (sender.transport === 'console' || sender.transport === 'noop') {
    console.error(`EMAIL_TRANSPORT is "${sender.transport}", so nothing would be sent.`);
    console.error('Set EMAIL_TRANSPORT=resend and RESEND_API_KEY first.');
    process.exit(1);
  }

  try {
    await sender.send({
      to: target,
      subject: 'OrbitHub: prueba de envío',
      text: 'Si estás leyendo esto, el correo de OrbitHub funciona correctamente.',
      html: `<!doctype html><html><body style="font-family:system-ui;padding:24px">
<h1>OrbitHub</h1>
<p>Si estás leyendo esto, el correo de OrbitHub funciona correctamente.</p>
</body></html>`,
    });

    console.log(`✓ Enviado con ${sender.transport} a ${target}`);
    process.exit(0);
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      console.error(`✗ Falló el envío (${error.provider}, estado ${error.status ?? 'sin respuesta'})`);
      console.error(`  ${error.message}`);
    } else {
      console.error('✗ Error inesperado al enviar');
      console.error(error);
    }
    process.exit(1);
  }
}

void main();
