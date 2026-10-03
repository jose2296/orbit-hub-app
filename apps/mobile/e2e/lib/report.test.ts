import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fallosDeMaestro, renderReport, saleEnRojo, veredictoArea, writeReport } from './report';

const bien = {
  area: '01-onboarding',
  flows: 3,
  maestroOk: true,
  guard: { ok: true, problems: [] },
  fallidos: [],
};
const mal = {
  area: '04-lists',
  flows: 12,
  maestroOk: false,
  guard: { ok: false, problems: ['el proceso cambio (1 -> 2): relanzo en silencio'] },
  fallidos: [],
};
const vacio = {
  area: '09-system',
  flows: 0,
  maestroOk: true,
  guard: { ok: true, problems: [] },
  fallidos: [],
};
// El area vacia tal como la deja el runner: `forceStop` para la app antes del area
// y sin un flujo no hay nada que la levante, asi que el guardian responde que no hay
// proceso. Es el caso que hacia que la consola dijera `FALLA ... la app se cerro` y
// el informe `NADA ... sin flujos que probar` en la misma carrera.
const vacioSinProceso = {
  ...vacio,
  guard: { ok: false, problems: ['la app se cerro — no hay proceso'] },
};

/**
 * El veredicto de un area, que es lo que decide a la vez la fila del informe y el
 * codigo de salida del runner.
 *
 * Estaba escrito en los dos sitios: la fila lo tenia comprobado y el `exitCode` no,
 * y el `exitCode` era el que mentia -un area sin flujos salia en rojo por el guardian
 * diciendo que la app se habia cerrado cuando no habia llegado a existir-. Con la
 * decision en una sola funcion y el runner llamandola, la fila y el codigo de salida
 * ya no pueden separarse; estos son los casos que los tenian separados.
 */
describe('veredictoArea', () => {
  it('un area sin flujos es NADA, aunque el guardian diga que no hay proceso', () => {
    // El caso que se dio, medido. A un area vacia nada la levanta, asi que el
    // guardian solo puede decir `la app se cerro`, y eso no es un sintoma: es que no
    // habia nada que cerrar. Montar un area nueva no puede poner en rojo la carrera.
    const v = veredictoArea(vacioSinProceso);
    expect(v.estado).toBe('NADA');
    expect(v.motivo).toBe('sin flujos que probar');
    // El motivo entero y entero, y no un `toContain` laxo: decir `la app se cerro` al
    // lado de la fila de un area vacia es justo la mentira que se esta corrigiendo.
    expect(v.motivo).not.toContain('se cerro');
  });

  it('un area con flujos que se queda sin proceso es FALLA, y lo dice', () => {
    // La otra mitad, que no se puede relajar con la anterior: aqui si se ha probado
    // algo, la app estaba en pie al empezar, y ahora no esta. Es un fallo real y se
    // queda rojo.
    const v = veredictoArea({ ...bien, guard: { ok: false, problems: ['la app se cerro — no hay proceso'] } });
    expect(v.estado).toBe('FALLA');
    expect(v.motivo).toContain('se cerro');
  });

  it('un area con flujos en verde pasa, y una que fallo en Maestro no', () => {
    expect(veredictoArea(bien).estado).toBe('PASA');
    expect(veredictoArea(mal).estado).toBe('FALLA');
    // Y el motivo de un fallo de Maestro cuenta los flujos que se han corrido, que
    // con `--flow` es uno y no los que tiene el area.
    expect(
      veredictoArea({ ...mal, flows: 1, guard: bien.guard, fallidos: ['lista: Motivo'] }).motivo,
    ).toBe('1 de 1 flujos fallaron');
  });

  it('la fila y el recuento se pintan con el mismo veredicto que decide el codigo', () => {
    // Las tres mitades -la palabra de la fila, el recuento de sanas y el rojo de la
    // carrera- salen de aqui. Con una condicion escrita en el runner, las tres podian
    // decir cosas distintas en el mismo fichero, y solo se comprobaba una.
    const casos = [
      bien,
      mal,
      vacio,
      vacioSinProceso,
      { ...bien, area: '02-auth', maestroOk: false },
    ] as const;
    const informe = renderReport([...casos]);
    const filas = informe.split('\n').filter((l) => /^(PASA|FALLA|NADA)\s/.test(l));
    expect(filas).toHaveLength(casos.length);
    expect(filas.map((f) => f.trim().split(/\s+/)[0])).toEqual(
      casos.map((c) => veredictoArea(c).estado),
    );
    const sanas = casos.filter((c) => veredictoArea(c).estado === 'PASA').length;
    expect(informe).toContain(`${sanas}/${casos.length} areas sin fallo`);
  });
});

