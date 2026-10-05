#!/usr/bin/env node
/**
 * Comprueba el registro de los tres entornos que esta commiteado en
 * `docs/architecture/adr/0033-recurrencia-con-rrule-y-luxon.md`.
 *
 * La suite corre en `environment: 'node'` y no puede arrancar un navegador ni un
 * emulador, asi que las dos mediciones que deciden la libreria de todo el
 * proyecto viven fuera de ella. Lo que le toca a este script es la comparacion:
 * una medicion es un numero que alguien leyo en una consola, y "alguien leyo ocho
 * caracteres y dijo que cuadraban" no es una comprobacion. Aqui es un comando con
 * codigo de salida.
 *
 * Comparar no escribe nunca. Los dos caminos que escriben son `--refresh`, que
 * mide este checkout, y `--record`, que escribe la medicion que acaba de llegar
 * de un entorno medido a mano.
 *
 *   node scripts/verify-spike.mjs node
 *       La calcula aqui y la compara. Sin argumentos y sin persona.
 *
 *   node scripts/verify-spike.mjs hermes [--serial <id>] [--record]
 *       Lee `adb logcat` el mismo, extrae la huella y comprueba que el log venga
 *       de verdad de Hermes (`SPIKE_ENV.engine`) antes de fiarse. El emulador se
 *       busca con `adb devices` antes de leer: un serial que no existe se dice,
 *       no se lee el otro.
 *
 *   node scripts/verify-spike.mjs browser [--record] < consola.txt
 *       La consola del navegador no se puede canalizar, asi que se pegan las dos
 *       lineas `SPIKE_*` por stdin. Las mismas comprobaciones.
 *
 *   node scripts/verify-spike.mjs --refresh
 *       Reescribe del checkout lo que si se puede calcular: la huella de Node,
 *       `result`, `gap` y las versiones de libreria instaladas. Los dos entornos
 *       que hay que medir a mano no se tocan, pero quedan **marcados** para esta
 *       version de las librerias (`recheck`) cuando su medicion deja de valer, de
 *       modo que el test de `spike.test.ts` se pone rojo hasta que se vuelvan a
 *       medir y a escribir con `--record`.
 *
 * Codigos de salida: 0 el registro aguanta, 1 no aguanta, 2 el comando estaba
 * mal. Un `--refresh` que deja entradas sin remedir sale con 1 aunque la
 * escritura haya ido bien: el registro ya no aguanta y un 0 aqui seria una
 * mentira que un script se traga sin mirar.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  RECORD_BLOCK,
  installedVersions as readInstalledVersions,
  readRecord as readRecordFile,
  recheckReasons,
  sameVersions,
  stampText,
  unheldEntries,
  unheldReport,
} from './record-holds.mjs';

const PACKAGE_ROOT = new URL('..', import.meta.url);
const SPIKE = new URL('dist/spike.js', PACKAGE_ROOT);
const ADR = new URL(
  '../../../docs/architecture/adr/0033-recurrencia-con-rrule-y-luxon.md',
  import.meta.url,
);
const LOCK = new URL('../../../package-lock.json', import.meta.url);
const DEFAULT_SERIAL = 'emulator-5554';
/** Los tres son la afirmacion entera: sin uno de estos, el registro no dice nada. */
const HAND_MEASURED = ['browser', 'hermes'];

const fail = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};

const usage = (message) => {
  console.error(`ERROR ${message}`);
  console.error(
    'usage: verify-spike.mjs node\n' +
      '       verify-spike.mjs hermes [--serial <id>] [--record]\n' +
      '       verify-spike.mjs browser [--record] < console.txt\n' +
      '       verify-spike.mjs --refresh',
  );
  process.exit(2);
};

/**
 * Que flags existen y cuales llevan valor. Un flag que nadie lee es peor que no
 * tenerlo: `--serial` estaba documentado en la cabecera y en el ADR, se aceptaba
 * en silencio y el script comparaba el registro del emulador que no te habian
 * pedido. Por eso un flag desconocido es un error de comando y no una opcion
 * ignorada.
 */
