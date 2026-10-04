import { writeFileSync } from 'node:fs';
import type { Verdict } from './guard.ts';

export type AreaResult = {
  area: string;
  flows: number;
  maestroOk: boolean;
  guard: Verdict;
  /**
   * Los flujos que Maestro dice que fallaron, uno por linea, como
   * `<flujo>: <motivo>`.
   *
   * **Por que son cadenas y no un objeto.** Esto no es un dato de la app: es el
   * texto que se imprime en el informe, y lo unico que hay que hacer con el es
   * escribirlo. Lo que si necesita estructura -saber que flujos fallaron, para no
   * atribuir un motivo conocido a un area roja por otra causa- lo resuelve
   * `fallosDeMaestro`, aqui mismo, y de una sola vez.
   */
  fallidos: string[];
};

/**
 * Ancho **minimo** de la columna del nombre del area, no un tope.
 *
 * Los nombres llevan prefijo numerico -`01-onboarding`- y eso ya los ordena de a
 * ojo; el ancho solo alinea el numero de flujos. Lo que **no** hace es cortar:
 * con `padEnd(n).slice(0, n)` un nombre largo se partia a media palabra, y la fila
 * que nombra el area que fallo es la que menos puede perder un trozo. Un nombre
 * de 40 caracteres ensancha la fila y la deja intacta.
 */
const ANCHO_AREA = 28;

/**
 * Donde empieza el nombre del area: el veredicto, cinco de ancho, y dos espacios.
 *
 * Es un dato y no una cuenta suelta porque las lineas de detalle van debajo y
 * tienen que caer en la misma columna, o se leen como filas de otro area.
 */
const COLUMNA = 7;

const ancho = (texto: string, n: number) => texto.padEnd(n);

/**
 * Los flujos que Maestro admite que fallaron, con su motivo.
 *
 * La forma que se busca es la que Maestro imprime por flujo:
 * `[Failed] privacy (1m 2s) (Assertion is false: id: screen-welcome is visible)`.
 * El motivo se coje con el **ultimo** parentesis y no con el primero, porque el
 * motivo puede traer parentesis dentro -`text is "E2E List (beta)" is visible`- y
 * un parser que para en el primero pierde el resto y devuelve un motivo
 * truncado, que es peor que ninguno: parece un motivo.
 *
 * **Por que el parser devuelve una lista vacia en vez de un motivo generico.**
 * Porque una lista vacia y `Maestro fallo` son cosas distintas y el informe las
 * pinta distinto: la primera dice "no se ha podido leer por que fallo", que es
 * verdad y ademas es la senal de que este parser se ha roto al cambiar la version
 * de Maestro. La segunda prometeria un motivo que el informe no tiene.
 *
 * Sin ancla al principio de linea y al final: si un flujo falla con dos
 * afirmaciones falsas, Maestro repite el `Failed` por cada una, y cada repeticion
 * es un fallo real que nombrar.
 */
const FALLIDO = /^\s*\[Failed\]\s+(\S+)\s+\([^)]*\)\s+\((.*)\)\s*$/;

export function fallosDeMaestro(output: string): string[] {
  const salida: string[] = [];
  for (const linea of output.split('\n')) {
    const m = FALLIDO.exec(linea);
    if (m) salida.push(`${m[1]}: ${m[2]}`);
  }
  return salida;
}

/** `3 flujos`, `1 flujo`, `0 flujos`: el cero va en plural, como se cuenta. */
function flujos(n: number): string {
  return `${String(n).padStart(2)} ${n === 1 ? 'flujo ' : 'flujos'}`;
}

/** Lo que se imprime cuando Maestro fallo y su salida no dice por que. */
const SIN_MOTIVO = 'Maestro fallo y no se ha podido leer por que: mira la salida del area';

export type VeredictoArea = { estado: 'PASA' | 'FALLA' | 'NADA'; motivo: string };

