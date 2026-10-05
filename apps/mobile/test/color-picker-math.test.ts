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

/**
 * Las dos conversiones a hex, como una regla sola.
 *
 * **Una propiedad y dos funciones, y no dos tablas.** La regla es "**para cualquier
 * entrada sale un `#RRGGBB`**", y es la misma para `hslToHex` y para `hsvToHex`:
 * mismos tres ejes, mismos cinco valores por eje, y la misma razon por la que el
 * color que sale da igual —solo importa la forma de la cadena. Dos tablas
 * afirmarian esa regla dos veces y dejarian sitio para que **una de las dos se quede
 * sin comprobar cuando la regla cambie** —que es exactamente lo que paso con
 * `hsvToHex`, que durante dos commits estuvo fuera de la tabla de 125 combinaciones y
 * por eso salia con `#NANNANNAN` mientras la otra ya no lo hacia—. Ademas el cubo se
 * lee de un vistazo: el mismo `125` para las dos, y si las dos funciones se
 * parametrizan sobre la misma tabla una no puede tener mas eje que la otra sin que se
 * note en el recuento.
 *
 * El tercer eje se llama distinto en cada una —`l` y `v`— porque el tipo lo llama
 * distinto, asi que la tabla lleva el nombre y no un `tercero` suelto: el nombre va
 * en el mensaje del fallo, y sin el un `l` que no es un numero y un `v` que no lo es
 * son la misma linea verde sin decir de que eje se quejaba el fallo.
 */
type Conversion = {
  readonly nombre: 'hslToHex' | 'hsvToHex';
  /** El tercer eje se llama distinto en cada una: `l` en hsl, `v` en hsv. */
  readonly tercerEje: 'l' | 'v';
  /**
   * El color del tono 0 con `s` de 1, que es el color al que un tono que no es un
   * numero tiene que ser **igual**. Va escrito por conversion porque **no es el
   * mismo en las dos**: `#FF0000` en hsl y `#800000` en hsv, y por eso no puede ser
   * una constante del test sin que una de las dos deje de probarse.
   */
  readonly tonoCero: string;
  /**
   * Un caso de recorte: los tres numeros, la cadena que salia **antes** y la que sale
   * ahora. Las dos van en la tabla y no en un comentario porque un comentario se
   * queda viejo sin que nadie lo note: la de ahora se afirma como salida de la
   * funcion, y la de antes se afirma **que no era un color**, que es la premisa
   * entera de por que existe el `it` que la recorre.
   */
  readonly recorte: readonly {
    readonly h: number;
    readonly s: number;
    readonly tercero: number;
    readonly antes: string;
    readonly ahora: string;
  }[];
  readonly ejes: { h: number[]; s: number[]; tercero: number[] };
  /** Aplica la conversion con los tres numeros del cubo, en el orden que ella pide. */
  readonly llama: (h: number, s: number, tercero: number) => string;
};

