import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CODE_OFFSET, bumpKind, nextVersion } from './ci/next-version.mjs';

describe('next-version', () => {
  it('a feat title is a minor bump and anything else a patch', () => {
    assert.equal(bumpKind('feat: swipe', ''), 'minor');
    assert.equal(bumpKind('feat(lists): swipe', ''), 'minor');
    assert.equal(bumpKind('fix: bug', ''), 'patch');
    assert.equal(bumpKind('Merge pull request #1', ''), 'patch');
  });

  it('the major label wins over the title', () => {
    assert.equal(bumpKind('feat: x', 'bug, major'), 'major');
  });

  it('bumps from the highest of the tags and the baseline', () => {
    const r = nextVersion({ tags: 'v0.1.2 v0.1.9', baseline: '0.1.31', title: 'fix: x', runNumber: 4 });
    assert.deepEqual(r, { version: '0.1.32', code: CODE_OFFSET + 4, tag: 'v0.1.32' });
  });

  it('a minor bump resets the patch and a major resets both', () => {
    assert.equal(nextVersion({ baseline: '0.1.31', title: 'feat: x', runNumber: 1 }).version, '0.2.0');
    assert.equal(nextVersion({ baseline: '0.1.31', labels: 'major', runNumber: 1 }).version, '1.0.0');
  });

  it('a commit that already has a version tag keeps it and creates no new tag', () => {
    const r = nextVersion({ tags: 'v0.2.0', headTags: 'v0.2.0', baseline: '0.1.0', title: 'fix', runNumber: 9 });
    assert.deepEqual(r, { version: '0.2.0', code: CODE_OFFSET + 9, tag: '' });
  });

  it('refuses a missing run number and an unusable baseline', () => {
    assert.throws(() => nextVersion({ baseline: '0.1.0' }), /run-number/);
    assert.throws(() => nextVersion({ baseline: 'nope', runNumber: 1 }), /baseline/);
  });
});
