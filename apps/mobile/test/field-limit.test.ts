import { describe, expect, it } from 'vitest';

import {
  FOLDER_NAME_MAX,
  LIST_ITEM_ANNOTATION_MAX,
  LIST_ITEM_TITLE_MAX,
  LIST_TITLE_MAX,
  NOTE_TITLE_MAX,
  WORKSPACE_NAME_MAX,
} from '@orbit-hub/contracts';

import { counterState, FIELD_LIMITS } from '../src/lib/lists/field-limit';

/**
 * El contador de un campo con límite.
 *
 * Los límites estaban en tres sitios sin conexión entre ellos, y el contador es
 * el cuarto consumidor que hace falta para que se note: si el número del campo no
 * es el mismo que va a cortar el servidor, el contador miente.
 *
 * `counterState` es pura y aquí se comprueba con los números reales del contrato,
 * no con literales escritos en el test: un `10 / 300` que se parece al de ahora
 * y un `10 / 250` que ya no se parece son el mismo test y pasan igual.
 */

describe('los límites son los del contrato', () => {
  it('el contador de un campo usa el ancho con el que se va a guardar', () => {
    expect(FIELD_LIMITS['list_item.title']).toBe(LIST_ITEM_TITLE_MAX);
    expect(FIELD_LIMITS['list.title']).toBe(LIST_TITLE_MAX);
    expect(FIELD_LIMITS['list_item.annotation']).toBe(LIST_ITEM_ANNOTATION_MAX);
    expect(FIELD_LIMITS['note.title']).toBe(NOTE_TITLE_MAX);
    expect(FIELD_LIMITS['workspace.name']).toBe(WORKSPACE_NAME_MAX);
    expect(FIELD_LIMITS['folder.name']).toBe(FOLDER_NAME_MAX);
  });

  it('el título de una tarea admite más que el de una lista, y tiene que notarlo', () => {
    // Si estos dos se cruzaran, un contador aceptaría texto que el servidor cortaría
    // o al revés. Los dos valores vienen del contrato, que es donde se decidió que
    // un título de tarea es más largo a propósito.
    expect(LIST_ITEM_TITLE_MAX).toBeGreaterThan(LIST_TITLE_MAX);
  });
});

describe('counterState', () => {
  it('enseña lo que llevas y lo que cabe, como lo lee una persona', () => {
    const estado = counterState('Compra', LIST_ITEM_TITLE_MAX);

    expect(estado.value).toBe(`6 / ${LIST_ITEM_TITLE_MAX}`);
    expect(estado.tone).toBe('subtle');
    expect(estado.atLimit).toBe(false);
  });

  it('avisa antes de llegar al final, cuando todavía se puede corregir', () => {
    const casi = counterState('x'.repeat(LIST_ITEM_TITLE_MAX - 5), LIST_ITEM_TITLE_MAX);

    expect(casi.atLimit).toBe(false);
    expect(casi.nearlyFull).toBe(true);
    expect(casi.tone).toBe('muted');
  });

  it('avisa distinto cuando ya no cabe más', () => {
    const lleno = counterState('x'.repeat(LIST_ITEM_TITLE_MAX), LIST_ITEM_TITLE_MAX);

    expect(lleno.atLimit).toBe(true);
    expect(lleno.nearlyFull).toBe(false);
    expect(lleno.tone).toBe('danger');
  });

  it('no se pone en rojo antes de tiempo', () => {
    // Diez caracteres de margen es el aviso. A nueve de cero todavía se puede
    // escribir y corregir, y ponerlo en rojo ahí es como se enseña a ignorar el
    // color de un contador.
    const justoAntes = counterState('x'.repeat(LIST_ITEM_TITLE_MAX - 10), LIST_ITEM_TITLE_MAX);

    expect(justoAntes.tone).toBe('muted');
    expect(justoAntes.tone).not.toBe('danger');
  });

  it('un campo vacío no parece lleno', () => {
    const vacio = counterState('', LIST_TITLE_MAX);

    expect(vacio.value).toBe(`0 / ${LIST_TITLE_MAX}`);
    expect(vacio.atLimit).toBe(false);
  });

  it('cuenta lo que se ha escrito, incluidos los espacios del final', () => {
    // `String.length` cuenta unidades UTF-16, que es lo que corta `maxLength` en las
    // tres plataformas. Un campo con espacios al final cuenta más, que es lo que va
    // a pasar al guardar.
    const conEspacios = counterState('abc   ', LIST_TITLE_MAX);

    expect(conEspacios.value).toBe(`6 / ${LIST_TITLE_MAX}`);
  });

  it('un emoji cuenta como dos, porque es lo que cuenta el límite', () => {
    // No es lo que ve la persona —un glifo— pero es lo que corta `maxLength`, y un
    // contador que dijera otra cosa llevaría a un estado que el campo no puede
    // alcanzar. Por eso esto es un aviso y no un tope.
    const conEmoji = counterState('🏠', LIST_TITLE_MAX);

    expect(conEmoji.value).toBe(`2 / ${LIST_TITLE_MAX}`);
  });
});