/**
 * El veredicto de un area. **Aqui, y no tambien en el runner.**
 *
 * El codigo de salida estaba en el runner con la misma condicion escrita otra vez y
 * sin la mitad que falta -`guard.ok && code === 0`, que para un area sin flujos es
 * `true` mientras el `verdict` de esa area es rojo-. Y el `verdict` lo es porque
 * `forceStop` para la app antes del area y sin un flujo no hay nada que la levante:
 * un area vacia salia en la consola como `FALLA ... la app se cerro`, accusando a
 * una app que nadie habia abierto, mientras el informe de la misma carrera decia
 * `NADA ... sin flujos que probar`. Los dos artefactos de la misma carrera se
 * contradecian, y el que se lee sin abrir el otro -la linea de consola- es el que
 * miente. Una fila con `NADA` y un codigo de salida en rojo no son dos estilos de
 * lo mismo: son dos verdades, y solo una es cierta.
 *
 * **Tres estados y no dos, porque "no ha pasado nada" no es "todo bien".** Con dos,
 * el `NADA` de la fila y el `true` del runner tienen que existir en sitios
 * distintos, y dos sitios son uno de mas para que una decision se separe de su
 * lectura.
 *
 * **El area vacia se decide antes que el guardian, y no por descuido.** En un area
 * sin flujos no se ha probado nada, y lo unico que el guardian puede decir es que
 * no hay proceso: eso no es un sintoma, es que no habia nada. El orden lo fija aqui
 * y no en quien llama, que es donde se volveria a equivocar uno de los dos.
 */
export function veredictoArea(r: AreaResult): VeredictoArea {
  if (r.flows === 0) {
    return { estado: 'NADA', motivo: 'sin flujos que probar' };
  }
  if (!r.guard.ok) {
    return { estado: 'FALLA', motivo: r.guard.problems.join(' | ') };
  }
  if (!r.maestroOk) {
    // La cuenta de flujos caidos, no la palabra de que fallo la herramienta: los
    // nombres y los motivos estan en las lineas de debajo, y "2 de 3 flujos
    // fallaron" es el principio de esas lineas en una sola fila.
    return {
      estado: 'FALLA',
      motivo:
        r.fallidos.length > 0 ? `${r.fallidos.length} de ${r.flows} flujos fallaron` : SIN_MOTIVO,
    };
  }
  return { estado: 'PASA', motivo: 'ok' };
}

/**
 * Si la carrera sale en rojo, que es lo unico que el runner decide con su codigo de
 * salida. **Un `FALLA` y nada mas.**
 *
 * Montar un area nueva no puede poner en rojo la carrera de quien todavia no ha
 * escrito sus flujos: por eso `NADA` no es un fallo. Y un area **con** flujos que se
 * queda sin proceso sigue siendo un fallo -ahi si se ha probado algo y no estaba-,
 * que es lo que `veredictoArea` ya resuelve en la fila. Las dos mitades del codigo
 * de salida estan aqui y en ningun sitio mas, y por eso esta comprobada aqui.
 */
export function saleEnRojo(resultados: AreaResult[]): boolean {
  return resultados.some((r) => veredictoArea(r).estado === 'FALLA');
}

