import { describe, expect, it } from 'vitest';

import { WORKSPACE_COLORS, colorOf, isDark, spacePaint } from '../src/lib/workspace/color';
import {
  anguloDiagonal,
  isWashVariant,
  lightnessPara,
  luminanceDe,
  WASH_VARIANTS,
  washOf,
} from '../src/lib/workspace/wash';

/**
 * Two colours and two directions, and the two promises they have to keep.
 *
 * **The text is readable on both ends.** That is the one that is not negotiable,
 * and it is the one that fails quietly: the ends are two colours now, chosen by
 * two different presses, so they can be any pair at all, including a pale yellow
 * next to a deep blue.
 */
describe('el texto se lee en los dos lados', () => {
  const pares: [string, string | null][] = [
    ['#0F766E', null],
    ['#0F766E', '#4338CA'],
    ['#4338CA', '#FFE08A'],
    ['#FFE08A', '#0B1120'],
    ['#B45309', '#1F6FEB'],
    ['#1F6FEB', '#E91E8C'],
    ['#D97706', '#F5F5F5'],
    ['#0B1120', '#1F6FEB'],
  ];

  for (const [desde, hasta] of pares) {
    it(`${desde} -> ${hasta ?? 'derivado'} decide el texto una vez y para los dos lados`, () => {
      const wash = washOf(desde, hasta, 'diagonal');
      const [a, b] = wash.stops;

      if (wash.dark) {
        // Dark wash: the *lighter* end is the one that has to take white text, and
        // that is the end the decision is made from. Checking the darker one is
        // the version that passes and then puts white on a pale yellow.
        expect(isDark(a) || isDark(b)).toBe(true);
        const masClaro = luminanceDe(a) >= luminanceDe(b) ? a : b;
        expect(isDark(masClaro)).toBe(true);
      } else {
        const masClaro = luminanceDe(a) >= luminanceDe(b) ? a : b;
        expect(isDark(masClaro)).toBe(false);
      }
    });
  }

  it('el color elegido se respeta tal cual, sin re-iluminarlo', () => {
    // The whole point of a second colour field is that the person chose it. A
    // version that re-lights it is telling them they chose something else, and
    // the two fields would be the same field with extra steps.
    expect(washOf('#0F766E', '#FFE08A', 'diagonal').stops).toEqual(['#0F766E', '#FFE08A']);
  });

  it('sin segundo color elegido, se deriva y no queda plano', () => {
    const wash = washOf('#0F766E', null, 'diagonal');
    expect(wash.stops).toHaveLength(2);
    expect(wash.stops[0]).not.toBe(wash.stops[1]);
    // Y el primer lado es el color elegido, exacto.
    expect(wash.stops[0]).toBe('#0F766E');
  });

  it('los doce colores y sus doceMixin dan los dos lados sin romperse', () => {
    for (const color of WORKSPACE_COLORS) {
      for (const otro of WORKSPACE_COLORS) {
        const wash = washOf(color.hex, otro.hex, 'diagonal');
        for (const stop of wash.stops) {
          expect(stop).toMatch(/^#[0-9A-F]{6}$/);
        }
        if (wash.dark) {
          const masClaro =
            luminanceDe(wash.stops[0]) >= luminanceDe(wash.stops[1])
              ? wash.stops[0]
              : wash.stops[1];
          expect(isDark(masClaro)).toBe(true);
        }
      }
    }
  });
});

describe('los dos sentidos', () => {
  it('son los dos y solo los dos', () => {
    expect([...WASH_VARIANTS]).toEqual(['diagonal', 'vertical']);
  });

  it('el vertical dice vertical y el otro no', () => {
    expect(washOf('#0F766E', null, 'vertical').shape).toBe('vertical');
    expect(washOf('#0F766E', null, 'diagonal').shape).toBe('diagonal');
  });

  it('y los dos llevan los mismos dos colores', () => {
    // Cambiar de sentido no puede cambiar los colores, y si los cambiara la
    // eleccion de la direccion seria perder la del color sin querer.
    const a = washOf('#0F766E', '#4338CA', 'diagonal');
    const b = washOf('#0F766E', '#4338CA', 'vertical');
    expect(b.stops).toEqual(a.stops);
    expect(b.shape).not.toBe(a.shape);
  });

  it('reconoce los dos y nada mas', () => {
    for (const v of WASH_VARIANTS) expect(isWashVariant(v)).toBe(true);
    for (const viejo of ['complementary', 'split', 'triadic', 'radial']) {
      expect(isWashVariant(viejo)).toBe(false);
    }
  });
});

describe('el angulo del diagonal, que es donde estaba el fallo', () => {
  it('en un cuadrado son 45 grados, que es lo de siempre', () => {
    expect(anguloDiagonal(100, 100)).toBeCloseTo(45, 5);
  });

  it('en una caja mas ancha que alta tira a la derecha, no al techo', () => {
    // Los grados de un degradado CSS se cuentan **desde arriba**: 0 es hacia
    // arriba, 90 hacia la derecha. Para ir de esquina a esquina el angulo es el
    // ancho sobre el alto. Al reves, en una banda de 398x127 salen 12 grados, y
    // un degradado a 12 grados apunta al techo: medido, recorrido vertical 0.
    expect(anguloDiagonal(398, 127)).toBeGreaterThan(70);
    expect(anguloDiagonal(398, 127)).toBeLessThan(80);
  });

  it('y en una mas alta que ancha sale menos de 90, que es lo que un angulo puede ser', () => {
    // El rango util de un degradado lineal va de 0 a 90: por encima de 90 la
    // direccion empieza a dar la vuelta, y una vez—all-around— ya no va de un
    // corner a otro. Asi que una caja vertical se queda cerca de la vertical y no
    // se pasa de 90.
    expect(anguloDiagonal(127, 398)).toBeGreaterThan(10);
    expect(anguloDiagonal(127, 398)).toBeLessThan(20);
  });

  it('el recorrido en cada eje es siempre el mismo para las dos diagonales', () => {
    // La comprobacion que de verdad importa, y la que el bug anterior suspendia:
    // el diagonal tiene que tener recorrido horizontal Y vertical, y el vertical
    // tiene que ser cero.
    const c = (w: number, h: number, vertical: boolean) => {
      const rad = (anguloDiagonal(w, h) * Math.PI) / 180;
      return vertical ? Math.abs(Math.cos(rad)) : Math.abs(Math.sin(rad));
    };
    expect(c(398, 127, false)).toBeGreaterThan(0.9);
    expect(c(398, 127, true)).toBeGreaterThan(0.1);
  });

  it('una caja de tamano cero no da NaN', () => {
    // Pasa en el primer render, antes de que onLayout haya dicho nada. Un NaN en
    // el `end` del degradado es un degradado que no se dibuja.
    for (const [w, h] of [[0, 0], [0, 100], [100, 0], [-5, -5]] as const) {
      const angulo = anguloDiagonal(w, h);
      expect(Number.isFinite(angulo)).toBe(true);
      expect(angulo).toBeGreaterThanOrEqual(0);
      expect(angulo).toBeLessThanOrEqual(90);
    }
  });
});

describe('la busqueda de claridad', () => {
  it('da la claridad que produce la luz pedida', () => {
    for (const objetivo of [0.05, 0.2, 0.35, 0.5, 0.75]) {
      const l = lightnessPara(210, 0.8, objetivo);
      expect(luminanceDe(hslLocal(210, 0.8, l))).toBeCloseTo(objetivo, 2);
    }
  });

  it('con saturacion cero tambien, y no se rompe', () => {
    for (const objetivo of [0.1, 0.5, 0.9]) {
      expect(Number.isFinite(lightnessPara(0, 0, objetivo))).toBe(true);
    }
  });

  it('un objetivo imposible se acerca al extremo, no rompe nada', () => {
    for (const objetivo of [-5, 5, Number.NaN, Infinity]) {
      const l = lightnessPara(120, 0.5, objetivo);
      expect(Number.isFinite(l)).toBe(true);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
    }
  });
});

describe('lo que ve spacePaint', () => {
  it('un color nombrado sin segundo color conserva los dos tonos de la paleta', () => {
    // Los dos extremos los eligio una persona y se leen mejor que cualquier cosa
    // que produzca la matematica. Tirarlos para simplificar el codigo empeoraria la
    // app en el estado en el que estan casi todos los espacios.
    const paint = spacePaint('teal');
    const teal = WORKSPACE_COLORS.find((c) => c.key === 'teal')!;
    expect(paint.stops).toEqual([teal.from, teal.to]);
  });

  it('pero en cuanto hay segundo color, el color elegido manda', () => {
    const paint = spacePaint('teal', 'diagonal', '#4338CA');
    expect(paint.stops).toEqual(['#0F766E', '#4338CA']);
  });

  it('y un color propio sin segundo color se deriva a si mismo', () => {
    const paint = spacePaint('#1F6FEB');
    expect(paint.stops[0]).toBe('#1F6FEB');
    expect(paint.stops[1]).not.toBe('#1F6FEB');
  });

  it('el texto sale de la pintura, no de un suppose', () => {
    expect(spacePaint('#0B1120').foreground).toBe('#FFFFFF');
    expect(spacePaint('#FFE08A').foreground).toBe('#0B1120');
  });
});

describe('colores rotos', () => {
  it('un espacio sin color o con uno imposible se pinta con el de por defecto', () => {
    for (const basura of [null, undefined, 'no-existe', 'rojo', 'javascript:alert(1)']) {
      expect(colorOf(basura)).toBe(colorOf('slate'));
    }
  });
});

/** HSL to hex, reimplemented here so the maths is not tested against itself. */
function hslLocal(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const ch = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}
