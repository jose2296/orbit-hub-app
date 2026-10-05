#!/usr/bin/env node
/**
 * Checks the three-environment record committed in
 * `docs/architecture/adr/0033-recurrencia-con-rrule-y-luxon.md`.
 *
 * The test suite runs in `environment: 'node'` and cannot start a browser or an
 * emulator, so the two measurements that decide the library of the whole project
 * live outside it. What this script owns is the comparison: a measurement is
 * only ever a number somebody read off a console, and "somebody read eight
 * characters and said they matched" is not a check. Here it is a command with an
 * exit code.
 *
 *   node scripts/verify-spike.mjs node
 *       Computes it here and compares. No arguments, no human.
 *
 *   node scripts/verify-spike.mjs hermes [--serial <id>]
 *       Reads `adb logcat` itself, extracts the fingerprint, and checks that the
 *       log really came from Hermes (`SPIKE_ENV.engine`) before trusting it. The
 *       serial comes from `--serial`, then `ANDROID_SERIAL`, then the default, in
 *       that order, and it is looked up in `adb devices` before anything is read:
 *       a serial that is not there is said out loud instead of falling back to
 *       whatever emulator happens to be up.
 *
 *   node scripts/verify-spike.mjs browser < console.txt
 *       The browser console cannot be piped, so the two `SPIKE_*` lines are
 *       pasted in on stdin. Same checks: the line has to say it came from a
 *       browser.
 *
 *   node scripts/verify-spike.mjs --refresh
 *       Rewrites the machine-derived parts of the record from this checkout:
 *       node's fingerprint, `result` and `gap`. The browser and Hermes entries
 *       are measurements, so they are never touched.
 *
 * Exit codes: 0 the record holds, 1 it does not, 2 the command was wrong.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = new URL('..', import.meta.url);
const SPIKE = new URL('dist/spike.js', PACKAGE_ROOT);
const ADR = new URL(
  '../../../docs/architecture/adr/0033-recurrencia-con-rrule-y-luxon.md',
  import.meta.url,
);
const DEFAULT_SERIAL = 'emulator-5554';

const fail = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};

const usage = (message) => {
  console.error(`ERROR ${message}`);
  console.error(
    'usage: verify-spike.mjs node\n' +
      '       verify-spike.mjs hermes [--serial <id>]\n' +
      '       verify-spike.mjs browser < console.txt\n' +
      '       verify-spike.mjs --refresh',
  );
  process.exit(2);
};

/**
 * Que flags existen y cuales llevan valor. `--serial` estaba documentado en la
 * cabecera y en el ADR, se aceptaba en silencio, y el script comparaba el registro
 * del emulador que no te habian pedido: un flag que hace otra cosa de la que dice
 * es peor que no tenerlo. Por eso un flag desconocido es un error de comando y no
 * una opcion ignorada.
 */
const FLAGS_WITH_VALUE = new Set(['--serial']);
const BOOLEAN_FLAGS = new Set(['--refresh']);

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
 * The record is the single fenced ```json block of the ADR. There is exactly
 * one, and a second one would make this ambiguous, so the count is checked.
 */
const readRecord = () => {
  const text = readFileSync(ADR, 'utf8');
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) {
    fail(
      `${fileURLToPath(ADR)} has ${blocks.length} fenced json blocks, expected exactly 1. ` +
        'The record has to be unambiguous to be checkable.',
    );
  }
  try {
    return { text, record: JSON.parse(blocks[0][1]) };
  } catch (error) {
    fail(
      `${fileURLToPath(ADR)}: the json block does not parse (${error.message}). ` +
        'Fix the record; nothing can be compared against a record that will not load.',
    );
  }
};

/** Live values, from the built spike. Its absence is a build, not a mystery. */
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
 * Both numbers come out of the same console line pair, so they are read together:
 * a fingerprint without the environment that produced it is not evidence of
 * anything, and pasting the Node line three times would satisfy a weaker check.
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
  return { fingerprint, engine: env.engine, source, env };
};

const check = (measured, expected, label) => {
  if (expected === null || expected === undefined) {
    fail(
      `${label} has no fingerprint recorded. The record is a claim until it has a ` +
        'number in it; measure it and write it down.',
    );
  }
  if (measured.fingerprint !== expected) {
    fail(
      `${label} diverged.\n` +
        `  recorded in the ADR: ${expected}\n` +
        `  measured now:      ${measured.fingerprint}\n` +
        `  source:             ${measured.source}\n` +
        'The library choice in this ADR rests on the three agreeing.',
    );
  }
  console.log(`ok    ${label}: ${measured.fingerprint} (${measured.engine})`);
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

const resolveSerial = (requested) => {
  const serial = requested ?? process.env.ANDROID_SERIAL ?? DEFAULT_SERIAL;
  const from = requested
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

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8');
  } catch (error) {
    usage(`expected the browser console lines on stdin (${error.message})`);
  }
};

const refresh = async ({ text, record }) => {
  const spike = await live();
  const updated = {
    ...record,
    measuredOn: new Date().toISOString().slice(0, 10),
    environments: {
      ...record.environments,
      node: { ...record.environments.node, fingerprint: spike.spikeFingerprint() },
    },
    result: spike.spikeResult(),
    gap: spike.spikeResult().probe2_sundaysInTheGap,
  };
  const next = text.replace(
    /```json\n[\s\S]*?\n```/,
    () => '```json\n' + JSON.stringify(updated, null, 2) + '\n```',
  );
  writeFileSync(ADR, next);
  console.log(
    `refreshed ${fileURLToPath(ADR)}: node is ${updated.environments.node.fingerprint}. ` +
      `browser and hermes kept as recorded (${updated.environments.browser?.fingerprint}, ` +
      `${updated.environments.hermes?.fingerprint}).`,
  );
};

const { words, flags } = parseArgs(process.argv.slice(2));
const [environment, ...extraWords] = words;
const wantsRefresh = flags.get('--refresh') === true;
const serialFlag = flags.get('--serial');

if (extraWords.length > 0) {
  usage(`unexpected extra argument "${extraWords[0]}"`);
}
if (wantsRefresh && environment !== undefined) {
  usage('--refresh measures this checkout, so it takes no environment');
}
if (serialFlag !== undefined && environment !== 'hermes') {
  usage(`--serial only applies to hermes, not to ${environment ?? 'a missing environment'}`);
}

if (wantsRefresh) {
  await refresh(readRecord());
} else if (environment === 'node') {
  const { record } = readRecord();
  const spike = await live();
  const env = spike.spikeEnv();
  const recorded = record.environments?.node;
  check(
    { fingerprint: spike.spikeFingerprint(), engine: env.engine, source: 'this run' },
    recorded?.fingerprint,
    'node',
  );
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
} else if (environment === 'hermes') {
  const { record } = readRecord();
  const serial = resolveSerial(serialFlag);
  const measured = extract(fromAdb(serial), `adb logcat on ${serial}`);
  if (measured.engine !== 'hermes') {
    fail(
      `that log line says engine "${measured.engine}", not hermes. ` +
        'A stale line from another environment in the log buffer is not a measurement.',
    );
  }
  check(measured, record.environments?.hermes?.fingerprint, 'hermes');
} else if (environment === 'browser') {
  const { record } = readRecord();
  const measured = extract(readStdin(), 'the pasted browser console');
  if (measured.engine !== 'browser') {
    fail(`that console line says engine "${measured.engine}", not browser.`);
  }
  check(measured, record.environments?.browser?.fingerprint, 'browser');
} else {
  usage(environment ? `unknown environment "${environment}"` : 'no environment given');
}
