import { describe, expect, it, vi } from 'vitest';

import { avanzar } from '@/lib/forms/field-chain';

/**
 * La cadena de campos.
 *
 * El bug que vigila no se ve: `returnKeyType="next"` estaba puesto en seis
 * formularios de la app y **no movía el foco**, porque `TextField` se comía el
 * `ref` y nunca llegaba al `TextInput`. Se地产 en un archivo que compila, pasa
 * el typecheck y pasa los tests.
 *
 * Y se prueba sobre `avanzar` y no sobre el hook a propósito: esta suite corre en
 * `node` con React Native de stub, así que un hook no se puede montar. La lógica
 * que decide a dónde va el foco está aparte por eso, y es la parte que puede
 * estar mal.
 */
const campo = () => ({ focus: vi.fn() });

describe('avanzar', () => {
  it('lleva al campo que viene', () => {
    const segundo = campo();
    avanzar([campo(), segundo, campo()], 0, vi.fn());
    expect(segundo.focus).toHaveBeenCalledOnce();
  });

  it('salta al que va después del segundo, no al primero', () => {
    // El fallo de verdad: con una funcion de `register` compartida, los tres
    // campos escriben en la misma ranura y los tres `ref` apuntan al ultimo
    // montado. Entonces "siguiente" desde el primero llama a `focus()` sobre el
    // campo equivocado y no se ve nada.
    const segundo = campo();
    const tercero = campo();
    avanzar([campo(), segundo, tercero], 1, vi.fn());
    expect(tercero.focus).toHaveBeenCalledOnce();
    expect(segundo.focus).not.toHaveBeenCalled();
  });

  it('en el último campo hace falta el envío', () => {
    const enviar = vi.fn();
    const ultimo = campo();
    avanzar([campo(), ultimo], 1, enviar);
    expect(enviar).toHaveBeenCalledOnce();
    expect(ultimo.focus, 'el último no se reenfoca a sí mismo').not.toHaveBeenCalled();
  });

  it('un campo que no llegó a montarse no rompe el salto', () => {
    // Un formulario con un campo condicional: la ranura existe y está vacía.
    const enviar = vi.fn();
    avanzar([campo(), null, campo()], 0, enviar);
    expect(enviar).toHaveBeenCalledOnce();
  });

  it('una cadena de un solo campo es un envío', () => {
    const enviar = vi.fn();
    avanzar([campo()], 0, enviar);
    expect(enviar).toHaveBeenCalledOnce();
  });

  it('fuera de rango es un envío y no una excepción', () => {
    // `onSubmitEditing` puede llegar tarde, con el formulario ya desmontado.
    const enviar = vi.fn();
    expect(() => avanzar([], 3, enviar)).not.toThrow();
    expect(enviar).toHaveBeenCalledOnce();
  });
});

describe('TextField deja pasar el ref al TextInput', () => {
  const src = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    return readFileSync(
      join(import.meta.dirname, '../src/components/ui/text-field.tsx'),
      'utf8',
    );
  };

  it('reenvía el ref, y sin esto la cadena no tiene a quién enfocarse', () => {
    expect(src(), 'el componente tiene que reenviar el ref').toContain('forwardRef');
  });

  it('el ref va al TextInput y no al View que lo envuelve', () => {
    // El `View` de un campo **no tiene `focus()`**, que es lo único que la cadena
    // llama. Un ref en el contenedor es un ref que compila y no hace nada.
    const input = src().match(/<TextInput[\s\S]*?\/>/)?.[0] ?? '';
    expect(input, 'el ref tiene que estar en el TextInput').toContain('ref={ref}');
  });
});