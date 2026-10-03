import { describe, expect, it } from 'vitest';
import { verificationTokenFor } from './e2e-account.ts';

const linea = (email: string, token: string) =>
  `[email] verification link https://orbit.example/verify-email?token=${token} for ${email}`;

describe('verificationTokenFor', () => {
  it('saca el token de la linea del correo', () => {
    expect(verificationTokenFor([linea('ana@example.com', 'tok-abc')], 'ana@example.com')).toBe(
      'tok-abc',
    );
  });

  it('devuelve null si todavia no ha llegado el correo', () => {
    expect(verificationTokenFor([], 'ana@example.com')).toBeNull();
  });

  it('con dos correos toma el ultimo, que es el de esta carrera', () => {
    const lineas = [linea('ana@example.com', 'viejo'), linea('ana@example.com', 'nuevo')];
    expect(verificationTokenFor(lineas, 'ana@example.com')).toBe('nuevo');
  });

  it('ignora los correos de otra cuenta', () => {
    const lineas = [linea('beto@example.com', 'de-beto'), linea('ana@example.com', 'de-ana')];
    expect(verificationTokenFor(lineas, 'ana@example.com')).toBe('de-ana');
  });
});