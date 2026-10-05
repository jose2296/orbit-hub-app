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
 *   node scripts/verify-spike.mjs hermes [--serial emulator-5554]
 *       Reads `adb logcat` itself, extracts the fingerprint, and checks that the
 *       log really came from Hermes (`SPIKE_ENV.engine`) before trusting it.
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
const SERIAL = process.env.ANDROID_SERIAL ?? 'emulator-5554';

const fail = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};

const usage = (message) => {
  console.error(`ERROR ${message}`);
  console.error(
    'usage: verify-spike.mjs node | hermes [--serial <id>] | browser | --refresh',
  );
  process.exit(2);
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

const fromAdb = () => {
  try {
    return execFileSync('adb', ['-s', SERIAL, 'logcat', '-d'], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    fail(
      `cannot read logcat from ${SERIAL} (${error.message}). ` +
        'Is the emulator up, and has the app loaded a bundle from Metro?',
    );
  }
};

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

const argv = process.argv.slice(2);
const environment = argv.find((a) => !a.startsWith('--'));
const wantsRefresh = argv.includes('--refresh');

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
  const measured = extract(fromAdb(), `adb logcat on ${SERIAL}`);
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
