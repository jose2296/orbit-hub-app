import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ICON_SCALE, TYPE_SCALE } from '../src/theme/tokens';

/**
 * La escala de tipos.
 *
 * La petición fue "hacer los textos en general más grandes, en el drawer está todo
 * muy pequeño y en el header también". Y al ir a mirar la tabla antes de tocarla
 * apareció el problema de verdad: **no está ordenada**.
 *
 * Medida, tal y como estaba:
 *
 * ```
 * display    32
 * title      24
 * heading    18
 * body       16
 * bodyLarge  18   <-- sube
 * bodyStrong 16
 * callout    14
 * caption    12
 * label      11
 * ```
 *
 * Nueve nombres para siete tamaños distintos, y en el orden en que están escritos
 * el tamaño baja, baja, baja, **sube** y vuelve a bajar. Una tabla así no puede
 * responder a "más grande": subir un nombre sube el que está debajo y baja el que
 * está encima, y no hay forma de saber cuál de los dos era el que había que tocar.
 *
 * Y la razón de que en el drawer se vea todo pequeño está en el recuento de usos:
 * `caption` —doce puntos— aparece **174 veces**, `callout` —catorce— 46 veces, y el
 * nombre de una carpeta se dibujaba en `callout` mientras "Inicio", en el mismo
 * panel, se dibujaba en `body` a dieciséis. Un destino de navegación por debajo del
 * menú que lo contiene.
 *
 * Estas pruebas comprueban la regla, no los números: los números son una decisión y
 * una decisión se cambia, pero la regla es lo que evita que la tabla vuelva a ser
 * esto dentro de seis meses.
 */

/**
 * Los tamaños en el orden en que se declaran, que es el orden en que deben bajar.
 *
 * Tipado a mano porque `Object.entries` sobre un `as const` devuelve una unión de
 * tuplas y TypeScript no la sabe desplegar en un bucle. El nombre va annotated:
 * `as TextVariant[]` no es lo mismo que lo que sale de `Object.keys`, y el
 * comentario de por que no se puede usar el atajo está en la prueba de abajo.
 */
const EN_DECLARACION = Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[];

describe('la escala esta ordenada', () => {
  it('baja en el orden en que esta escrita', () => {
    // El fallo que la hacia inarreglable: `bodyLarge` (18) detr_as de `body` (16).
    // Con esto, un nombre no puede meterse entre dos que no le dejan sitio.
    const subida: string[] = [];

    for (const [i, nombre] of EN_DECLARACION.entries()) {
      const anterior = i > 0 ? EN_DECLARACION[i - 1] : undefined;
      if (!anterior) continue;

      if (TYPE_SCALE[nombre].fontSize > TYPE_SCALE[anterior].fontSize) {
        subida.push(`${nombre} (${TYPE_SCALE[nombre].fontSize}) > ${anterior} (${TYPE_SCALE[anterior].fontSize})`);
      }
    }

    expect(subida, 'un tamaño mayor debajo de uno menor rompe la jerarquía').toEqual([]);
  });

  it('cada tamaño es un tamaño, y no dos nombres para el mismo', () => {
    const porTamano = new Map<number, string[]>();

    for (const nombre of EN_DECLARACION) {
      const { fontSize } = TYPE_SCALE[nombre];
      porTamano.set(fontSize, [...(porTamano.get(fontSize) ?? []), nombre]);
    }

    const repetidos = [...porTamano.entries()]
      .filter(([, nombres]) => nombres.length > 1)
      // La unica repeticion admitida: un nombre y su version en negrita. Se
      // comprueba abajo, con su regla, y no aqui.
      .filter(([, nombres]) => {
        const primero = nombres[0]?.replace('Strong', '') ?? '';

        return !nombres.every((n) => n.replace('Strong', '') === primero);
      })
      .map(([px, nombres]) => `${px}: ${nombres.join(', ')}`);

    expect(repetidos, 'dos nombres al mismo tamano sin ser el mismo texto en negrita').toEqual([]);
  });

  it('la negrita es una variante del mismo tamaño, no un tamaño nuevo', () => {
    // `body` y `bodyStrong` tienen que compartir tamaño **y altura**. Antes medían
    // los dos a 16 y uno a 22 y el otro a 23: el mismo tamaño a dos alturas, que es
    // la forma de que dos renglones que deberían alinearse no se alineen, y de que
    // "fuerte" acabe significando "otro" en vez de "más".
    expect(TYPE_SCALE.bodyStrong.fontSize).toBe(TYPE_SCALE.body.fontSize);
    expect(TYPE_SCALE.bodyStrong.lineHeight).toBe(TYPE_SCALE.body.lineHeight);
    expect(TYPE_SCALE.bodyStrong.fontWeight).not.toBe(TYPE_SCALE.body.fontWeight);
  });

  it('la altura de linea siempre es mayor que el tamano, con margen para el acento', () => {
    // La tilde, la e con raya y la cedilla no caben en una caja justa: se cortan.
    // Ninguna variante puede tener `lineHeight <= fontSize`.
    const justa = EN_DECLARACION
      .filter((nombre) => TYPE_SCALE[nombre].lineHeight <= TYPE_SCALE[nombre].fontSize)
      .map((nombre) => `${nombre}: ${TYPE_SCALE[nombre].fontSize}/${TYPE_SCALE[nombre].lineHeight}`);

    expect(justa, 'una linea de altura igual al tamano recorta los acentos').toEqual([]);
  });

  /*
   * Lo que **no** es una regla: "el interlineado no se aprieta al bajar el tamaño".
   *
   * Esta prueba existió y se quitó, y conviene decir por qué en lugar de dejarla
   * pasar en silencio. Exigía que la razón `lineHeight / fontSize` no creciera al
   * bajar el tamaño, y en una escala tipográfica eso es al revés de lo correcto:
   *
   * ```
   * display  34/40 = 1.18    <- titular, apretado a proposito
   * title    26/32 = 1.23
   * heading  20/26 = 1.30
   * body     17/24 = 1.41    <- texto, suelto a proposito
   * ```
   *
   * Un titular va apretado porque va en pocas líneas y no necesita aire entre ellas;
   * un párrafo va suelto porque el aire es lo que deja leer la línea siguiente sin
   * buscarla. La razón tiene que **crecer** al bajar hacia el cuerpo, y una prueba
   * que la prohibiera cerraría la puerta a la escala correcta.
   *
   * Lo que sí era un defecto —`bodyStrong` a 16/22 con `body` a 16/23, el mismo
   * tamaño a dos alturas distintas— lo cubre la prueba de arriba, que sí es una
   * regla: mismo tamaño, mismo interlineado.
   */
});