/**
 * La otra mitad del codigo de salida, que estaba en el runner como un `fallos += 1`
 * sin comprobar. Ahora es esta funcion, y por eso hay un sitio donde se puede romper.
 */
describe('saleEnRojo', () => {
  it('solo un FALLA pone la carrera en rojo', () => {
    expect(saleEnRojo([])).toBe(false);
    expect(saleEnRojo([bien])).toBe(false);
    // Un area vacia, con y sin guardian en contra: montar un area nueva sale con
    // codigo 0, que es lo que el README y el informe ya prometian.
    expect(saleEnRojo([vacio])).toBe(false);
    expect(saleEnRojo([vacio, vacioSinProceso])).toBe(false);
    expect(saleEnRojo([bien, vacio, mal])).toBe(true);
  });
});

describe('renderReport', () => {
  it('una linea por area, con su numero de flujos', () => {
    const tabla = renderReport([bien, mal]);
    expect(tabla).toContain('01-onboarding');
    expect(tabla).toContain('04-lists');
    expect(tabla).toMatch(/3\s+flujos/);
  });

  it('el area que falla dice por que, no solo que fallo', () => {
    expect(renderReport([mal])).toContain('relanzo en silencio');
  });

  it('el recuento final cuenta las areas con fallo, no los flujos', () => {
    // Una carrera con 40 flujos y un area rota es un fallo, no "39/40".
    expect(renderReport([bien, mal])).toContain('1/2 areas sin fallo');
  });

  it('una linea por area, y la leyenda de cabecera no cuenta como area', () => {
    // El `/^(PASA|FALLA|NADA)\s/` con la palabra seguida de espacio, y no un
    // `toContain('PASA')`: la leyenda de cabecera nombra las tres palabras, asi
    // que un `toContain` pasaria con la tabla vacia y este recuento contaria
    // tambien la cabecera.
    const tabla = renderReport([bien, mal]);
    expect(tabla.match(/^(PASA|FALLA|NADA)\s/gm)).toHaveLength(2);
  });

  it('un area sin flujos no se lee como trabajo hecho, y no cuenta como sana', () => {
    // Maestro sale con codigo 0 cuando no ha probado nada, asi que un area vacia
    // entra por la via de "todo bien". Aqui estan las dos mitades del mismo
    // agujero: la fila decia `PASA ... ok` -una afirmacion que no se sostiene- y
    // el recuento decia `1/1 areas sin fallo` debajo. Las dos se arreglan a la vez
    // o el fichero se contradice a si mismo.
    const informe = renderReport([vacio]);
    const fila = informe
      .split('\n')
      .find((l) => /^NADA\s/.test(l));
    expect(fila).toBeDefined();
    expect(fila).toMatch(/0\s+flujos/);
    expect(fila).toContain('sin flujos que probar');
    expect(informe).toContain('0/1 areas sin fallo');
  });

  it('sin areas el recuento es 0/0 y no inventa trabajo', () => {
    expect(renderReport([])).toContain('0/0 areas sin fallo');
  });

  it('la cabecera cuenta las areas y las recorridas en plural', () => {
    // La cabecera es la unica logica que queda en `renderReport` fuera de las
    // filas. Sin esto, borrarla entera -o quitarle el plural- no falla nada.
    expect(renderReport([bien])).toContain('1 area recorrida');
    expect(renderReport([bien, mal])).toContain('2 areas recorridas');
  });

  it('la leyenda explica los tres veredictos y donde esta el motivo', () => {
    const leyenda = renderReport([bien]).split('\n')[1]!;
    expect(leyenda).toContain('PASA');
    expect(leyenda).toContain('FALLA');
    expect(leyenda).toContain('NADA');
    // La leyenda manda a leer el motivo a la fila o a las de debajo; si el motivo
    // no esta ahi, la leyenda es una promesa falsa.
    expect(leyenda).toMatch(/motivo va en su fila o en las de debajo/);
  });

  it('un area con un solo flujo dice flujo, y con cero dice flujos', () => {
    const uno = { ...bien, flows: 1 };
    expect(renderReport([uno])).toMatch(/1\s+flujo\s/);
    expect(renderReport([uno])).not.toMatch(/1\s+flujos/);
    expect(renderReport([vacio])).toMatch(/0\s+flujos/);
  });

  it('un nombre de area largo no se parte a media palabra', () => {
    // La fila que nombra el area que fallo es la que menos puede perder un
    // trozo. Con `padEnd(n).slice(0, n)` un nombre de 40 caracteres salia
    // cortado en silencio y el informe nombraba un area que no existe.
    const largo = {
      ...mal,
      area: 'un-area-con-un-nombre-muy-largo-de-verdad',
    };
    const fila = renderReport([largo])
      .split('\n')
      .find((l) => /^FALLA\s/.test(l));
    expect(fila).toContain('un-area-con-un-nombre-muy-largo-de-verdad');
  });
});

