import { describe, expect, it } from 'vitest';

import {
  HUE_STRIP,
  hexToHsv,
  hslToHex,
  hsvToHex,
  puntoAHsv,
  puntoAHue,
  rgbToHsl,
} from '../src/lib/workspace/picker';

/**
 * The arithmetic a colour picker is made of.
 *
 * Every one of these is a place where a drag can quietly do the wrong thing, and
 * the wrong thing is a colour nobody chose. The round trip is the one that
 * matters most: if it is not the identity, the picker moves a colour by pressing
 * the button that says "save this colour".
 */
describe('el color que vuelve a ser el mismo', () => {
  it('ida y vuelta no lo cambia', () => {
    for (const hex of [
      '#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#000000',
      '#1F6FEB', '#FFE08A', '#2E7D32', '#7E22CE', '#334155',
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('tambien con minúsculas y con la forma de tres cifras', () => {
    expect(hsvToHex(hexToHsv('#1f6feb'))).toBe('#1F6FEB');
    expect(hsvToHex(hexToHsv('#fff'))).toBe('#FFFFFF');
  });

  it('sale siempre en mayúsculas y con almohadilla', () => {
    // Dos formas de decir el mismo color comparan mal, y la comparacion es lo
    // que decide si el selector esta sucio o no.
    expect(hsvToHex({ h: 0, s: 0, v: 0.5 })).toBe('#808080');
  });
});

describe('un gris no tiene tono', () => {
  it('y no se rompe al pedirselo', () => {
    // La formula del tono divide por la diferencia entre el mayor y el menor, que
    // en un gris es cero. Es el caso que mas veces se da al empezar: el blanco de
    // la esquina del cuadrado.
    for (const gris of ['#000000', '#404040', '#808080', '#C0C0C0', '#FFFFFF']) {
      const hsv = hexToHsv(gris);
      expect(hsv.s).toBe(0);
      expect(hsv.v).toBeCloseTo(hexToHsv(gris).v, 5);
    }
  });

  it('y el tono que invente se pierde al volver a mezclar', () => {
    expect(hsvToHex({ h: 200, s: 0, v: 0.5 })).toBe('#808080');
  });
});

describe('la tira de tonos', () => {
  it('empieza y acaba en el mismo, para que closing el circulo no salte', () => {
    expect(HUE_STRIP[0]).toBe(HUE_STRIP[HUE_STRIP.length - 1]);
  });

  it('recorre los seis primarios en orden', () => {
    const esperados = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF'];
    expect([...HUE_STRIP].slice(0, 6)).toEqual(esperados);
  });

  it('tocar el extremo derecho da el ultimo tono, no uno de mas', () => {
    // 360 es el mismo que 0, y un hereje que se salga por 360 pinza el marcador
    // fuera de la tira.
    expect(puntoAHue(1000, 100)).toBe(360);
    expect(puntoAHue(50, 100)).toBe(180);
  });
});

describe('un color que no es un color', () => {
  it('no puede salir como "#NANNANNAN" ni nada parecido', () => {
    // El fallo mas caro de esta parte, y no daba ningun error: una clave de paleta
    // ("sky") llega a donde se esperaba un hex, `parseInt("sk", 16)` sale NaN, y el
    // hex resultante es "#NANNANNAN". CSS rechaza el degradado entero, y el nodo se
    // queda con el primer degradado valido que pinto — o sea, toda la pantalla con
    // los colores de otro momento y sin un solo error en ninguna parte.
    for (const basura of ['sky', 'sksksk', '', 'rojo', 'javascript:x', '#12345', 'NaN']) {
      for (const salida of [hslToHex(0, 1, 0.5), hsvToHex({ h: 0, s: 1, v: 0.5 })]) {
        expect(salida).toMatch(/^#[0-9A-F]{6}$/);
      }
      expect(rgbToHsl(basura).l).toBeGreaterThanOrEqual(0);
      expect(rgbToHsl(basura).l).toBeLessThanOrEqual(1);
      expect(hexToHsv(basura).v).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(rgbToHsl(basura).h)).toBe(true);
    }
  });

  it('con cualquier numero que no es un numero sale un hex de seis digitos', () => {
    // **La forma es lo que se afirma, no el color.** Esto no es una tabla de tres
    // casos: son las 64 combinaciones de un valor normal, `NaN`, `Infinity` y
    // `-Infinity` en cada uno de los tres parametros a la vez, y lo unico que se mira
    // de las 64 es que la salida tenga la forma de un `#RRGGBB`, que son seis
    // digitos hexadecimales y nada mas. Que color sale en cada una da igual, y por
    // eso no se afirma: `#NANNANNAN` son diez caracteres —nueve cifras, ninguna
    // hexadecimal— y `#INFINITYINFINITYINFINITY` veinticinco, asi que ningun parser
    // de CSS los puede leer y el elemento se queda con lo que ya habia pintado.
    const valores = {
      h: [210, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      s: [0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      l: [0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    };
    // Los tres valores normales estan dentro de su rango a proposito: lo que se
    // prueba es lo que no es un numero. Un `s` de 5 tampoco da un `#RRGGBB`, y es
    // otra pregunta —esta funcion no recorta y `mixHex` si— que este test no hace.
    let combinaciones = 0;
    for (const h of valores.h) {
      for (const s of valores.s) {
        for (const l of valores.l) {
          combinaciones += 1;
          expect(hslToHex(h, s, l), `hslToHex(${h}, ${s}, ${l})`).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
    // El 64 va afirmado para que nadie pueda dejar la lista con dos entradas y este
    // test siga en verde sin comprobar nada.
    expect(combinaciones).toBe(64);
  });

  it('una luminosidad que no es un numero sale en negro, no en "#NANNANNAN"', () => {
    // El fallo, medido antes del arreglo: `m = l - c / 2` salia `NaN`, la suma salia
    // `NaN`, `Math.round(NaN)` es `NaN`, y `NaN.toString(16)` es la cadena `"NaN"`,
    // que `padStart(2, "0")` no puede acortar. El guard estaba en el canal y no en
    // la suma, que es donde `m` entra: vigilaba el operando que no podia hacer dano.
    // Ahora una `l` que no sea finita vale `0`, y sale el mismo negro que ya devolvia
    // `hslToHex(h, s, 0)`, que es un extremo con test desde antes.
    for (const l of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(hslToHex(0, 1, l), `hslToHex(0, 1, ${l})`).toBe('#000000');
      expect(hslToHex(210, 0.5, l), `hslToHex(210, 0.5, ${l})`).toBe('#000000');
      expect(hslToHex(0, 1, l)).toBe(hslToHex(0, 1, 0));
    }
  });

  it('un tono que no es un numero es el tono 0, y una saturacion que no es un numero es el gris de esa luz', () => {
    // El tono cae en `0` porque es lo que `rgbToHsl` le da a un gris, cuyo propio
    // comentario dice que 0 vale tanto como cualquier otro. **Y ojo con el color que
    // sale, porque parece un fallo y no lo es**: `hslToHex(NaN, 1, 0.5)` da
    // `#FF0000`, y `#FF0000` es justamente `hslToHex(0, 1, 0.5)`. Un tono `NaN`
    // caia en el ultimo brazo de la cadena de `hp` —`[c, 0, x]`, con la `x` en
    // `NaN`— y el guard viejo ponia ese `NaN` en cero, que es el mismo numero que da
    // el brazo del tono 0. No es un rojo que se cuele por un canal sin limpiar: es el
    // color del tono 0, y ahora sale de un `0` escrito y no de un `NaN` tapado. Por
    // eso lo que se afirma es la igualdad con el tono 0, y no `not.toBe("#FF0000")`.
    for (const [s, l] of [[1, 0.5], [0.5, 0.25], [0, 0.75], [0.8, 0.9]] as const) {
      for (const h of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(hslToHex(h, s, l), `tono ${h} con s ${s} y l ${l}`).toBe(hslToHex(0, s, l));
      }
    }

    // La saturacion cae en `0`, que es un gris: con `c = 0` los tres canales valen
    // `m = l`, o sea el mismo gris tres veces, `#808080` con `l` de 0.5. **Y no negro**:
    // el negro es lo que sale cuando lo que no es un numero es la luminosidad, y por
    // eso los dos casos no pueden ser el mismo.
    expect(hslToHex(0, Number.NaN, 0.5)).toBe('#808080');
    expect(hslToHex(0, Number.NaN, 0.5)).toBe(hslToHex(0, 0, 0.5));
    expect(hslToHex(210, Number.NEGATIVE_INFINITY, 1)).toBe('#FFFFFF');
    expect(hslToHex(0, Number.NaN, 0)).toBe('#000000');
  });

  it('y un hex de tres cifras sigue siendo un hex de tres', () => {
    expect(hslToHex(0, 0, 1)).toBe('#FFFFFF');
    expect(rgbToHsl('#fff')).toEqual({ h: 0, s: 0, l: 1 });
  });

  it('y el de la basura es el color por defecto, no uno cualquiera', () => {
    // Sabido cual es, para que un color equivocado se vea en la prueba y no en la
    // pantalla de alguien.
    expect(rgbToHsl('sky').l).toBeCloseTo(
      rgbToHsl('#334155').l,
      5,
    );
  });
});

describe('el rectangulo que toca el dedo', () => {
  it('arriba a la izquierda es el tono puro, abajo a la derecha es negro', () => {
    expect(puntoAHsv(0, 0, 200, 200, 210)).toEqual({ h: 210, s: 0, v: 1 });
    expect(puntoAHsv(200, 200, 200, 200, 210)).toEqual({ h: 210, s: 1, v: 0 });
  });

  it('arriba a la derecha es el tono a tope', () => {
    expect(puntoAHsv(200, 0, 200, 200, 210)).toEqual({ h: 210, s: 1, v: 1 });
  });

  it('el tono no se mueve al buscar el color', () => {
    // Es lo unico que el cuadrado no puede cambiar: la tira lo pone.
    for (const [x, y] of [[0, 0], [100, 50], [200, 200], [13, 187]] as const) {
      expect(puntoAHsv(x, y, 200, 200, 33).h).toBe(33);
    }
  });

  it('un dedo que se sale se queda en el borde, no da la vuelta', () => {
    expect(puntoAHsv(-40, 999, 200, 200, 10).s).toBe(0);
    expect(puntoAHsv(-40, 999, 200, 200, 10).v).toBe(0);
    expect(puntoAHsv(999, -40, 200, 200, 10).s).toBe(1);
    expect(puntoAHsv(999, -40, 200, 200, 10).v).toBe(1);
  });

  it('un cuadro de tamano cero no divide por cero', () => {
    // Pasa en el primer render, antes de que onLayout haya dicho nada. Un NaN en
    // el estado se propaga al color y se pinta un espacio de gris sin que nada
    // falle de forma visible.
    const hsv = puntoAHsv(10, 10, 0, 0, 90);
    expect(Number.isFinite(hsv.s)).toBe(true);
    expect(Number.isFinite(hsv.v)).toBe(true);
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBe(0);
  });
});

describe('un cuadrado que no es cuadrado', () => {
  it('el marcador cae donde esta el dedo', () => {
    // El box real se mide con onLayout, y si un dia se estira la misma cuenta
    // tiene que seguir siendo la del ancho y la del alto de cada uno.
    expect(puntoAHsv(75, 100, 300, 100, 0).s).toBeCloseTo(0.25);
    expect(puntoAHsv(75, 100, 300, 100, 0).v).toBeCloseTo(0);
    expect(puntoAHsv(75, 25, 300, 100, 0).v).toBeCloseTo(0.75);
  });
});