const CONVERSIONES: readonly Conversion[] = [
  {
    nombre: 'hslToHex',
    tercerEje: 'l',
    tonoCero: '#FF0000',
    recorte: [
      { h: 0, s: 5, tercero: 0.5, antes: '#2FD-1FE-1FE', ahora: '#FF0000' },
      { h: 0, s: 1, tercero: 2, antes: '#FF2FD2FD', ahora: '#FFFFFF' },
      { h: 0, s: 1, tercero: -1, antes: '#-1FE0000', ahora: '#000000' },
    ],
    ejes: {
      h: [210, 570, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      s: [0.5, 5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      tercero: [0.5, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    },
    llama: (h, s, l) => hslToHex(h, s, l),
  },
  {
    nombre: 'hsvToHex',
    tercerEje: 'v',
    tonoCero: '#800000',
    recorte: [
      { h: 0, s: 5, tercero: 0.5, antes: '#80-1FE-1FE', ahora: '#800000' },
      { h: 0, s: 1, tercero: 2, antes: '#1FE0000', ahora: '#FF0000' },
      { h: 0, s: 1, tercero: -1, antes: '#-FF0000', ahora: '#000000' },
    ],
    ejes: {
      h: [210, 570, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      s: [0.5, 5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      tercero: [0.5, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    },
    llama: (h, s, v) => hsvToHex({ h, s, v }),
  },
];

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
    // casos: por cada conversion son las 125 combinaciones de cinco valores en cada
    // uno de los tres ejes a la vez —250 en total—, y lo unico que se mira de cada
    // una es que la salida tenga la forma de un `#RRGGBB`, que son seis digitos
    // hexadecimales y nada mas. Que color sale en cada una da igual, y por eso no
    // se afirma: `#NANNANNAN` son diez caracteres —nueve cifras, ninguna
    // hexadecimal— y `#INFINITYINFINITYINFINITY` veinticinco, asi que ningun parser
    // de CSS los puede leer y el elemento se queda con lo que ya habia pintado.
    //
    // **Cinco por eje y no cuatro, y por que una sola tabla y no dos.** Los cinco son
    // las cinco maneras de que un numero no sea un numero usable: uno dentro de
    // rango, uno **fuera** —`s` de 5 y `l` o `v` de 2, que son finitos y no tienen
    // nada roto— y los tres que no son finitos. Fuera de rango estaba **excluido a
    // proposito** con un comentario que decia que era otra pregunta, y era la misma:
    // con el recorte puesto solo en `hslToHex`, `hslToHex(0, 5, 0.5)` daba
    // `#2FD-1FE-1FE` y `hsvToHex({ h: 0, s: 5, v: 0.5 })` daba `#80-1FE-1FE`, dos
    // cadenas que ningun parser de CSS lee. **Dos tablas —"lo que no es un numero" y
    // "lo que se sale de rango"— ainaban dos veces la misma pregunta** y dejaban
    // sitio para que la segunda se quedara sin comprobar cuando la regla cambie; una
    // sola propiedad que dice "**para cualquier entrada** sale un `#RRGGBB`" no tiene
    // ese borde, porque no hay entradas que queden fuera. `h` tambien lleva su valor
    // fuera de rango y **no lo necesita** —el modulo de 360 ya lo hace entrar—, y
    // esta ahi para que el cubo sea de cinco por eje y el 125 se lea de un vistazo.
    for (const conversion of CONVERSIONES) {
      let combinaciones = 0;
      for (const h of conversion.ejes.h) {
        for (const s of conversion.ejes.s) {
          for (const tercero of conversion.ejes.tercero) {
            combinaciones += 1;
            const etiqueta = `${conversion.nombre}(${h}, ${s}, ${tercero})`;
            expect(conversion.llama(h, s, tercero), etiqueta).toMatch(/^#[0-9A-F]{6}$/);
          }
        }
      }
      // El 125 va afirmado **por conversion** para que nadie pueda dejar la lista con
      // dos entradas y este test siga en verde sin comprobar nada, y para que anadir
      // una conversion mas que se quede sin ejes sea un fallo y no un silencio.
      expect(combinaciones, conversion.nombre).toBe(125);
    }
  });

  it('y un numero fuera de rango sale recortado, no desplazado', () => {
    // **La forma anterior no alcanza para esto, y por eso es un `it` aparte.** Que
    // la salida tenga seis caracteres dice que el recorte esta puesto; lo que de
    // verdad importa para nadie es que **el color de quien esta dentro de rango no se
    // mueva**, y eso es una identidad: un `s` de 5 tiene que dar **exactamente** lo
    // mismo que un `s` de 1. Recortar al reves —quedarse con el ultimo color
    // valido en vez de con el extremo— tambien daria seis digitos, asi que la
    // identidad se afirma y la forma no.
    //
    // **Cada recorte va escrito al lado y no hay un `clamp01` en el test**: un
    // recorte en la prueba seria la misma regla por segunda vez, que es
    // precisamente lo que este cambio quita del codigo.
    //
    // **La misma identidad en las dos conversiones**, y por que estan en un solo `it`
    // y no en dos: el segundo eje se llama `s` en las dos, y el recorte de `s` es
    // literalmente el mismo codigo en las dos —`clamp01`, que vive en `hsl.ts` y que
    // `mixHex` ya usaba antes que ninguna de las dos—. El tercer eje se llama `l` en
    // una y `v` en la otra y tambien se recorta con ese mismo `clamp01`, asi que la
    // fila se lee una vez y corre para las dos.
    const recortes: readonly (readonly [number, number])[] = [
      [5, 1],
      [-1, 0],
      [1e9, 1],
      [1.0000001, 1],
      [-0.0000001, 0],
    ];
    // Los tres casos de recorte, con la cadena que salia antes y la que sale ahora. Se
    // affirme la de ahora porque lo que se prueba es el recorte, y la de antes se
    // affirme **que no era un color**: sin esa fila, "arreglado" podria significar
    // "cambiado", que es justo lo que un recorte al reves haria.
    //
    // **Dos de los tres pares salen distintos, y por eso estan por conversion y no como
    // tres literales sueltos.** Solo el tercero coincide —un valor por debajo de 0 es
    // negro en los dos espacios—. Los otros dos se separan por una razon que no es un
    // fallo: en hsl `c = (1 - |2l - 1|) * s` **no** lleva la luminosidad dentro, asi
    // que `l` de 1 con `s` de 1 es blanco; en hsv `c = v * s` **si** la lleva, y `v`
    // de 1 con `s` de 1 es el tono a tope, que en el tono 0 es `#FF0000` y no blanco
    // —el blanco en hsv necesita `s` de 0—. Igual con el `s` de 5: en hsl el canal
    // llega a 1 entero y en hsv llega a `v`. Afirmar un hex fijo para las dos habria
    // obligatorio a comprobar de que conversion era el fallo cada vez que saliera uno.
    for (const conversion of CONVERSIONES) {
      const { nombre, tercerEje, recorte, llama } = conversion;
      for (const [s, recortado] of recortes) {
        expect(llama(210, s, 0.5), `${nombre} s ${s}`).toBe(llama(210, recortado, 0.5));
      }
      for (const [tercero, recortado] of recortes) {
        expect(llama(210, 0.5, tercero), `${nombre} ${tercerEje} ${tercero}`).toBe(
          llama(210, 0.5, recortado),
        );
      }
      for (const caso of recorte) {
        const etiqueta = `${nombre}(${caso.h}, ${caso.s}, ${caso.tercero})`;
        expect(llama(caso.h, caso.s, caso.tercero), `${etiqueta} — salia ${caso.antes}`).toBe(
          caso.ahora,
        );
        expect(caso.antes, `lo que salia antes en ${etiqueta} no era un color`).not.toMatch(
          /^#[0-9A-F]{6}$/,
        );
      }
    }
  });

  it('una luminosidad o un valor que no es un numero sale en negro, no en "#NANNANNAN"', () => {
    // El fallo, medido antes del arreglo en las dos: en hsl `m = l - c / 2` salia
    // `NaN`, en hsv `m = v - c` salia `NaN`, la suma salia `NaN`, `Math.round(NaN)`
    // es `NaN`, y `NaN.toString(16)` es la cadena `"NaN"`, que `padStart(2, "0")` no
    // puede acortar. El guard estaba en el canal y no en la suma, que es donde `m`
    // entra: vigilaba el operando que no podia hacer dano. Ahora un tercer eje que no
    // sea finito vale `0`, y sale el mismo negro que ya devolvian
    // `hslToHex(h, s, 0)` y `hsvToHex({ h, s, v: 0 })`, que son extremos con test
    // desde antes.
    //
    // **Aqui los dos fallos son de verdad la misma cosa y por eso el `it` es uno.**
    // En hsl el negro viene de que `c = (1 - |2 * 0 - 1|) * s0` vale `0` y entonces
    // `m = l0 - c / 2` vale `0` tambien; en hsv el negro viene de que `c = v0 * s0`
    // vale `0` con `v0` en `0` y `m = v0 - c` vale `0` por lo mismo. La mecanica es
    // identica —el tercer eje al `0` deja los tres canales en `0`— y el unico eje que
    // se llamaba distinto se llama distinto solo en el nombre.
    const noFinitos = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const conversion of CONVERSIONES) {
      const { nombre, llama } = conversion;
      for (const tercero of noFinitos) {
        expect(llama(0, 1, tercero), `${nombre}(0, 1, ${tercero})`).toBe('#000000');
        expect(llama(210, 0.5, tercero), `${nombre}(210, 0.5, ${tercero})`).toBe('#000000');
        expect(llama(0, 1, tercero), nombre).toBe(llama(0, 1, 0));
      }
    }
  });

  it('un tono que no es un numero es el tono 0, y una saturacion que no es un numero es el gris de esa luz', () => {
    // El tono cae en `0` porque es lo que `rgbToHsl` y `hexToHsv` le dan a un gris,
    // cuyos propios comentarios dicen que 0 vale tanto como cualquier otro.
    //
    // **Y ojo con el color que sale en hsv, porque parece un fallo y no lo es:**
    // `hsvToHex({ h: NaN, s: 1, v: 0.5 })` da `#800000`, y `#800000` es
    // **exactamente** `hsvToHex({ h: 0, s: 1, v: 0.5 })`. Un tono `NaN` cae en el
    // ultimo brazo de la cadena de `hp` —`[c, 0, x]`, con la `x` en `NaN`— y el
    // guard viejo ponia ese `NaN` en cero, que es el mismo numero que da el brazo del
    // tono 0, porque con `hp` en `NaN` **ninguna** de las cinco comparaciones es
    // cierta y el `else` final es el del tramo 5 a 6, que es donde vive el tono 0.
    // No es un `#800000` que se cuele por un canal sin limpiar: es el color del tono
    // 0, y ahora sale de un `0` escrito y no de un `NaN` tapado. **Por eso lo que se
    // afirma es la igualdad con el tono 0, y no `not.toBe("#800000")`, que seria
    // falso**: el tono 0 **es** `#800000` con `s` de 1, asi que la negacion seria
    // justamente el error. Lo mismo con `#FF0000` en hsl, que es su tono 0 con `s` de
    // 1. Afirmar "no sale este color" seria afirmar que el tono 0 no existe.
    const noFinitos = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const parejas: readonly (readonly [number, number])[] = [
      [1, 0.5],
      [0.5, 0.25],
      [0, 0.75],
      [0.8, 0.9],
    ];
    for (const conversion of CONVERSIONES) {
      const { nombre, tonoCero, llama } = conversion;
      for (const [s, tercero] of parejas) {
        for (const h of noFinitos) {
          const etiqueta = `${nombre} tono ${h} con s ${s} y tercero ${tercero}`;
          expect(llama(h, s, tercero), etiqueta).toBe(llama(0, s, tercero));
        }
      }
      // El tono 0 de esta conversion, con el hex exacto, y **la misma fila otra vez
      // como igualdad**: un tono que no es un numero no es "cualquier rojo", es el
      // rojo del tono 0 y solo el rojo del tono 0. El hex va en la tabla y no aqui
      // como constante suelta porque **no es el mismo en las dos** —`#FF0000` en hsl
      // y `#800000` en hsv— y por eso `tonoCero` existe en el tipo.
      expect(llama(Number.NaN, 1, 0.5), nombre).toBe(tonoCero);
      expect(llama(Number.NaN, 1, 0.5), nombre).toBe(llama(0, 1, 0.5));

      // La saturacion cae en `0`, que es un gris: con `c = 0` los tres canales valen
      // `m`, o sea el mismo gris tres veces, `#808080` con el tercer eje en 0.5. **Y
      // no negro**: el negro es lo que sale cuando lo que no es un numero es el tercer
      // eje, y por eso los dos casos no pueden ser el mismo.
      expect(llama(0, Number.NaN, 0.5), nombre).toBe('#808080');
      expect(llama(0, Number.NaN, 0.5), nombre).toBe(llama(0, 0, 0.5));
      expect(llama(210, Number.NEGATIVE_INFINITY, 1), nombre).toBe('#FFFFFF');
      expect(llama(0, Number.NaN, 0), nombre).toBe('#000000');
    }
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