const FLAGS_WITH_VALUE = new Set(['--serial']);
const BOOLEAN_FLAGS = new Set(['--refresh', '--record']);

const parseArgs = (argv) => {
  const flags = new Map();
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (FLAGS_WITH_VALUE.has(name)) {
      if (equals !== -1) {
        flags.set(name, arg.slice(equals + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        usage(`${name} needs a value, as in --serial ${DEFAULT_SERIAL}`);
      }
      flags.set(name, next);
      i += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (equals !== -1) {
        usage(`${name} does not take a value`);
      }
      flags.set(name, true);
      continue;
    }
    usage(`unknown flag "${name}"`);
  }
  return { words, flags };
};

/**
 * El registro y las versiones instaladas se leen desde `record-holds.mjs`, que es
 * donde vive la regla y no su copia. Aqui solo se traduce un error a `FAIL`, que es
 * lo que el script sabe hacer.
 */
const readRecord = () => {
  try {
    return readRecordFile(ADR);
  } catch (error) {
    fail(error.message);
  }
};

const installedVersions = () => {
  try {
    return readInstalledVersions(LOCK);
  } catch (error) {
    fail(error.message);
  }
};

/** Valores vivos, del spike ya construido. Su ausencia es un build, no un misterio. */
const live = async () => {
  try {
    return await import(SPIKE.href);
  } catch (error) {
    fail(
      `cannot load ${fileURLToPath(SPIKE)} (${error.message}). ` +
        'Run `npm run build --workspace @orbit-hub/habit-core` first.',
    );
  }
};

/**
 * Los dos numeros salen de la misma pareja de lineas de consola, asi que se leen
 * juntos: una huella sin el entorno que la produjo no prueba nada, y pegar tres
 * veces la linea de Node dejaria pasar una comprobacion mas debil.
 */
const extract = (text, source) => {
  const lines = text.split('\n');
  const last = (marker) => {
    const hits = lines.filter((line) => line.includes(marker));
    return hits.length === 0 ? null : hits[hits.length - 1];
  };

  const fingerprintLine = last('SPIKE_FINGERPRINT');
  if (!fingerprintLine) {
    fail(`no SPIKE_FINGERPRINT line in ${source}. Nothing to compare.`);
  }
  const fingerprint = /SPIKE_FINGERPRINT\s+([0-9a-f]+)/.exec(fingerprintLine)?.[1];
  if (!fingerprint) {
    fail(`the SPIKE_FINGERPRINT line in ${source} has no hex value: ${fingerprintLine}`);
  }

  const envLine = last('SPIKE_ENV');
  if (!envLine) {
    fail(`no SPIKE_ENV line in ${source}, so the measurement cannot be attributed.`);
  }
  const raw = envLine.slice(envLine.indexOf('SPIKE_ENV') + 'SPIKE_ENV'.length).trim();
  let env;
  try {
    env = JSON.parse(raw);
  } catch (error) {
    fail(`the SPIKE_ENV line in ${source} is not json (${error.message}): ${raw}`);
  }

  /**
   * Las versiones que dice traer la medicion. Sin esto, `--record` sellaria lo que
   * dice `package-lock.json`, que es una afirmacion: el bundle puede llevar otra
   * (`rrule` vive en el `node_modules` de la raiz, fuera de los `watchFolders` de
   * `apps/mobile`) y entonces el registro declararia haber medido con una libreria
   * que no estaba. Si la linea no las trae, no se sella nada: es preferible no
   * escribir a escribir una mentira.
   */
  const libraryVersions = env?.libraryVersions ?? null;
  for (const name of ['rrule', 'luxon']) {
    if (typeof libraryVersions?.[name] !== 'string' || libraryVersions[name].length === 0) {
      fail(
        `the SPIKE_ENV line in ${source} carries no ${name} version ` +
          `(${JSON.stringify(libraryVersions)}). It comes from \`spikeEnv()\`, so this ` +
          'measurement predates the stamp and cannot be sealed. Re-measure with the ' +
          'spike rebuilt: npm run build --workspace @orbit-hub/habit-core',
      );
    }
  }

  return { fingerprint, engine: env.engine, source, env, libraryVersions };
};

const check = (measured, expected, label, hint) => {
  if (expected === null || expected === undefined) {
    fail(
      `${label} has no fingerprint recorded. The record is a claim until it has a ` +
        'number in it; measure it and write it down.' +
        (hint ? ` ${hint}` : ''),
    );
  }
  if (measured.fingerprint !== expected) {
    fail(
      `${label} diverged.\n` +
        `  recorded in the ADR: ${expected}\n` +
        `  measured now:      ${measured.fingerprint}\n` +
        `  source:             ${measured.source}\n` +
        'The library choice in this ADR rests on the three agreeing.' +
        (hint ? `\n${hint}` : ''),
    );
  }
  console.log(`ok    ${label}: ${measured.fingerprint} (${measured.engine})`);
};

/**
 * Escribir el registro. Solo hay dos caminos que llegan aqui, `--refresh` y
 * `--record`, y los dos son deliberados: comparar no escribe.
 */
const writeRecord = (text, updated) => {
  if (!RECORD_BLOCK.test(text)) {
    fail(`the record block in ${fileURLToPath(ADR)} could not be located, so nothing was written.`);
  }
  writeFileSync(
    ADR,
    text.replace(RECORD_BLOCK, () => '```json\n' + JSON.stringify(updated, null, 2) + '\n```'),
  );
};

/**
 * Lo que le falta al registro para volver a aguantar. Se imprime antes de salir con
 * 1 y el 1 es a proposito: la escritura que se acaba de hacer puede haber ido
 * bien, pero el registro ya no aguanta, y un 0 aqui seria una mentira que se traga
 * un script sin mirar.
 */
const reportUnheld = (pending) => {
  console.error(unheldReport(pending));
  process.exit(1);
};

/**
 * Que aparato se lee, y de donde sale su nombre: `--serial` gana sobre
 * `ANDROID_SERIAL`, que gana sobre el valor por defecto. El nombre se comprueba
 * contra `adb devices` antes de leer nada, porque leer el logcat de otro aparato y
 * comparar su registro con el del pedido es una comprobacion de otra cosa
 * haciendose pasar por esta.
 */
const adb = (args, what) => {
  try {
    return execFileSync('adb', args, {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    fail(`adb ${args.join(' ')} failed (${error.message}). ${what}`);
  }
};

const parseDevices = (listing) =>
  listing
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => line.length > 0 && !line.startsWith('List of devices') && !line.startsWith('*'),
    )
    .map((line) => {
      const [id, ...rest] = line.split(/\s+/);
      return { id, state: rest.join(' ') || 'unknown' };
    });

const resolveSerial = () => {
  const serial = serialFlag ?? process.env.ANDROID_SERIAL ?? DEFAULT_SERIAL;
  const from = serialFlag
    ? '--serial'
    : process.env.ANDROID_SERIAL
      ? 'ANDROID_SERIAL'
      : 'the default';

  const devices = parseDevices(
    adb(['devices'], 'Without the device list there is no way to tell whether the serial exists.'),
  );
  const found = devices.find((device) => device.id === serial);
  if (!found) {
    fail(
      `no device with serial "${serial}" is attached (taken from ${from}). ` +
        `adb devices lists: ${
          devices.length === 0
            ? '(nothing)'
            : devices.map((d) => `${d.id} [${d.state}]`).join(', ')
        }. ` +
        'Start it, or pass the serial that is really there with --serial <id>. ' +
        'Nothing was measured: falling back to another device would compare the wrong record.',
    );
  }
  if (found.state !== 'device') {
    fail(
      `"${serial}" is attached but its state is "${found.state}", not "device". ` +
        'adb cannot read a logcat from it until it is up, so nothing was measured.',
    );
  }
  console.log(`serial ${serial} (from ${from}), state ${found.state}`);
  return serial;
};

const fromAdb = (serial) =>
  adb(
    ['-s', serial, 'logcat', '-d'],
    `Is ${serial} up, and has the app loaded a bundle from Metro?`,
  );

/**
 * Que Android es el aparato, para que el registro diga de donde salio el numero y
 * no solo de que motor. Es decorativo, asi que un `getprop` que falla no puede
 * tumbar una medicion buena: se dice que no se sabe.
 */
const adbProperty = (serial, property) => {
  try {
    return (
      execFileSync('adb', ['-s', serial, 'shell', 'getprop', property], {
        encoding: 'utf8',
        timeout: 20_000,
      }).trim() || null
    );
  } catch {
    return null;
  }
};

const hermesRuntime = (serial) => {
  const release = adbProperty(serial, 'ro.build.version.release');
  const sdk = adbProperty(serial, 'ro.build.version.sdk');
  const android = release
    ? `Android ${release}${sdk ? ` (API ${sdk})` : ''}`
    : 'an Android version adb would not say';
  return `Hermes on ${serial}, ${android}`;
};

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8');
  } catch (error) {
    usage(`expected the browser console lines on stdin (${error.message})`);
  }
};

