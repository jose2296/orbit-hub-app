import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderReport, writeReport } from './report';

const bien = { area: '01-onboarding', flows: 3, maestroOk: true, guard: { ok: true, problems: [] } };
const mal = {
  area: '04-lists',
  flows: 12,
  maestroOk: false,
  guard: { ok: false, problems: ['el proceso cambio (1 -> 2): relanzo en silencio'] },
};

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
    // El `/^(PASA|FALLA)\s/` con la palabra seguida de espacio, y no un
    // `toContain('PASA')`: la leyenda de cabecera nombra las dos palabras, asi que
    // un `toContain` pasaria con la tabla vacia y este recuento contaria tambien
    // la cabecera.
    const tabla = renderReport([bien, mal]);
    expect(tabla.match(/^(PASA|FALLA)\s/gm)).toHaveLength(2);
  });

  it('un area sin flujos no se lee como trabajo hecho', () => {
    // Maestro sale con codigo 0 cuando no ha probado nada, asi que un area vacia
    // entra como `PASA` y su unico sintoma es este cero. El runner ya avisa por
    // pantalla; el informe es el que se lee a la semana siguiente, y un `PASA` a
    // secas con `0 flujos` al lado dice lo contrario de lo que paso.
    const vacia = { area: '09-system', flows: 0, maestroOk: true, guard: { ok: true, problems: [] } };
    // `/^PASA\s/` y no `startsWith('PASA')`: la leyenda de cabecera empieza tambien
    // por `PASA`, y un `find` que coge esa linea comprobaria la leyenda.
    const linea = renderReport([vacia])
      .split('\n')
      .find((l) => /^PASA\s/.test(l));
    expect(linea).toBeDefined();
    expect(linea).toMatch(/0\s+flujos/);
    expect(linea).toContain('sin flujos');
  });

  it('sin areas el recuento es 0/0 y no inventa trabajo', () => {
    expect(renderReport([])).toContain('0/0 areas sin fallo');
  });
});

/**
 * El informe tiene que decir que esta linea roja tiene un motivo conocido, o se
 * lee como un arnes roto. Y el motivo se imprime **solo mientras siga siendo
 * verdad**: en cuanto el area pasa, la nota desaparece sola y el fichero vuelve a
 * ser solo un informe.
 */
describe('renderReport y la linea roja conocida', () => {
  it('con el area en rojo, dice cuales son los flujos y que no lo causa el arnes', () => {
    const rojo = { area: '01-onboarding', flows: 3, maestroOk: false, guard: { ok: true, problems: [] } };
    const informe = renderReport([rojo]);
    expect(informe).toContain('conocido y sin arreglar');
    expect(informe).toContain('privacy');
    expect(informe).toContain('terms');
    expect(informe).toContain('No lo causa el arnes');
  });

  it('con el area en verde, la nota no aparece', () => {
    // El dia que se arregle la tecla de atras, esto es lo que evita que el
    // informe siga detectando un fallo que ya no existe: por eso la nota mira el
    // resultado del area en vez de llevar un texto fijo.
    expect(renderReport([bien])).not.toContain('conocido y sin arreglar');
  });

  it('la nota no aparece si el area roja es otra', () => {
    expect(renderReport([mal])).not.toContain('conocido y sin arreglar');
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