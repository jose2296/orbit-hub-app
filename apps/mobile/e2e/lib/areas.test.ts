import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { corrida, parseAreaFlag, resolveAreas, type Area } from './areas';

function raiz(contenido: Record<string, string[] | { flows: string[]; flowsOrder?: string[] }>): string {
  const base = mkdtempSync(join(tmpdir(), 'areas-'));
  for (const [area, valor] of Object.entries(contenido)) {
    mkdirSync(join(base, area), { recursive: true });
    const { flows, flowsOrder } = Array.isArray(valor) ? { flows: valor, flowsOrder: undefined } : valor;
    for (const flujo of flows) writeFileSync(join(base, area, flujo), 'appId: x\n');
    if (flowsOrder !== undefined) {
      // El bloque tal cual lo escribe el area real, con la clave dentro de
      // `executionOrder` y el resto de claves alrededor: un lector que se basta con
      // la linea no valdria para lo que va a leer.
      writeFileSync(
        join(base, area, 'config.yaml'),
        `# el orden de esta area\nexecutionOrder:\n  flowsOrder:\n${flowsOrder
          .map((f) => `    - ${f}`)
          .join('\n')}\n  continueOnFailure: true\n`,
        'utf8',
      );
    }
  }
  return base;
}

describe('resolveAreas', () => {
  it('devuelve las areas en orden, con sus flujos', () => {
    const areas = resolveAreas(raiz({ '02-auth': ['sign-in.yaml'], '01-onboarding': ['welcome.yaml'] }));
    expect(areas.map((a) => a.name)).toEqual(['01-onboarding', '02-auth']);
    expect(areas[0]!.flows).toEqual(['welcome.yaml']);
  });

  it('con --area devuelve solo esa, y falla si no existe', () => {
    const base = raiz({ '01-onboarding': ['welcome.yaml'] });
    expect(resolveAreas(base, '01-onboarding').map((a) => a.name)).toEqual(['01-onboarding']);
    // Un nombre mal escrito tiene que fallar aqui, no descubrir la carrera en verde
    // sin haber probado nada.
    expect(() => resolveAreas(base, 'onboarding')).toThrow(/01-onboarding/);
  });

  it('una area sin flujos se avisa, pero no se cuela como trabajo hecho', () => {
    const areas = resolveAreas(raiz({ '01-onboarding': [], '02-auth': ['sign-in.yaml'] }));
    expect(areas.find((a) => a.name === '01-onboarding')!.flows).toEqual([]);
  });

  it('el config.yaml de un area no cuenta como flujo suyo', () => {
    // Cada area lleva su `config.yaml` con su `flowsOrder`, y termina en `.yaml`
    // como los flujos. Contarlo haria que el area dijera que tiene cuatro flujos
    // cuando tiene tres, y el informe de la tarea 5 sale de ahi.
    const areas = resolveAreas(
      raiz({ '01-onboarding': ['welcome.yaml', 'privacy.yaml', 'config.yaml'] }),
    );
    expect(areas[0]!.flows).toEqual(['privacy.yaml', 'welcome.yaml']);
  });
});

/**
 * La disciplina de `flowsOrder` convertida en comprobacion.
 *
 * Sin esto era un comentario: nadie obliga a nadie a declarar un flujo nuevo, y
 * Maestro no avisa -measured, se corre igual, en un hueco sin decidir-. Aqui las dos
 * listas tienen que decir lo mismo, que es lo que hace que anadir un flujo y anadirlo
 * a la lista sean el mismo trabajo.
 */
describe('resolveAreas y el orden declarado', () => {
  it('acepta un area cuyo flowsOrder es exactamente sus flujos', () => {
    const base = raiz({
      '01-onboarding': { flows: ['welcome.yaml', 'privacy.yaml'], flowsOrder: ['welcome', 'privacy'] },
    });
    expect(resolveAreas(base).map((a) => a.name)).toEqual(['01-onboarding']);
  });

  it('lanza si un flujo no esta en flowsOrder, y lo nombra', () => {
    // El caso de anadir un flujo. Maestro lo correria igual y el area seguiria en
    // verde, asi que sin esto el fallo es invisible.
    const base = raiz({
      '01-onboarding': { flows: ['welcome.yaml', 'nuevo.yaml'], flowsOrder: ['welcome'] },
    });
    expect(() => resolveAreas(base)).toThrow(/nuevo/);
  });

  it('lanza si flowsOrder nombra un flujo que ya no esta, que es el renombrado', () => {
    // El caso mas probable de todos: renombrar `privacy.yaml` a `privacidad.yaml`
    // deja la lista pidiendo `privacy` -que no existe- y el fichero sin declarar.
    // Las dos mitades en un solo error, que es como lo ve quien renombro.
    const base = raiz({
      '01-onboarding': { flows: ['welcome.yaml', 'privacidad.yaml'], flowsOrder: ['welcome', 'privacy'] },
    });
    expect(() => resolveAreas(base)).toThrow(/privacidad/);
    expect(() => resolveAreas(base)).toThrow(/privacy/);
  });

  it('no exige config.yaml a un area que no lo trae', () => {
    // Un area nueva nace sin orden, y el estado por defecto de Maestro es correrlos
    // como salen. Obligar a que nazca con un config seria otra decision, no esta.
    const base = raiz({ '01-onboarding': ['welcome.yaml'] });
    expect(resolveAreas(base)[0]!.flows).toEqual(['welcome.yaml']);
  });

  it('un config.yaml sin flowsOrder no impone nada', () => {
    const base = mkdtempSync(join(tmpdir(), 'areas-'));
    mkdirSync(join(base, '01-onboarding'), { recursive: true });
    writeFileSync(join(base, '01-onboarding', 'welcome.yaml'), 'appId: x\n');
    writeFileSync(
      join(base, '01-onboarding', 'config.yaml'),
      'executionOrder:\n  continueOnFailure: true\n',
      'utf8',
    );
    expect(resolveAreas(base)[0]!.flows).toEqual(['welcome.yaml']);
  });
});