/**
 * `--refresh` mide lo unico que se puede medir desde aqui: este checkout. Los
 * otros dos son mediciones de alguien, asi que no se tocan. Pero tampoco pueden
 * quedarse callados: si su medicion ya no vale para las librerias de ahora, o su
 * huella ya no es la que da Node, quedan marcadas y el registro sale con 1. Es la
 * unica forma de que subir `rrule` no deje el registro diciendo que los tres
 * coinciden cuando lo unico que se ha comprobado es uno.
 */
const refresh = async ({ text, record }) => {
  const spike = await live();
  const versions = installedVersions();
  const fingerprint = spike.spikeFingerprint();
  // Igual que `--record` en los otros dos: Node tambien se sella con lo que trae la
  // medicion. Aqui coinciden, porque el bundle es este checkout, pero la regla es
  // una sola y no depende de que hoy sea verdad.
  const measuredWith = spike.spikeLibraryVersions();
  const environments = { ...(record.environments ?? {}) };
  environments.node = { ...environments.node, fingerprint, verifiedWith: measuredWith, recheck: null };
  for (const name of HAND_MEASURED) {
    const entry = environments[name];
    if (entry === undefined) {
      fail(
        `the record has no "${name}" entry, so there is nothing to mark as pending. ` +
          'The three agreeing is the whole claim; two of the three are not optional.',
      );
    }
    const reasons = recheckReasons(entry, versions, fingerprint);
    environments[name] = { ...entry, recheck: reasons.length === 0 ? null : reasons.join('; ') };
  }

  const updated = {
    ...record,
    measuredOn: new Date().toISOString().slice(0, 10),
    rrule: versions.rrule,
    luxon: versions.luxon,
    environments,
    result: spike.spikeResult(),
    gap: spike.spikeResult().probe2_sundaysInTheGap,
  };
  writeRecord(text, updated);
  console.log(
    `refreshed ${fileURLToPath(ADR)}: node is ${fingerprint} with ${stampText(versions)}. ` +
      `browser ${environments.browser.fingerprint}, hermes ${environments.hermes.fingerprint}.`,
  );

  const pending = unheldEntries(environments, versions, fingerprint);
  if (pending.length > 0) {
    reportUnheld(pending);
  }
};

