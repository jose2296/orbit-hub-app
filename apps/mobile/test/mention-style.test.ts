import { describe, expect, it } from 'vitest';

import { mentionIndicatorFor, mentionIndicatorFor as indicatorDe } from '@orbit-hub/contracts';

import { mentionStyleMap } from '@/lib/journal/mention-style';
import { normaliseIndicator, renderMentions } from '@/lib/journal/mentions';

const acento = { color: '#b9c7ff', background: '#1b2440' };

const chip = (type: string, id: string, text: string, indicator: string) =>
  `<mention text="${text}" indicator="${indicator}" type="${type}" id="${id}">${text}</mention>`;

/**
 * El estilo con el que se pinta un chip, y el indicador con el que se le pinta.
 *
 * La librería busca el estilo por el indicador que lleva el chip y, si no lo
 * encuentra, no pinta nada: en Android el span se queda con el subrayado que traía
 * el texto y sin fondo, y en la web cae al default de la propia librería, que es
 * azul sobre amarillo.
 *
 * El color pasó de viajar dentro del indicador (`@teal`) a viajar como un carácter,
 * y un chip escrito antes del cambio sigue llevando el viejo.
 */
describe('el indicador de un chip', () => {
  it('uno nuevo se queda como está', () => {
    expect(normaliseIndicator(indicatorDe('slate'))).toBe(indicatorDe('slate'));
    expect(normaliseIndicator('@')).toBe('@');
  });

  it('uno viejo se reescribe al de su color', () => {
    expect(normaliseIndicator('@slate')).toBe(indicatorDe('slate'));
    expect(normaliseIndicator('@moss')).toBe(indicatorDe('moss'));
  });

  it('uno que no es de ningún color conocido se deja como está', () => {
    // Un chip de una build que sepa más colores que esta tiene que seguir abriendo.
    expect(normaliseIndicator('@malva')).toBe('@malva');
    expect(normaliseIndicator('§')).toBe('§');
  });

  it('un chip guardado con indicador viejo se pinta con el de su color', () => {
    const mapa = mentionStyleMap(acento);
    const html = chip('list', '11111111-2222-4333-8444-555555555555', 'Borrada', '@slate');
    const target = { name: 'Lista', route: '/', icon: '📋', colour: 'slate' };

    const shown = renderMentions(html, () => target, { mode: 'reading', unavailableLabel: 'no disponible' });

    // El indicador que sale es el nuevo: con el viejo, el estilo no se encontraría.
    expect(shown).toContain(`indicator="${indicatorDe('slate')}"`);
    // Y ese indicador nuevo sí tiene estilo, que es el fallo que se arregla.
    expect(mapa[indicatorDe('slate')]).toBeDefined();
  });

  it('un chip sin destino también se pinta con el indicador de su color', () => {
    // El caso que se veía roto: el destino no está en el caché, el chip dice "no
    // disponible" y se quedaba con el indicador viejo, que no encuentra estilo.
    const html = chip('note', '11111111-2222-4333-8444-555555555555', 'Apuntes', '@moss');

    const shown = renderMentions(html, () => null, { mode: 'reading', unavailableLabel: 'no disponible' });

    expect(shown).toContain(`indicator="${indicatorDe('moss')}"`);
    expect(shown).toContain('>no disponible</mention>');
  });
});

describe('mentionStyleMap', () => {
  it('tiene un estilo por color de espacio, con el indicador de un carácter', () => {
    const mapa = mentionStyleMap(acento);

    for (const color of ['teal', 'rose', 'slate', 'moss', 'amber', 'violet', 'ocean', 'rust', 'sage', 'plum', 'clay', 'ink'] as const) {
      expect(mapa[mentionIndicatorFor(color)], `falta el estilo de ${color}`).toBeDefined();
    }
  });

  it('no lleva claves de indicador viejo, porque en web compartirían variable con el gatillo', () => {
    /*
      La web deriva el nombre del estilo del primer carácter del indicador, así que
      una clave `@teal` compartiría variable con el `@` pelado y el último escrito
      ganaría: el acento se volvería del color que fuese el último de la lista.
      Añadirlas "arregla" el teléfono mientras pinta el navegador del color que no
      es. Por eso el arreglo está en `normaliseIndicator` y no aquí.
    */
    const mapa = mentionStyleMap(acento);

    for (const color of ['teal', 'slate', 'moss'] as const) {
      expect(mapa[`@${color}`]).toBeUndefined();
    }
  });

  it('el disparador pelado sigue teniendo su estilo, que es el del acento', () => {
    const mapa = mentionStyleMap(acento);

    expect(mapa['@']).toEqual({
      color: acento.color,
      backgroundColor: acento.background,
      textDecorationLine: 'none',
    });
  });
});