describe('renderReport y los flujos que fallaron', () => {
  const conFallidos = (fallidos: string[]) => ({
    ...mal,
    area: '01-onboarding',
    flows: 3,
    maestroOk: false,
    guard: { ok: true, problems: [] },
    fallidos,
  });

  it('deja la fila en una linea y pone los flujos debajo', () => {
    const informe = renderReport([
      conFallidos([
        'privacy: Assertion is false: id: screen-welcome is visible',
        'terms: Assertion is false: id: screen-welcome is visible',
      ]),
    ]);
    const filas = informe.split('\n');
    expect(filas.filter((l) => /^(PASA|FALLA|NADA)\s/.test(l))).toHaveLength(1);
    expect(informe).toContain('2 de 3 flujos fallaron');
    expect(informe).toContain('privacy: Assertion is false: id: screen-welcome is visible');
    expect(informe).toContain('terms: Assertion is false: id: screen-welcome is visible');
  });

  it('el motivo de un flujo no se cuela en la fila', () => {
    // Una fila con el motivo dentro parte la tabla en dos, y el motivo entero
    // puede medir una linea larga: la tabla se lee de un vistazo y el detalle se
    // lee cuando se busca.
    const fila = renderReport([conFallidos(['privacy: Motivo bastante largo de verdad'])])
      .split('\n')
      .find((l) => /^FALLA\s/.test(l))!;
    expect(fila).not.toContain('Motivo bastante largo');
    expect(fila).toContain('1 de 3 flujos fallaron');
  });

  it('si no se puede leer por que fallo, lo dice en vez de inventar un motivo', () => {
    // El parser roto tiene que ser visible en el informe. Un `Maestro fallo` a
    // secas seria el parser roto disfrazado de motivo.
    const informe = renderReport([conFallidos([])]);
    expect(informe).toContain('no se ha podido leer por que');
    expect(informe).not.toMatch(/\d+ de \d+ flujos fallaron/);
  });

  it('el guardian manda sobre el motivo de la fila, no sobre los flujos', () => {
    const conCrash = {
      ...conFallidos(['privacy: Motivo de Maestro']),
      guard: { ok: false, problems: ['la app se cerro - no hay proceso'] },
    };
    const informe = renderReport([conCrash]);
    expect(informe).toContain('la app se cerro - no hay proceso');
    expect(informe).not.toMatch(/\d+ de \d+ flujos fallaron/);
  });
});

