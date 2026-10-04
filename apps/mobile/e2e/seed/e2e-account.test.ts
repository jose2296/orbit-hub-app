import { WORKSPACE_COLORS } from '@orbit-hub/contracts';
import { describe, expect, it } from 'vitest';
import { NOMBRES, verificationTokenFor } from './e2e-account';

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

/**
 * Los colores que la siembra envia, contra la lista que los define.
 *
 * Sin este caso un color inventado pasa: `sync-service.ts` limpia el payload y
 * cambia en silencio lo que no reconoce, asi que el push vuelve `applied` y el
 * espacio se guarda con otro color del pedido. Ya paso con `purple`, que se
 * guardo como `slate` sin que nada lo notara.
 *
 * Recorre los valores de `NOMBRES` en vez de escribir `'teal'` y `'violet'` otra
 * vez: repetir los nombres aqui seria un segundo sitio donde anadir un color y
 * olvidarse de anadirlo alli. Anadir un color a la siembra lo anade aqui solo.
 */
describe('los colores que envia la siembra', () => {
  it('estan todos en WORKSPACE_COLORS', () => {
    const enviados = Object.entries(NOMBRES)
      .filter(([clave]) => clave.endsWith('Color'))
      // `as string` porque `items` es una tupla de solo lectura y ensucia el tipo
      // del valor; aqui solo se comparan nombres de color.
      .map(([clave, valor]) => [clave, valor as string] as const);
    // Si la siembra dejara de enviar colores, esto pasaria por vacio. Sin un
    // color que comprobar, el caso de arriba no miraria nada.
    expect(enviados.length).toBeGreaterThan(0);

    // La lista se ensancha a `string` antes de buscar, como hace
    // `sync-service.ts` con la misma lista: si no, `includes` pide un nombre de
    // la union y el filtro se queja de tipos en vez de de colores.
    const permitidos: readonly string[] = WORKSPACE_COLORS;
    const fuera = enviados.filter(([, valor]) => !permitidos.includes(valor));
    expect(fuera.map(([clave, valor]) => `${clave}=${valor}`)).toEqual([]);
  });
});
