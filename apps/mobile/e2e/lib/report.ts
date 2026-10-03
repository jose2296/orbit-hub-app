import { writeFileSync } from 'node:fs';
import type { Verdict } from './guard.ts';

export type AreaResult = { area: string; flows: number; maestroOk: boolean; guard: Verdict };

/**
 * El ancho del nombre del area en la tabla.
 *
 * Los nombres llevan prefijo numerico -`01-onboarding`- y eso ya los ordena de a
 * ojo; el ancho solo alinea el numero de flujos. Veintiocho deja sitio de sobra
 * para los nombres de las nueve areas del plan y no parte ninguno en dos.
 */
const ANCHO_AREA = 28;

const ancho = (texto: string, n: number) => texto.padEnd(n).slice(0, n);

/**
 * Las areas que hoy estan en rojo por un motivo que ya se sabe, y no es el arnes.
 *
 * **Por que esto vive en el informe y no solo en el README.** Un informe que dice
 * `FALLA` sin decir mas se lee como un arnes roto, y quien lo encuentra dentro de
 * tres semanas no va a abrir el README para comprobar si el fallo es suyo o
 * nuestro. Con esta nota, el fichero dice el motivo en el sitio donde se mira el
 * motivo.
 *
 * **Por que se imprime solo si el area sigue en rojo.** Es lo que la deja de
 * caducar por si sola: en cuanto se arregle la tecla de atras, `01-onboarding`
 * pasa, la nota desaparece y el informe vuelve a ser un informe. Una nota fija
 * seria un fallo documentado que un dia contradiria a la tabla de al lado, y un
 * informe que se contradice a si mismo no se lee.
 *
 * Y por que la lista es de datos y no un parrafo: anadir un area a la fase 2 con
 * un fallo conocido es escribir una linea mas aqui, no reescribir un texto.
 */
const CONOCIDOS: { area: string; flujos: string[]; porque: string }[] = [
  {
    area: '01-onboarding',
    flujos: ['privacy', 'terms'],
    porque: 'la tecla de atras de Android sale de la aplicacion en vez de desapilar',
  },
];

/**
 * El recuento va por areas y no por flujos.
 *
 * Una carrera con cuarenta flujos y un area rota es un fallo, no un 39/40: el
 * total de flujos no dice nada de como esta la app, porque depende de cuantos
 * flujos se hayan escrito y eso es decision de quien los escribe, no de la app. El
 * estado de la app es el de sus areas.
 */
export function renderReport(resultados: AreaResult[]): string {
  const lineas: string[] = [];
  lineas.push(
    `arnes E2E android - ${resultados.length} area${resultados.length === 1 ? '' : 's'} recorrid${resultados.length === 1 ? 'a' : 'as'}`,
  );
  lineas.push(
    'PASA: el area entera en verde y el guardian sin nada que decir. FALLA: el motivo va en su linea.',
  );
  lineas.push('');

  for (const r of resultados) {
    // `PASA` solo si las dos cosas: el area entera en verde **y** el guardian sin
    // nada que decir. Con el guardian mirando para otro lado, un area en verde es
    // un area de la que no se sabe nada.
    const veredicto = r.guard.ok && r.maestroOk ? 'PASA' : 'FALLA';
    let motivo: string;
    if (!r.guard.ok) motivo = r.guard.problems.join(' | ');
    else if (!r.maestroOk) motivo = 'Maestro fallo';
    // El area sin flujos es el unico caso en que `PASA` no significa "todo bien":
    // Maestro sale con codigo 0 cuando no ha probado nada, asi que un area vacia
    // entra en verde. El runner ya lo avisa por pantalla -`aviso: el area X no
    // tiene flujos`-, pero el aviso se va con la consola y el informe se queda.
    else if (r.flows === 0) motivo = 'sin flujos que probar: verde por no haber probado nada';
    else motivo = 'ok';
    lineas.push(`${veredicto}  ${ancho(r.area, ANCHO_AREA)}${String(r.flows).padStart(3)} flujos  ${motivo}`);
  }

  const sanas = resultados.filter((r) => r.guard.ok && r.maestroOk).length;
  lineas.push('');
  lineas.push(`${sanas}/${resultados.length} areas sin fallo`);

  // La leyenda de abajo no es un adorno: sin ella, un `FALLA` sin mas se lee como
  // un arnes roto, y esa es la lectura que hace que nadie mire el motivo de la
  // linea de al lado -que es donde esta la causa.
  lineas.push('');
  lineas.push('Un area en FALLA no es el arnes roto: el motivo va en su linea, y puede ser de la app.');

  const conocidos = conocidosVivos(resultados);
  for (const k of conocidos) {
    // Una sola linea, larga, sin plegarla: plegarla partiria el nombre de los
    // flujos entre dos lineas y el informe se lee igual de bien en cualquier
    // editor, que ya envuelve solo.
    lineas.push(
      `conocido y sin arreglar: ${k.flujos.join(' y ')} de ${k.area} caen en su paso \`back\` porque ${k.porque}. No lo causa el arnes: pasan cuando se arregle.`,
    );
  }

  return lineas.join('\n');
}

/**
 * Los motivos conocidos que **siguen siendo verdad** en esta carrera: los que
 * nombran un area que esta en `resultados` y que ha fallado.
 *
 * Un area en verde es la senal de que el motivo ya no aplica, y entonces la nota
 * no se imprime: nadie tiene que acordarse de borrar un texto que ya no dice la
 * verdad.
 */
function conocidosVivos(resultados: AreaResult[]): typeof CONOCIDOS {
  return CONOCIDOS.filter((k) => resultados.some((r) => r.area === k.area && !(r.guard.ok && r.maestroOk)));
}

/**
 * El informe a disco, en `capturas/android/informe.txt`.
 *
 * Mismo formato que el `pantallas.txt` de `verify-android-screens.mjs`, porque es
 * el formato que este repo sabe leer: una tabla de texto pegable en un ticket. Y
 * porque una foto de una pantalla no dice **cual** de las nueve areas fallo.
 *
 * `renderReport` esta separada de esta funcion a proposito: el formato se prueba
 * sin tocar el disco, y el fichero se prueba comparandose con el. Las dos mitades
 * juntas en una sola habrian dejado el formato sin comprobar.
 */
export function writeReport(archivo: string, resultados: AreaResult[]): void {
  writeFileSync(archivo, `${renderReport(resultados)}\n`, 'utf8');
}