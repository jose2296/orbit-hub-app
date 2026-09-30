import { describe, expect, it } from 'vitest';

import { nextPosition, planAddToList } from '../src/lib/lists/add-to-list';

/**
 * Adding one title to another list.
 *
 * The rules are the ones a person would not think about and would notice when
 * they are wrong: the same film in two lists is a duplicate and not a copy, and
 * a hand written row has to be able to be added twice.
 */
describe('planAddToList', () => {
  it('adds a title that is not in the list yet', () => {
    expect(planAddToList([{ externalId: 'movie:1' }], { externalId: 'movie:2' })).toEqual({
      added: true,
    });
  });

  it('refuses a title the list already has', () => {
    /*
     * `itemId` va en la asercion porque ahora **forma parte de lo que se
     * responde**: un rechazo que dice que no, pero no cual fila, obliga a cada
     * llamador a buscarla otra vez por su cuenta, y uno de ellos se olvidaba. Aqui
     * la lista no trae id, asi que sale `null`: se sabe que hay una fila y no se
     * sabe cual, que es exactamente lo que la lista dice.
     */
    expect(
      planAddToList(
        [{ externalId: 'movie:1' }, { externalId: 'movie:2' }],
        { externalId: 'movie:1' },
      ),
    ).toEqual({ added: false, reason: 'already-there', itemId: null });
  });

  it('adds a title with no provider id, because nothing can match it', () => {
    // A hand written row has no id, so comparing ids would call every one of
    // them a duplicate of the others and the list could never grow by hand.
    expect(planAddToList([{ externalId: null }], { externalId: null })).toEqual({ added: true });
    expect(planAddToList([{ externalId: null }], { externalId: 'movie:1' })).toEqual({ added: true });
  });

  it('adds to an empty list', () => {
    expect(planAddToList([], { externalId: 'movie:1' })).toEqual({ added: true });
  });

  it('compares the ids exactly, not by prefix', () => {
    // "movie:1" is a prefix of "movie:10" and they are different films.
    expect(planAddToList([{ externalId: 'movie:10' }], { externalId: 'movie:1' })).toEqual({
      added: true,
    });
  });

  it('treats an empty id as no id rather than as a match', () => {
    // An empty string is falsy but not null, and a client from a future build
    // could send it; treating it as a value would collapse the whole list.
    expect(planAddToList([{ externalId: '' }], { externalId: '' })).toEqual({ added: true });
  });
});

describe('nextPosition', () => {
  it('starts at zero in an empty list', () => {
    expect(nextPosition([])).toBe(0);
  });

  it('goes after the last item, not into the gap a delete left', () => {
    expect(nextPosition([{ position: 0 }, { position: 5 }])).toBe(6);
  });

  it('never returns a negative position from a corrupt list', () => {
    expect(nextPosition([{ position: -3 }])).toBe(1);
  });
});

describe('planAddToList dice QUE fila es la que ya esta', () => {
  /*
   * "Ya lo tienes" es una frase que se puede leer. Poder abrir esa fila es lo que
   * convierte la frase en algo accionable, y antes cada llamador volvia a buscar
   * la misma fila por su cuenta.
   */
  const lista = [
    { id: 'a', externalId: 'movie:1' },
    { id: 'b', externalId: 'movie:2' },
  ];

  it('devuelve el id de la fila que coincide', () => {
    const plan = planAddToList(lista, { externalId: 'movie:2' });
    expect(plan).toEqual({ added: false, reason: 'already-there', itemId: 'b' });
  });

  it('no dice id cuando si anade', () => {
    const plan = planAddToList(lista, { externalId: 'movie:3' });
    expect(plan.added).toBe(true);
    expect(plan.itemId).toBeUndefined();
  });

  it('una lista sin id sigue negando el duplicado, porque la regla no mira el id', () => {
    /*
     * La fila sin `id` es de las que llegan de la cache vieja o de un cliente que
     * no manda el campo. La regla tiene que seguir valiendo: si por no tener id
     * no negara el duplicado, un item importado entraria dos veces solo por venir
     * de otra parte.
     */
    const plan = planAddToList([{ externalId: 'movie:1' }], { externalId: 'movie:1' });
    expect(plan.added).toBe(false);
    expect(plan.itemId).toBeNull();
  });
});