/**
 * `hermes` y `browser` reciben la medicion de fuera, asi que hacen lo mismo con
 * ella: o el numero cuadra con lo registrado, o no. `--record` es lo unico que
 * escribe, y escribe la medicion que acaba de llegar.
 *
 * Lo que no se puede es dar el visto bueno a una entrada que dice medido con una
 * libreria que ya no es la instalada: por eso `recheck` pesa mas que el match, y
 * por eso comparar no basta para dejar el registro en verde.
 */
const settle = ({ text, record, name, measured, recorded, wantsRecord, patch }) => {
  const versions = installedVersions();
  const nodeFingerprint = record.environments?.node?.fingerprint;
  const same = recorded?.fingerprint != null && recorded.fingerprint === measured.fingerprint;
  const reasons = recheckReasons(recorded, versions, nodeFingerprint);

  if (!wantsRecord) {
    if (!same) {
      // `check` sale con 1 si el numero no es el registrado, y con 1 tambien si no
      // hay ninguno registrado.
      check(
        measured,
        recorded?.fingerprint,
        name,
        'If the new number is the expected one, re-run with --record to write it down.',
      );
    }
    if (reasons.length > 0) {
      fail(
        `the number matches, but the ${name} entry does not hold for this checkout: ` +
          `${reasons.join('; ')}. Re-run with --record so the record carries the version it ` +
          'was just measured with: ' +
          `npm run spike:verify --workspace @orbit-hub/habit-core -- ${name} --record.`,
      );
    }
    check(measured, recorded.fingerprint, name);
    return;
  }

  /**
   * Lo que se sella es **lo que dice la medicion**, no lo que dice el lock. Con el
   * lock, un bundle cacheado con la version anterior sellaria la nueva sobre una
   * medicion de la vieja y el registro no tendria forma de notarlo. Con la
   * medicion, si el bundle iba viejo el sello queda viejo a proposito y el `recheck`
   * de mas abajo lo nombra contra lo instalado.
   */
  const measuredWith = measured.libraryVersions;
  const environments = { ...record.environments };
  environments[name] = {
    ...recorded,
    engine: measured.engine,
    fingerprint: measured.fingerprint,
    verifiedWith: measuredWith,
    recheck: null,
    ...patch,
  };
  const updated = { ...record, measuredOn: new Date().toISOString().slice(0, 10), environments };
  writeRecord(text, updated);
  console.log(
    `recorded ${name} in ${fileURLToPath(ADR)}: ${measured.fingerprint} sealed with ` +
      `${stampText(measuredWith)}, as the measurement reported it (was ` +
      `${recorded?.fingerprint ?? 'nothing'} with ${stampText(recorded?.verifiedWith)}).`,
  );

  if (measuredWith.rrule !== versions.rrule || measuredWith.luxon !== versions.luxon) {
    console.log(
      `note    the measurement carried ${stampText(measuredWith)} and this checkout has ` +
        `${stampText(versions)}. The seal is the measurement's, so the entry is marked ` +
        'pending below. That is the cached-bundle case: rebuild the bundle and measure again.',
    );
  }

  const pending = unheldEntries(environments, versions, nodeFingerprint);
  if (pending.length > 0) {
    reportUnheld(pending);
  }
};