/**
 * El recuento va por areas y no por flujos.
 *
 * Una carrera con cuarenta flujos y un area rota es un fallo, no un 39/40: el
 * total de flujos no dice nada de como esta la app, porque depende de cuantos
 * flujos se hayan escrito y eso es decision de quien los escribe, no de la app. El
 * estado de la app es el de sus areas.
 *
 * **Y un area sin flujos no cuenta como sana.** No fallo, pero tampoco se probo
 * nada, y un `1/1 areas sin fallo` debajo de una fila que dice "no he probado
 * nada" son dos frases que se contradicen en el mismo fichero. La fila lleva su
 * propio veredicto -`NADA`- y el recuento la deja fuera, porque las dos cosas -
 * fila y recuento- se pintan con `veredictoArea`, que es la misma que decide el
 * codigo de salida del runner: que la carrera salga con codigo 0 al montar un area
 * nueva no es una promesa del documento, es que `saleEnRojo` no cuenta un `NADA`.
 *
 * **Lo que se quita de aqui, y por que se puede quitar.** Hasta el arreglo de la
 * tecla de atras, el informe imprimia debajo una nota por cada area con un fallo
 * conocido **de la app**: `01-onboarding` en rojo porque el boton de atras de
 * Android salia de la aplicacion en vez de desapilar. La nota vivia en el informe y
 * no solo en el README porque quien encuentra el fichero dentro de tres semanas no
 * abre el README para ver si el fallo es suyo, y era lo que impedia leer un `FALLA`
 * como un arnes roto.
 *
 * El defecto se arreglo -`android.predictiveBackGestureEnabled` a `false`, con el
 * motivo y el precio en el ADR 0034- y la nota se retiro sola, que es exactamente
 * lo que se escribio para que hiciera: solo se imprime mientras los flujos que
 * nombra sean los que Maestro dice que han fallado. Y al quedarse la lista vacia se
 * fue **la maquinaria con ella**: una tabla de conocidos sin entradas, un filtro
 * sobre ella y sus pruebas son codigo que no puede fallar y comprobaciones que no
 * miran la app.
 *
 * Volver a traerla es anadir una tabla y un filtro, y hay una regla que no se puede
 * relajar: **la nota solo se imprime si los flujos que nombra son los que fallan**,
 * y solo si el guardian no tiene nada que decir. Apoyada en el area sola, atribuiria
 * un fallo conocido a un area roja por otra causa y prometeria un arreglo que no
 * tocaria ese fallo. La regla quedo escrita en el ADR 0033 para el dia que haga
 * falta.
 */
export function renderReport(resultados: AreaResult[]): string {
  const lineas: string[] = [];
  const n = resultados.length;
  lineas.push(`arnes E2E android - ${n} ${n === 1 ? 'area recorrida' : 'areas recorridas'}`);
  lineas.push(
    'PASA: el area entera en verde y el guardian sin nada que decir. ' +
      'FALLA: el motivo va en su fila o en las de debajo. ' +
      'NADA: el area no tiene flujos y no se ha probado nada.',
  );
  lineas.push('');

  for (const r of resultados) {
    // La fila sale de `veredictoArea`, la misma funcion que decide el codigo de
    // salida, y no de una condicion escrita aqui: la tabla y el `exitCode` cuentan
    // areas de la misma manera o se contradicen en el mismo fichero.
    const { estado, motivo } = veredictoArea(r);
    lineas.push(`${estado.padEnd(COLUMNA - 2)}  ${ancho(r.area, ANCHO_AREA)}${flujos(r.flows)}  ${motivo}`);
    // Los flujos que fallaron, uno por linea. **Debajo y no en la fila**: la
    // tabla se lee de un vistazo y el detalle se lee cuando se busca el motivo, y
    // un motivo largo metido en la fila parte la tabla en dos.
    for (const f of r.fallidos) lineas.push(`${' '.repeat(COLUMNA)}${f}`);
  }

  // `PASA` y no "no es `FALLA`": un area sin flujos tampoco es un `FALLA`, y aqui no
  // cuenta. Las dos listas salen del mismo sitio que la fila de arriba, asi que el
  // `1/1 areas sin fallo` de debajo no puede contradecir a un `NADA` de arriba.
  const sanas = resultados.filter((r) => veredictoArea(r).estado === 'PASA').length;
  lineas.push('');
  lineas.push(`${sanas}/${resultados.length} areas sin fallo`);

  // La leyenda de abajo no es un adorno: sin ella, un `FALLA` sin mas se lee como
  // un arnes roto, y esa es la lectura que hace que nadie mire el motivo de la
  // fila de al lado -que es donde esta la causa-. Por eso se queda **siendo la
  // ultima linea** aunque ya no haya ninguna nota de fallo conocido debajo: es la
  // que manda a mirar el motivo, y el motivo sigue siendo el de la fila.
  lineas.push('');
  lineas.push(
    'Un area en FALLA no es el arnes roto: el motivo va en su fila o en las de debajo, y puede ser de la app.',
  );

  return lineas.join('\n');
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