describe('fallosDeMaestro', () => {
  it('saca el flujo y su motivo de la linea de fallo de Maestro', () => {
    const salida = [
      'Waiting for flows to complete...',
      '[Passed] welcome (55s)',
      '[Failed] privacy (1m 2s) (Assertion is false: id: screen-welcome is visible)',
      '',
      '2/3 Flows Failed',
    ].join('\n');
    expect(fallosDeMaestro(salida)).toEqual([
      'privacy: Assertion is false: id: screen-welcome is visible',
    ]);
  });

  it('saca los dos fallos cuando fallan dos flujos', () => {
    const salida = [
      '[Failed] privacy (1m 2s) (Assertion is false: id: screen-welcome is visible)',
      '[Failed] terms (52s) (Assertion is false: id: screen-welcome is visible)',
    ].join('\n');
    expect(fallosDeMaestro(salida)).toHaveLength(2);
    expect(fallosDeMaestro(salida)[1]).toMatch(/^terms: /);
  });

  it('el motivo con parentesis dentro no se trunca', () => {
    // El parser cogiendo el primer parentesis devuelve
    // `Assertion is false: text is "E2E List (beta)"` y parece un motivo
    // entero. Es peor que no devolver ninguno: es un motivo mentira.
    const salida = '[Failed] lista (9s) (Assertion is false: text is "E2E List (beta)" is visible)';
    expect(fallosDeMaestro(salida)).toEqual([
      'lista: Assertion is false: text is "E2E List (beta)" is visible',
    ]);
  });

  it('no inventa fallos donde no los hay', () => {
    expect(fallosDeMaestro('Waiting for flows to complete...\n[Passed] welcome (55s)\n')).toEqual([]);
    expect(fallosDeMaestro('')).toEqual([]);
  });

  it('una linea que no es de flujo no se lee como fallo', () => {
    // `[Failed]` en medio de una linea es texto, no una linea de fallo de Maestro.
    // Sin ancla al principio, una linea de este tipo entra en el informe con un
    // nombre de flujo que no es un flujo, y el motivo se lo ha inventado el regex.
    expect(fallosDeMaestro('Flow x failed: [Failed] algo')).toEqual([]);
    expect(
      fallosDeMaestro('  ver arriba: [Failed] privacy (1m 2s) (Assertion is false: id: x is visible)'),
    ).toEqual([]);
  });
});

/**
 * El informe tiene que decir que esta linea roja tiene un motivo conocido, o se
 * lee como un arnes roto. Y el motivo se imprime **solo mientras siga siendo
 * verdad**: en cuanto los flujos que nombra pasan, la nota desaparece sola y el
 * fichero vuelve a ser solo un informe.
 */