const { words, flags } = parseArgs(process.argv.slice(2));
const [environment, ...extraWords] = words;
const wantsRefresh = flags.get('--refresh') === true;
const wantsRecord = flags.get('--record') === true;
const serialFlag = flags.get('--serial');

if (extraWords.length > 0) {
  usage(`unexpected extra argument "${extraWords[0]}"`);
}
if (wantsRefresh && environment !== undefined) {
  usage('--refresh measures this checkout, so it takes no environment');
}
if (wantsRefresh && wantsRecord) {
  usage('--refresh already writes what this checkout computes; --record is for the other two');
}
if (wantsRecord && environment === undefined) {
  usage('--record applies to hermes or browser; node is measured from this checkout by --refresh');
}
if (wantsRecord && environment === 'node') {
  usage('--record does not apply to node: use --refresh, which is what computes it');
}
if (serialFlag !== undefined && environment !== 'hermes') {
  usage(`--serial only applies to hermes, not to ${environment ?? 'a missing environment'}`);
}

if (wantsRefresh) {
  await refresh(readRecord());
} else if (environment === 'node') {
  const { record } = readRecord();
  const versions = installedVersions();
  const declared = { rrule: record.rrule ?? null, luxon: record.luxon ?? null };
  if (!sameVersions(declared, versions)) {
    fail(
      `the record is stamped for ${stampText(declared)} and this checkout has ` +
        `${stampText(versions)}. A library moved and the three environments were not ` +
        'measured again: `--refresh` rewrites what this checkout computes and marks the ' +
        'other two as pending, then they have to be measured and recorded.',
    );
  }
  const spike = await live();
  const env = spike.spikeEnv();
  const recorded = record.environments?.node;
  const fingerprint = spike.spikeFingerprint();
  check({ fingerprint, engine: env.engine, source: 'this run' }, recorded?.fingerprint, 'node');
  if (recorded.engine !== env.engine) {
    fail(`the record calls node "${recorded.engine}" and this run is "${env.engine}".`);
  }
  // The record also carries the full canonical result, so a change in the maths
  // that someone forgot to re-record is caught here and not three weeks later by
  // a habit that fires at the wrong hour.
  if (JSON.stringify(spike.spikeResult()) !== JSON.stringify(record.result)) {
    fail(
      'the canonical result in the ADR is not what this build produces. ' +
        'Run `node scripts/verify-spike.mjs --refresh`.',
    );
  }
  if (JSON.stringify(spike.spikeResult().probe2_sundaysInTheGap) !== JSON.stringify(record.gap)) {
    fail(
      'the gap measurements in the ADR are not what this build produces. ' +
        'Run `node scripts/verify-spike.mjs --refresh`.',
    );
  }
  const fingerprints = new Set(
    Object.values(record.environments ?? {}).map((e) => e.fingerprint),
  );
  if (fingerprints.size !== 1) {
    fail(
      `the record holds ${fingerprints.size} different fingerprints across ` +
        `${Object.keys(record.environments ?? {}).length} environments. ` +
        `${JSON.stringify(
          Object.fromEntries(
            Object.entries(record.environments ?? {}).map(([k, v]) => [k, v.fingerprint]),
          ),
        )}`,
    );
  }
  const pending = unheldEntries(record.environments, versions, fingerprint);
  if (pending.length > 0) {
    reportUnheld(pending);
  }
} else if (environment === 'hermes') {
  const { text, record } = readRecord();
  const serial = resolveSerial();
  const measured = extract(fromAdb(serial), `adb logcat on ${serial}`);
  if (measured.engine !== 'hermes') {
    fail(
      `that log line says engine "${measured.engine}", not hermes. ` +
        'A stale line from another environment in the log buffer is not a measurement.',
    );
  }
  settle({
    text,
    record,
    name: 'hermes',
    measured,
    recorded: record.environments?.hermes,
    wantsRecord,
    patch: {
      runtime: hermesRuntime(serial),
      command: `adb -s ${serial} logcat -d | grep SPIKE_   (bundle nativo servido por Metro)`,
    },
  });
} else if (environment === 'browser') {
  const { text, record } = readRecord();
  const measured = extract(readStdin(), 'the pasted browser console');
  if (measured.engine !== 'browser') {
    fail(`that console line says engine "${measured.engine}", not browser.`);
  }
  const recorded = record.environments?.browser;
  settle({
    text,
    record,
    name: 'browser',
    measured,
    recorded,
    wantsRecord,
    patch: { command: recorded?.command ?? 'npx expo start --web --port <puerto>, consola del navegador' },
  });
} else {
  usage(environment ? `unknown environment "${environment}"` : 'no environment given');
}