/**
 * Lo que se corre y lo que el informe cuenta tienen que ser la misma verdad, y por
 * eso salen de la misma funcion.
 */
describe('corrida', () => {
  const area = (flows: string[]): Area => ({ name: '01-onboarding', dir: '/flujos/01-onboarding', flows });

  it('sin --flow corre el area entera y cuenta lo que tiene', () => {
    expect(corrida(area(['a.yaml', 'b.yaml', 'c.yaml']))).toEqual({
      flujo: '/flujos/01-onboarding',
      cuantos: 3,
    });
  });

  it('con --flow corre un solo fichero y cuenta uno, no los del area', () => {
    // **El numero del informe es la cobertura que dice haber medido.** Con
    // `--flow=privacy.yaml` se corre un flujo, y la fila decia `3 flujos` y el
    // motivo `1 de 3`: un `1 de 3` que no se puede leer sin pensar, y que parece
    // que el area entera se probo y dos tercios fellaron.
    expect(corrida(area(['a.yaml', 'b.yaml', 'c.yaml']), 'b.yaml')).toEqual({
      flujo: join('/flujos/01-onboarding', 'b.yaml'),
      cuantos: 1,
    });
  });

  it('un area vacia sin --flow se cuenta como cero', () => {
    expect(corrida(area([])).cuantos).toBe(0);
  });
});

describe('parseAreaFlag', () => {
  it('lee --area', () => {
    expect(parseAreaFlag(['--area', '04-lists'])).toStrictEqual({ only: '04-lists' });
  });

  it('devuelve undefined cuando no hay bandera', () => {
    // `toStrictEqual` y no `toEqual`: `toEqual` no distingue `{}` de
    // `{ only: undefined, flow: undefined }`, asi que la afirmacion pasaria con una
    // `parseAreaFlag` que devolviera las dos claves explicitas y nadie lo sabria.
    expect(parseAreaFlag([])).toStrictEqual({});
  });

  it('lee la forma con igual, que es la que escriben npm y los CLIs', () => {
    // **La forma que faltaba.** Con solo `--area x`, `--area=04-lists` no era ni una
    // bandera ni un valor, no se miraba, y el resultado era `{}`: el runner recorria
    // todas las areas en vez de una y no se quejaba. La carrera entera en verde por
    // una ortografia, que es justo lo que `parseAreaFlag` existe para que no pase.
    expect(parseAreaFlag(['--area=04-lists'])).toStrictEqual({ only: '04-lists' });
    expect(parseAreaFlag(['--area=04-lists', '--flow=item-menu.yaml'])).toStrictEqual({
      only: '04-lists',
      flow: 'item-menu.yaml',
    });
    // Y la misma bandera con las dos formas mezcladas, que es como se escribe cuando
    // se pega la primera de otra pagina y la segunda de la linea de comandos.
    expect(parseAreaFlag(['--area=04-lists', '--flow', 'item-menu.yaml'])).toStrictEqual({
      only: '04-lists',
      flow: 'item-menu.yaml',
    });
  });

  it('la forma con igual llega al area que dice, y no a todas', () => {
    // Lo que importa no es que se lea, es que se llegue. Con dos areas delante, la
    // forma con igual que se ignoraba producia una carrera entera: el recuento de
    // areas del informe habria delatado el error, si alguien lo mirase.
    const base = raiz({ '01-onboarding': ['welcome.yaml'], '04-lists': ['lista.yaml'] });
    const flags = parseAreaFlag(['--area=04-lists']);
    expect(resolveAreas(base, flags.only).map((a) => a.name)).toEqual(['04-lists']);
  });

  it('una bandera que no existe lanza, en vez de recorrer todas las areas', () => {
    // Ignorarla es el fallo anterior escrito de otra forma, y mas facil de cometer:
    // `--areas`, `--are`, `--dry-run`. El runner no dice nada, la carrera se pone
    // entera y no ha corrido lo que se le pidio.
    expect(() => parseAreaFlag(['--areas=04-lists'])).toThrow(/--area/);
    expect(() => parseAreaFlag(['--are', '04-lists'])).toThrow(/--area/);
    expect(() => parseAreaFlag(['--dry-run'])).toThrow(/--area/);
    // Y tampoco se acepta un argumento suelto: el runner no tiene ninguna forma de
    // leerlo, asi que aceptarlo en silencio seria volver a dejar pasar lo que se le
    // pasa sin querer.
    expect(() => parseAreaFlag(['01-onboarding'])).toThrow(/01-onboarding/);
  });

  it('una bandera sin valor lanza, en vez de recorrer todas las areas', () => {
    // Sin esto, `--area` a secas devuelve `{}`, que el runner lee como "sin area":
    // recorre todas en vez de ninguna y no se queja. El guard de Review Focus 5 se
    // queda sin comprobar por un espacio de mas en la linea de comandos.
    expect(() => parseAreaFlag(['--area'])).toThrow(/--area/);
    expect(() => parseAreaFlag(['--flow'])).toThrow(/--flow/);
    // Un "valor" que es otra bandera es el mismo error escrito de otra forma.
    expect(() => parseAreaFlag(['--area', '--flow', 'x.yaml'])).toThrow(/--area/);
    // Y el mismo error con el `=` sin valor detras, que es la forma nueva y no
    // estaba cubierta por el caso de al lado.
    expect(() => parseAreaFlag(['--area='])).toThrow(/--area/);
    expect(() => parseAreaFlag(['--area=', '--flow=x.yaml'])).toThrow(/--area/);
  });
});