import { useCallback, useMemo, useRef } from 'react';
import type { TextInput } from 'react-native';

/**
 * The part of the chain that does not care about React.
 *
 * It is separated from the hook because **this is the part with the bug in it**.
 * `returnKeyType="next"` was set in six forms of the app and did nothing, and a
 * test that cannot run a hook cannot see that. This is a plain function over an
 * array, so `node` and no React Native can prove where the focus lands.
 */
export interface Destino {
  /** Focus this and move on. */
  focus(): void;
}

/**
 * What the return key does on field `i`.
 *
 * Field `i + 1` if it is there and mounted, `alFinal` when `i` is the last one.
 * Not the other way round: a chain of one field is a submit, and a chain where
 * the next field happens to be unmounted is a submit too, because a form with a
 * hidden field is a form whose submit is still its submit.
 */
export function avanzar(campos: (Destino | null)[], i: number, alFinal: () => void): void {
  const siguiente = campos[i + 1];
  if (siguiente) siguiente.focus();
  else alFinal();
}

export interface FieldChain {
  /**
   * The ref for field `i`, to hand to a `TextField`.
   *
   * A callback ref and not an array of `useRef`: `register(i)` has to return a
   * **different function per index**, and one shared callback would leave all of
   * them pointing at whichever input mounted last. That is asserted in the test,
   * because it is the failure that makes the chain jump backwards.
   */
  register: (i: number) => (campo: Destino | null) => void;
  /** What the keyboard's return key does on field `i`. */
  advance: (i: number, alFinal: () => void) => void;
  /** Focus field `i`, for an error that has to point at a field. */
  focus: (i: number) => void;
  /** How many fields the chain was declared with. */
  readonly length: number;
}

export function useFieldChain(campos: number): FieldChain {
  const refs = useRef<(Destino | null)[]>([]);
  // The declared length is the truth: a chain can be shorter than the form if a
  // field is conditional, and it can never be longer.
  refs.current.length = campos;

  const register = useCallback(
    (i: number) => (campo: Destino | null) => {
      refs.current[i] = campo;
    },
    [],
  );

  const focus = useCallback((i: number) => {
    refs.current[i]?.focus();
  }, []);

  const advance = useCallback((i: number, alFinal: () => void) => {
    avanzar(refs.current, i, alFinal);
  }, []);

  return useMemo(
    () => ({ register, advance, focus, length: campos }),
    [register, advance, focus, campos],
  );
}

/** The type a `TextInput` satisfies, for a caller's own annotations. */
export type CampoTextual = TextInput;