describe('renderReport y la linea roja conocida', () => {
  const onboarding = (fallidos: string[]) => ({
    area: '01-onboarding',
    flows: 3,
    maestroOk: false,
    guard: { ok: true, problems: [] },
    fallidos,
  });
  const nota = 'conocido y sin arreglar';

  it('con los flujos que nombra fallando de verdad, dice el motivo y que no lo causa el arnes', () => {
    const informe = renderReport([
      onboarding([
        'privacy: Assertion is false: id: screen-welcome is visible',
        'terms: Assertion is false: id: screen-welcome is visible',
      ]),
    ]);
    expect(informe).toContain(nota);
    expect(informe).toContain('privacy');
    expect(informe).toContain('terms');
    expect(informe).toContain('No lo causa el arnes');
  });

  it('con el area en verde, la nota no aparece', () => {
    // El dia que se arregle la tecla de atras, esto es lo que evita que el
    // informe siga detectando un fallo que ya no existe.
    expect(renderReport([bien])).not.toContain(nota);
  });

  it('la nota no aparece si el area roja es otra', () => {
    // Con los mismos nombres de flujo a proposito: un area de la fase 2 puede
    // tener sus propios `privacy.yaml` y `terms.yaml`, y la nota **nombra**
    // `01-onboarding`. Sin mirar el area, un area de listas en rojo se
    // aparecerian los dos flujos que nombra aunque no sean los suyos.
    const otra = onboarding([
      'privacy: Assertion is false: id: screen-welcome is visible',
      'terms: Assertion is false: id: screen-welcome is visible',
    ]);
    expect(renderReport([{ ...otra, area: '04-lists', flows: 5 }])).not.toContain(nota);
  });

  it('NO aparece si el area roja fallo por otra causa y sus flujos siguen en verde', () => {
    // **El caso que keying por el area no puede coger.** `welcome` ha regresado
    // mientras `privacy` y `terms` pasan. La nota, apoyada en el area, diria que
    // los que fallan son los dos que nombra -y estan en verde-, y prometeria que
    // van a pasar solos cuando se arregle la tecla de atras. Aqui no se arregla
    // ninguna tecla de atras: el fallo es otro y todavia nadie lo sabe.
    const informe = renderReport([
      onboarding(['welcome: Assertion is false: id: screen-welcome is visible']),
    ]);
    expect(informe).not.toContain(nota);
    // Y el motivo real sigue estando, que es lo que hace que el informe siga
    // siendo suficiente sin la nota.
    expect(informe).toContain('welcome: Assertion is false: id: screen-welcome is visible');
  });

  it('NO aparece si solo fallo uno de los dos flujos que nombra', () => {
    // La nota afirma que los dos caen por la tecla de atras. Con uno solo la
    // afirmacion es media verdad, y media verdad en un informe es mentira.
    const informe = renderReport([
      onboarding(['privacy: Assertion is false: id: screen-welcome is visible']),
    ]);
    expect(informe).not.toContain(nota);
  });

  it('NO aparece con un area en verde aunque la lista de flujos diga otra cosa', () => {
    // Registro contradictorio: Maestro dijo que el area esta bien y aun asi
    // arrives flujos caidos. No puede pasar -los dos salen del mismo `code`-,
    // pero el guard tiene las tres condiciones y esta es la tercera: sin ella,
    // quitar `!r.maestroOk` del keying no romperia nada y seria codigo muerto
    // creyendo que protege.
    const verde = {
      ...onboarding([
        'privacy: Assertion is false: id: screen-welcome is visible',
        'terms: Assertion is false: id: screen-welcome is visible',
      ]),
      maestroOk: true,
    };
    expect(renderReport([verde])).not.toContain(nota);
  });

  it('NO aparece si el guardian tiene algo que decir', () => {
    // Con el guardian en rojo el motivo es el guardian, y la nota se apropiaria
    // de un fallo que no es suyo.
    const conCrash = {
      ...onboarding([
        'privacy: Assertion is false: id: screen-welcome is visible',
        'terms: Assertion is false: id: screen-welcome is visible',
      ]),
      guard: { ok: false, problems: ['la app se cerro - no hay proceso'] },
    };
    expect(renderReport([conCrash])).not.toContain(nota);
  });
});

describe('writeReport', () => {
  it('escribe en disco lo mismo que renderReport pinta, con un salto final', () => {
    // El salto del final es lo que hace que `tail` y los diffs de dos carreras
    // seguidas no se peguen. Y se compara con `renderReport` y no con un texto
    // escrito a mano: si el informe cambia, el artefacto tiene que cambiar con el,
    // y una igualdad escrita aqui solo comprobaria que las dos copias coinciden
    // entre si.
    const archivo = join(mkdtempSync(join(tmpdir(), 'informe-')), 'informe.txt');
    const resultados = [bien, mal];
    writeReport(archivo, resultados);
    expect(readFileSync(archivo, 'utf8')).toBe(`${renderReport(resultados)}\n`);
  });
});