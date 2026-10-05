import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKSPACE_COLOR,
  WORKSPACE_COLORS,
  cardColors,
  colorOf,
  isDark,
  isWorkspaceColor,
  spacePaint,
} from '../src/lib/workspace/color';

/** How much light a colour reflects, 0–1. The same maths `isDark` uses. */
function luminanceOf(hex: string): number {
  const value = hex.replace('#', '');
  /** The linearised channel that starts at `start`, 0 for red, 2 green, 4 blue. */
  const channel = (start: number) => {
    const c = parseInt(value.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * The colour of a space, and what can be read on it.
 *
 * A person chooses this colour and then reads their own lists on it, so the two
 * mistakes that matter are a card whose text cannot be read and two spaces that
 * look the same at card size.
 */
describe('colorOf', () => {
  it('gives the colour somebody chose', () => {
    expect(colorOf('teal')).toBe('#0F766E');
  });

  it('gives the default for a space with no colour or a broken one', () => {
    // A space written by an older build has no colour, and a space written by a
    // future build might have one this one does not. Neither is a reason to
    // paint a card with nothing.
    expect(colorOf(null)).toBe(colorOf(DEFAULT_WORKSPACE_COLOR));
    expect(colorOf(undefined)).toBe(colorOf(DEFAULT_WORKSPACE_COLOR));
    expect(colorOf('no-existe')).toBe(colorOf(DEFAULT_WORKSPACE_COLOR));
  });
});

describe('isWorkspaceColor', () => {
  it('knows the colours it offers', () => {
    for (const color of WORKSPACE_COLORS) {
      expect(isWorkspaceColor(color.key)).toBe(true);
    }
  });

  it('says no to anything else', () => {
    expect(isWorkspaceColor('unicorn')).toBe(false);
    expect(isWorkspaceColor(null)).toBe(false);
    expect(isWorkspaceColor(42)).toBe(false);
  });
});

describe('isDark', () => {
  it('knows a dark colour from a light one', () => {
    expect(isDark('#0B1120')).toBe(true);
    expect(isDark('#FFFFFF')).toBe(false);
  });

  it('has the answer for every colour the picker offers', () => {
    // Whichever way it comes out, the text colour follows it, so the only thing
    // that could be wrong is a colour that is neither.
    for (const { hex } of WORKSPACE_COLORS) {
      expect(typeof isDark(hex)).toBe('boolean');
    }
  });

  it('does not throw on something that is not a colour', () => {
    expect(isDark('no')).toBe(false);
    expect(isDark('#fff')).toBe(false);
  });
});

describe('cardColors', () => {
  it('picks white text on a dark colour and dark text on a light one', () => {
    expect(cardColors('#0F766E').foreground).toBe('#FFFFFF');
    expect(cardColors('#FFFFFF').foreground).toBe('#0B1120');
  });

  it('keeps the second tone readable on the card', () => {
    // The counts and the hints are the second tone, and a grey that is right on
    // a page is invisible on a coloured card.
    for (const { hex } of WORKSPACE_COLORS) {
      const colors = cardColors(hex);
      expect(colors.muted).not.toBe(colors.foreground);
      expect(colors.background).toBe(hex);
    }
  });
});

describe('the palette', () => {
  it('has no two colours the same', () => {
    const hexes = WORKSPACE_COLORS.map((color) => color.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('is short enough to choose from on a phone', () => {
    // A picker with fifty shades is a picker nobody can choose from.
    //
    // It was 10, and now it is 12, because four colours that were missing were
    // the same four somebody would ask for. The ceiling is not the cap on what
    // you can have: the custom colour is unbounded, and that is what is supposed
    // to take the pressure off this list. If this number ever goes much past a
    // dozen, the answer is more swatches per page, not more swatches.
    expect(WORKSPACE_COLORS.length).toBeLessThanOrEqual(12);
  });

  it('is long enough to cover the gaps between the ones it had', () => {
    // A list of eight and no purple in it is a list where somebody is told there
    // is no purple. These four are the holes that were obvious: a pink that is
    // not the rose, a red that is not the pink, a green that is not the moss, a
    // brown that is not the amber.
    for (const hueco of ['plum', 'crimson', 'forest', 'copper']) {
      expect(WORKSPACE_COLORS.map((c) => c.key)).toContain(hueco);
    }
  });
});

describe('un color propio', () => {
  it('lo pinta igual que uno con nombre: con su degradado y no plano', () => {
    // The whole point of deriving the wash. A custom colour that came out flat
    // would be the one card in the app that does not look like the others, and
    // the person who chose it would be the one who noticed.
    const paint = spacePaint('#7E22CE');
    expect(paint.gradient[0]).not.toBe(paint.gradient[1]);
  });

  it('empieza en el color elegido, no en un tono neighbour suyo', () => {
    // The first stop *is* the colour that was chosen. An earlier version lifted
    // the whole wash by a step and the test above caught it: the top of the
    // gradient was a colour nobody picked, which on a card you are about to
    // recognise across the app is a colour you have to learn.
    expect(spacePaint('#7E22CE').gradient[0]).toBe('#7E22CE');
  });

  it('el degradado va de claro a oscuro, en ese orden', () => {
    // Compared by how much light each end actually reflects, and not by asking
    // `isDark` whether the top end is light. Those are different questions: this
    // blue is dark by luminance even when it is halfway up in HSL, and the first
    // version of this test asked for `isDark(gradient[0]) === false` and failed on
    // a colour that was doing exactly the right thing.
    const paint = spacePaint('#3366CC');
    expect(luminanceOf(paint.gradient[0])).toBeGreaterThan(luminanceOf(paint.gradient[1]));
  });

  it('y en los doce, el degradado va siempre de claro a oscuro', () => {
    for (const color of WORKSPACE_COLORS) {
      expect(luminanceOf(color.from)).toBeGreaterThan(luminanceOf(color.to));
    }
  });

  it('y un color propio tambien', () => {
    const paint = spacePaint('#3366CC');
    expect(luminanceOf(paint.gradient[0])).toBeGreaterThan(luminanceOf(paint.gradient[1]));
  });

  it('no mueve el tono: es el color que se eligió', () => {
    // El primer lado es exactamente lo que se escribio, sin tocar un canal. El
    // segundo es una version ligeramente mas oscura del mismo tono, y ese es el
    // unico que se deriva.
    expect(spacePaint('#2E7D32').stops[0]).toBe('#2E7D32');
  });

  it('no puede conservar la saturacion ni el tono exactos, y no lo promete', () => {
    // El tono y la saturacion en HSL se derivan de los tres canales RGB, asi que
    // mover la claridad los mueve solos. Un test que exigia que se conservaran
    // estaba probando algo imposible: el lapsus real medido fue de 0.86 grados de
    // tono, que no se ve.
    //
    // Lo que si se conserva, y es lo unico que importa, es que el segundo lado es
    // el mismo color y no un color parecido.
    const paint = spacePaint('#2E7D32');
    expect(paint.stops[0]).toBe('#2E7D32');
    expect(paint.stops[1]).not.toBe('#2E7D32');
    expect(Math.abs(luminanceOf(paint.stops[1]) - luminanceOf('#2E7D32'))).toBeLessThan(0.1);
  });

  it('un color casi blanco no se lava y uno casi negro no se apaga', () => {
    // El motivo del suelo en `washOf`. Sin el, un casi negro salia negro contra
    // negro: un degradado sin degradado, que es el mismo fallo que un color plano
    // con otra causa.
    const claro = spacePaint('#F2F2F7');
    expect(claro.stops[0]).not.toBe(claro.stops[1]);
    expect(claro.stops[0]).not.toBe('#FFFFFF');

    const oscuro = spacePaint('#101014');
    expect(oscuro.stops[0]).not.toBe(oscuro.stops[1]);
    expect(oscuro.stops[1]).not.toBe('#000000');
    // Y los dos lados siguen siendo legibles, que es lo que el suelo protege.
    expect(oscuro.foreground).toBe('#FFFFFF');
  });

  it('un color casi blanco no se lava y uno casi negro no se apaga', () => {
    // The reason the steps are bounded instead of a fixed offset. White moved
    // 9% lighter is still white, and the gradient disappears; the bound is what
    // keeps the shape at both ends.
    const claro = spacePaint('#F2F2F7');
    expect(claro.gradient[0]).not.toBe(claro.gradient[1]);
    expect(claro.gradient[0]).not.toBe('#FFFFFF');

    const oscuro = spacePaint('#101014');
    expect(oscuro.gradient[0]).not.toBe(oscuro.gradient[1]);
    expect(oscuro.gradient[1]).not.toBe('#000000');
  });

  it('el texto se lee igual en un color propio, claro u oscuro', () => {
    expect(spacePaint('#1F6FEB').foreground).toBe('#FFFFFF');
    expect(spacePaint('#FFE08A').foreground).toBe('#0B1120');
  });

  it('acepta minúsculas con almohadilla, y siempre sale en mayúsculas', () => {
    expect(colorOf('#a1b2c3')).toBe('#A1B2C3');
  });

  it('sin almohadilla tampoco es un color distinto, a proposito', () => {
    // **El motivo de antes era el que este commit quita.** Decia: "el servidor solo
    // acepta `#RRGGBB` y el contrato tambien", y por eso `a1b2c3` caia en gris.
    // Eso era verdad y ya no lo es: el servidor **normaliza** en vez de rechazar, y
    // lo normaliza con `normalizaColor`, la misma funcion que contesta aqui. O sea
    // que el argumento ya no es "el servidor no lo acepta" sino **"hay una sola
    // regla y el servidor la aplica igual que la app"** — que es lo que hace
    // seguro aceptar: no que las dos copias coincidan hoy, sino que no haya dos.
    expect(colorOf('a1b2c3')).toBe('#A1B2C3');
  });

  it('un texto que no es un color cae en el color por defecto', () => {
    // Lo que llega aqui desde un campo de texto y no es un color: un nombre de color
    // en vez de un hex, una funcion de CSS y algo con dos puntos dentro, que es lo
    // que un campo de texto acepta y no es una declaracion de color. Un estilo hecho
    // con uno de ellos es una tarjeta que nadie lee.
    //
    // **`#abc` salio de la lista, y el comentario de al lado tambien.** Decia que
    // `#abc` no era "un color que esta app pueda pintar", y es falso: es un color
    // perfectamente bueno, el validador del movil lo ha aceptado siempre —tres
    // digitos, a proposito— y `colorOf('#abc')` da `#AABBCC`. Lo que cambio no es
    // que ahora se admita: es que **ya se admitia** en el campo, en el mapa de
    // etiquetas y en el contrato, y aqui se rechazaba. Siete reglas para una
    // pregunta, y la que estaba en el camino de dibujo era la equivocada.
    for (const basura of ['rojo', 'rgb(1,2,3)', 'javascript:alert(1)', '#12345']) {
      expect(colorOf(basura)).toBe(colorOf(DEFAULT_WORKSPACE_COLOR));
    }
    expect(colorOf('#abc')).toBe('#AABBCC');
  });

  it('no dice que un color propio es uno de los que ofrece', () => {
    // Otherwise the picker would draw it in the named row and lose it.
    expect(isWorkspaceColor('#1F6FEB')).toBe(false);
    expect(colorOf('#1F6FEB')).not.toBe(colorOf('slate'));
  });
});
