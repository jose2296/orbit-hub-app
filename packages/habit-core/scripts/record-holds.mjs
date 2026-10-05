/**
 * Lo que decide si el registro de ADR 0033 aguanta, en funciones puras: lo
 * necesitan los dos que lo leen, `verify-spike.mjs` y `spike.test.ts`. Que vivan
 * aqui y no en uno de los dos es lo que hace que ambos digan lo mismo, y no dos
 * versiones de la regla que se separan en silencio.
 *
 * Nada de esto escribe ni imprime: las dos cosas las hace quien llama, para que
 * un error salga con el formato de quien lo ha producido.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** El registro es el unico bloque JSON cercado del ADR, y tiene que seguir siendolo. */
export const RECORD_BLOCK = /```json\n[\s\S]*?\n```/;

/** Las dos librerias de las que depende el resultado: el sello se escribe con estas. */
export const LIBRARIES = ['rrule', 'luxon'];

export const readRecord = (adr) => {
  const path = fileURLToPath(adr);
  const text = readFileSync(path, 'utf8');
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) {
    throw new Error(
      `${path} has ${blocks.length} fenced json blocks, expected exactly 1. ` +
        'The record has to be unambiguous to be checkable.',
    );
  }
  let record;
  try {
    record = JSON.parse(blocks[0][1]);
  } catch (error) {
    throw new Error(
      `${path}: the json block does not parse (${error.message}). ` +
        'Fix the record; nothing can be compared against a record that will not load.',
    );
  }
  return { text, record };
};

/**
 * Las versiones instaladas salen del `package-lock.json` y no de `node_modules`:
 * el lock es lo versionado, asi que "con que libreria se midio esto" es una
 * pregunta con respuesta leyendo el repositorio, y una subida de version sale en
 * el diff aunque el arbol de trabajo siga igual.
 */
export const installedVersions = (lock) => {
  const path = fileURLToPath(lock);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot read ${path} (${error.message}). Without it there is no answer to which ` +
        'library version produced a measurement.',
    );
  }
  const versions = {};
  for (const name of LIBRARIES) {
    const version = parsed.packages?.[`node_modules/${name}`]?.version;
    if (!version) {
      throw new Error(
        `${path} has no entry for node_modules/${name}. The record is stamped with the ` +
          'library versions, so there has to be something to stamp.',
      );
    }
    versions[name] = version;
  }
  return versions;
};

export const stampText = (stamp) =>
  stamp?.rrule && stamp?.luxon
    ? `rrule@${stamp.rrule}, luxon@${stamp.luxon}`
    : 'no library versions recorded';

export const sameVersions = (stamp, versions) =>
  stamp != null && Object.entries(versions).every(([name, version]) => stamp[name] === version);

/**
 * Por que una entrada del registro no vale para este checkout. Es derivado y no
 * acumulado: se recalcula cada vez que se mira el registro, para que la marca no
 * se pueda poner ni quitar a mano.
 *
 * Son las dos formas de que una medicion de ayer deje de ser evidencia hoy: que se
 * haya medido con otras librerias, o que la huella que declara ya no sea la que da
 * Node.
 */
export const recheckReasons = (entry, versions, nodeFingerprint) => {
  const reasons = [];
  if (!sameVersions(entry?.verifiedWith, versions)) {
    reasons.push(
      `measured with ${stampText(entry?.verifiedWith)}, this checkout has ${stampText(versions)}`,
    );
  }
  if (nodeFingerprint !== undefined && entry?.fingerprint !== nodeFingerprint) {
    reasons.push(
      `its fingerprint ${entry?.fingerprint ?? '(none)'} is not node's ${nodeFingerprint}`,
    );
  }
  return reasons;
};

/**
 * Las entradas que no valen, cada una con su motivo. Sin motivo no hay un fallo
 * util: "el registro no aguanta" no dice si falta medir el navegador, medir Hermes
 * o volver a instalar la libreria.
 */
export const unheldEntries = (environments, versions, nodeFingerprint) =>
  Object.entries(environments ?? {})
    .map(([name, entry]) => ({ name, reasons: recheckReasons(entry, versions, nodeFingerprint) }))
    .filter(({ reasons }) => reasons.length > 0);

/** El texto con el que el registro y el verificador explican el mismo fallo. */
export const unheldReport = (pending) =>
  [
    'The record does not hold yet:',
    ...pending.map(({ name, reasons }) => `  ${name}: ${reasons.join('; ')}`),
    '',
    'Measure them again and write the measurements down:',
    '  npm run spike:verify --workspace @orbit-hub/habit-core -- hermes --record',
    '  npm run spike:verify --workspace @orbit-hub/habit-core -- browser --record < console.txt',
    '',
    'Until then `npm run test --workspace @orbit-hub/habit-core` is red, which is the',
    'point: a record that says the three agree when only one was measured is',
    'exactly the failure this exists to catch.',
  ].join('\n');