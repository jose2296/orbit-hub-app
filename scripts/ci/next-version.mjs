#!/usr/bin/env node
/**
 * The version a CI release ships, computed and never committed back to `main`.
 *
 * Same idea as the game's deploy workflow: the next `versionName` comes from the
 * latest `vX.Y.Z` tag and the merged pull request (a `feat` title is a minor bump,
 * the `major` label is a major one, anything else is a patch), and the tag is only
 * created after the upload succeeded. `versionCode` has to grow with every upload
 * Play has ever seen, so it is an offset plus the workflow's run number.
 *
 *   node scripts/ci/next-version.mjs --tags "v0.1.30 v0.1.31" --head-tags "" \
 *     --baseline 0.1.31 --title "feat: x" --labels "" --run-number 7
 *
 * Prints `version=`, `code=` and `tag=` lines, ready for `$GITHUB_OUTPUT`. `tag` is
 * empty when the commit already carries a version tag (a re-run), so a re-run does
 * not invent a second version for the same commit.
 */

/** Added to the run number. Above every versionCode uploaded before CI existed (32). */
export const CODE_OFFSET = 100;

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parse(text) {
  const match = SEMVER.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const format = (v) => v.join('.');

export function bumpKind(title, labels) {
  const lista = String(labels)
    .split(',')
    .map((label) => label.trim().toLowerCase());
  if (lista.includes('major')) return 'major';
  if (/^feat(\(.+\))?!?:/i.test(String(title).trim())) return 'minor';
  return 'patch';
}

export function nextVersion({ tags = '', headTags = '', baseline, title = '', labels = '', runNumber }) {
  const run = Number(runNumber);
  if (!Number.isInteger(run) || run < 1) throw new Error('run-number must be a positive integer');
  const code = CODE_OFFSET + run;

  const enCabeza = String(headTags).split(/\s+/).map(parse).filter(Boolean).sort(compare).at(-1);
  if (enCabeza) return { version: format(enCabeza), code, tag: '' };

  const conocidas = [...String(tags).split(/\s+/).map(parse), parse(baseline)].filter(Boolean);
  if (conocidas.length === 0) throw new Error('no tag and no valid baseline version');
  const ultima = conocidas.sort(compare).at(-1);

  const tipo = bumpKind(title, labels);
  const siguiente =
    tipo === 'major'
      ? [ultima[0] + 1, 0, 0]
      : tipo === 'minor'
        ? [ultima[0], ultima[1] + 1, 0]
        : [ultima[0], ultima[1], ultima[2] + 1];
  return { version: format(siguiente), code, tag: `v${format(siguiente)}` };
}

function argumentos(argv) {
  const salida = {};
  for (let i = 0; i < argv.length; i += 1) {
    const actual = argv[i];
    if (!actual.startsWith('--')) continue;
    const [clave, valor] = actual.slice(2).split(/=(.*)/s);
    salida[clave] = valor ?? argv[(i += 1)] ?? '';
  }
  return salida;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = argumentos(process.argv.slice(2));
  const { version, code, tag } = nextVersion({
    tags: a.tags,
    headTags: a['head-tags'],
    baseline: a.baseline,
    title: a.title,
    labels: a.labels,
    runNumber: a['run-number'],
  });
  process.stdout.write(`version=${version}\ncode=${code}\ntag=${tag}\n`);
}