describe('el icono va con su etiqueta y no por delante', () => {
  it('el icono es mas grande que el texto que etiqueta', () => {
    /*
     * El icono lidera a su etiqueta. Al mismo tamaño, la fila se lee como dos cosas
     * con el mismo peso en vez de un nombre con un dibujo delante, y no es una
     * cuestión de gusto: es lo que pasó aquí. Los iconos del drawer eran
     * `size={18}` escritos a mano en 31 sitios y la etiqueta estaba a 16; al subir
     * la etiqueta a 17, el icono se quedó en 18 y la fila pasó de tener dos puntos
     * de ventaja a tener uno — es decir, dejó de ser un icono.
     */
    const masGrandes = EN_DECLARACION.filter(
      (nombre) => ICON_SCALE[nombre] <= TYPE_SCALE[nombre].fontSize,
    );

    expect(masGrandes, 'un icono del tamaño de su etiqueta no es un icono').toEqual([]);
  });

  it('y el tamaño sale del texto, no de otra tabla', () => {
    // Se puede comprobar mirando el módulo, y merece la pena: la razón por la que
    // hay una tabla y no un `1.15` repetido en 31 ficheros es que los 31 se
    // escribieron a mano una vez.
    const derivado = Object.fromEntries(
      EN_DECLARACION.map((nombre) => [nombre, Math.round(TYPE_SCALE[nombre].fontSize * 1.15)]),
    );

    expect(ICON_SCALE).toEqual(derivado);
  });
});

describe('los tamaños no estan escritos a mano en las pantallas', () => {
  it('ningún icono del drawer tiene un tamaño suelto', () => {
    /*
     * Treinta y un `size={18}` repartidos por la app. Este solo mira el drawer, que
     * es el del issue.
     *
     * La expresión busca `<Ionicons` y no cualquier `size={n}` a propósito: la
     * primera versión de esta prueba contaba todos los `size` del fichero y el
     * primer número que salió fue un `14` de un `SpaceDot`, que es un punto de
     * color y no un icono. Falló con un `14` de más, y la conclusión era
     * equivocada: un sitio de color no lleva `iconSize`.
     *
     * Lo que queda son los iconos que **no etiquetan texto** —el de un botón
     * grande, el de una fila entera— y esos tienen su propio tamaño a propósito.
     * Se cuentan uno a uno para que un número nuevo salga en el fallo con su sitio
     * en vez de pasar inadvertido.
     */
    const drawer = readFileSync(join(import.meta.dirname, '..', 'src/components/layout/drawer.tsx'), 'utf8');
    const sueltos = [...drawer.matchAll(/<Ionicons[\s\S]{0,140}?size=\{(\d+)\}/g)].map((m) => m[1]);

    expect(sueltos.sort()).toEqual(['13', '16', '22']);
  });
});

describe('el cuerpo no es el mas pequeno', () => {
  it('los dos sitios de los que se queja el issue ya no usan el tamano pequeño', () => {
    /*
      La queja nombra el drawer y la cabecera, y estos son los dos ficheros. La
      compruebaicon lee el codigo y no el theme, porque la pregunta no es "de que
      color es" sino "que variante elige esta pantalla".
    */
    const drawer = readFileSync(join(import.meta.dirname, '..', 'src/components/layout/drawer.tsx'), 'utf8');
    const cabecera = readFileSync(join(import.meta.dirname, '..', 'src/components/ui/app-header.tsx'), 'utf8');

    // El nombre de una carpeta: era `callout` (14), por debajo de "Inicio" (16).
    expect(drawer).toMatch(/variant="body"[^>]*>\s*\{folder\.emoji/);
    expect(drawer).toMatch(/variant="body"[^>]*>\s*\{list\.title/);

    // El titulo de la pantalla: `heading`, que con la tabla nueva son veinte. Se
    // midio `title` (veintiseis) y se rechazo — no por gusto, por la cuenta que
    // esta en el comentario del token.
    expect(cabecera).toMatch(/variant="heading"/);
  });
});