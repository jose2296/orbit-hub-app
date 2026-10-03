import { describe, expect, it } from 'vitest';
import { verificationTokenFor } from './e2e-account';

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

  // La linea ajena va AL FINAL, y no por casualidad: con ella delante, `.pop()`
  // la saltaba por encima y el caso pasaba igual con el filtro de correo
  // borrado, que es la forma que tiene un caso de no comprobar lo que dice
  // comprobar.
  it('ignora los correos de otra cuenta', () => {
    const lineas = [linea('ana@example.com', 'de-ana'), linea('beto@example.com', 'de-beto')];
    expect(verificationTokenFor(lineas, 'ana@example.com')).toBe('de-ana');
  });

  // El otro lado del filtro: una linea que es de Ana y no es la verificacion.
  // Sin esto, el `includes('verify-email')` tambien se podria borrar entero y
  // ningun caso lo notaria.
  it('ignora un correo de Ana que no es la verificacion', () => {
    const reset =
      '[email] reset https://orbit.example/reset-password?token=otro para ana@example.com';
    expect(verificationTokenFor([linea('ana@example.com', 'de-ana'), reset], 'ana@example.com')).toBe(
      'de-ana',
    );
  });
});
