import { describe, expect, it } from 'vitest';

import {
  EN_LA_RAIZ,
  cambiaDeEspacio,
  eligeCarpeta,
  entraEn,
  subeUnNivel,
  tieneCarpetasAdentro,
} from '@/lib/shares/where-it-goes';
import type { CarpetaDelArbol } from '@/lib/shares/where-it-goes';

/**
 * `Casa > Viajes > 2026 > {Pistas, Christmas}`, and the ids are the point: the rules below
 * are about ids, and a test with made-up `a`, `b`, `c` would pass the same either way.
 */
const CARPETAS: CarpetaDelArbol[] = [
  { id: 'viajes', name: 'Viajes', parentId: null, workspaceId: 'casa' },
  { id: '2026', name: '2026', parentId: 'viajes', workspaceId: 'casa' },
  { id: 'pistas', name: 'Pistas', parentId: '2026', workspaceId: 'casa' },
  { id: 'navidad', name: 'Navidad', parentId: '2026', workspaceId: 'casa' },
  { id: 'trabajo', name: 'Trabajo', parentId: null, workspaceId: 'casa' },
];

const porId = new Map(CARPETAS.map((c) => [c.id, c]));
const padreDe = (id: string): CarpetaDelArbol | null => {
  const parentId = porId.get(id)?.parentId;
  return parentId ? (porId.get(parentId) ?? null) : null;
};
const hijosDe = (workspaceId: string, parentId: string) =>
  CARPETAS.filter((c) => c.workspaceId === workspaceId && c.parentId === parentId);

describe('donde va lo que te comparten: mirar no es escolher', () => {
  /**
   * The bug this file exists for. Looking at a folder and choosing it were one variable,
   * so tapping a folder to see whether it was the right one **put the thing in it** — and
   * there was no way back up, so browsing three deep left you able to see where you were
   * and not change your mind.
   */
  it('mirar dentro de una carpeta no la elige', () => {
    const mirando = entraEn(EN_LA_RAIZ, 'viajes');
    expect(mirando.mirandoEn).toBe('viajes');
    expect(mirando.elige).toBeNull();
  });

  it('elegir una carpeta no mueve la lista, para que puedas mirar y volver', () => {
    // Leido de derecha a izquierda: entro, miro, **elijo**, y el lugar donde estoy
    // mirando no se ha movido. Antes esto no se podia expresar: era un solo estado.
    const recorrido = eligeCarpeta(entraEn(EN_LA_RAIZ, 'viajes'), '2026');
    expect(recorrido.mirandoEn).toBe('viajes');
    expect(recorrido.elige).toBe('2026');
  });

  it('se puede subir y la eleccion se queda', () => {
    // Subir es para mirar, no para deshacer. Si bajar cambiase la eleccion, entonces
    // mirar tres carpetas y volver arriba habria movido la cosa tres veces.
    const abajo = entraEn(entraEn(EN_LA_RAIZ, 'viajes'), '2026');
    const elegido = eligeCarpeta(abajo, 'pistas');
    const arriba = subeUnNivel(elegido, padreDe);

    expect(arriba.mirandoEn).toBe('viajes');
    expect(arriba.elige).toBe('pistas');
  });

  it('se sube hasta la raiz y desde ahi no se sube mas', () => {
    let recorrido = entraEn(entraEn(entraEn(EN_LA_RAIZ, 'viajes'), '2026'), 'pistas');
    recorrido = subeUnNivel(recorrido, padreDe);
    recorrido = subeUnNivel(recorrido, padreDe);
    recorrido = subeUnNivel(recorrido, padreDe);
    recorrido = subeUnNivel(recorrido, padreDe);

    expect(recorrido.mirandoEn).toBeNull();
  });

  it('subir en la raiz no rompe nada, porque no hay mas arriba', () => {
    // `null` es la señal de que no hay fila "subir" que dibujar. Sin este caso, el panel
    // dibujaria un boton que al pulsarlo no hace nada — que es peor que no dibujarlo.
    expect(subeUnNivel(EN_LA_RAIZ, padreDe)).toBe(EN_LA_RAIZ);
  });

  it('cambiar de espacio tira las dos cosas, porque un id de otro espacio no significa nada', () => {
    const elegido = eligeCarpeta(entraEn(EN_LA_RAIZ, 'viajes'), 'pistas');
    const otro = cambiaDeEspacio();

    expect(otro).toEqual({ mirandoEn: null, elige: null });
    // Y no es lo mismo que el estado inicial congelado: son dos cosas iguales de verdad,
    // no la misma referencia, porque React compara por referencia.
    expect(otro).not.toBe(elegido);
  });

  it('cambiar de espacio empieza de cero, y a la raiz se puede volver', () => {
    // Cambiar de espacio y luego volver a mirar la raiz son el mismo gesto, no dos.
    const elegido = elegidoCarpetaEnPistas();
    const desde = cambiaDeEspacio();
    expect(desde).toEqual(EN_LA_RAIZ);
    // Y desde ahi se puede volver a entrar, que es lo que hace alguien que se arrepiente.
    expect(entraEn(desde, 'trabajo').mirandoEn).toBe('trabajo');
    expect(elegido.elige).toBe('pistas');
  });

  it('solo se ofrece entrar en las carpetas que tienen algo dentro', () => {
    // Un boton de "mirar dentro" en una carpeta vacia es un boton que no hace nada, y
    // ensucia la lista de exactamente la forma que hace que una lista con cinco carpetas
    // parezca una con diez.
    expect(tieneCarpetasAdentro(porId.get('2026')!, hijosDe)).toBe(true);
    expect(tieneCarpetasAdentro(porId.get('pistas')!, hijosDe)).toBe(false);
  });

  it('el recorrido entero por el arbol acaba donde se empezo, con la eleccion puesta', () => {
    // El camino completo, que es el que hace alguien buscando donde poner algo: raiz,
    // entrar, entrar, elegir, subir, subir, y confirmar.
    let r = EN_LA_RAIZ;
    r = entraEn(r, 'trabajo');
    r = entraEn(r, 'viajes');
    r = eligeCarpeta(r, '2026');
    r = entraEn(r, 'pistas');
    expect(r).toEqual({ mirandoEn: 'pistas', elige: '2026' });

    r = subeUnNivel(r, padreDe);
    r = subeUnNivel(r, padreDe);
    r = subeUnNivel(r, padreDe);

    expect(r).toEqual({ mirandoEn: null, elige: '2026' });
  });
});

function elegidoCarpetaEnPistas() {
  return eligeCarpeta(entraEn(EN_LA_RAIZ, 'viajes'), 'pistas');
}
