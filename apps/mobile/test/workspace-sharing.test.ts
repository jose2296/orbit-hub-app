import { describe, expect, it } from 'vitest';

import {
  inviteLinkFor,
  roleLabelKey,
  rolePromiseKey,
  webOrigin,
} from '../src/lib/workspace/sharing';
import { dictionaries } from '../src/lib/i18n/dictionaries';

const es = dictionaries.es;
const en = dictionaries.en;

/**
 * The link somebody has to open, and the words that say what they get.
 *
 * Two things that can only be checked here. The link is the one string that
 * leaves the app and gets pasted into a conversation, so it has to be right for
 * a phone and for a laptop. And the words for a role are used in two shapes — a
 * label on its own and a sentence around it — and a label that reads fine alone
 * reads like a title in the middle of a sentence.
 */
describe('inviteLinkFor', () => {
  it('makes a path anybody can type', () => {
    // The token goes in the path and not in a query string: a link in an email
    // client survives a query string, and a path survives being copied out of a
    // chat bubble too.
    expect(inviteLinkFor('abc123')).toMatch(/\/invite\/abc123$/);
  });

  it('escapes a token that has to be escaped', () => {
    // A token with a slash or a question mark in it must not become two
    // segments, or the server answers about a token that never existed.
    expect(inviteLinkFor('a/b?c')).toContain('/invite/a%2Fb%3Fc');
  });

  it('never leaves two slashes at the join', () => {
    expect(inviteLinkFor('x')).not.toContain('//invite');
  });
});

describe('webOrigin', () => {
  it('is an address with no path on it', () => {
    // Whatever the origin is, the link is built by joining two things, and an
    // origin with a trailing slash produces a link with a double slash in the
    // middle of it that some servers answer with a 404.
    expect(webOrigin()).not.toMatch(/\/$/);
  });
});

describe('the words for a role', () => {
  it('has a label in both languages for every role', () => {
    for (const role of ['owner', 'editor', 'viewer']) {
      expect(es[roleLabelKey(role)]).toBeTruthy();
      expect(en[roleLabelKey(role)]).toBeTruthy();
    }
  });

  it('has a sentence in both languages for every role', () => {
    for (const role of ['owner', 'editor', 'viewer']) {
      expect(es[rolePromiseKey(role)]).toBeTruthy();
      expect(en[rolePromiseKey(role)]).toBeTruthy();
    }
  });

  it('never puts a label inside a sentence', () => {
    // "Vas a entrar como Puede editar." is a title in the middle of a
    // sentence, and it is the one line on this screen that somebody reads before
    // deciding whether to let a person into their lists.
    for (const role of ['owner', 'editor', 'viewer']) {
      const label = es[roleLabelKey(role)] as string;
      for (const sentence of [es[rolePromiseKey(role)], en[rolePromiseKey(role)]]) {
        expect(sentence).not.toContain(label);
      }
    }
  });

  it('says an unknown role is the least of the three', () => {
    // A role from a future build is not a crash and not a blank: the person is
    // shown the least access this app knows about.
    expect(roleLabelKey('admin-del-futuro')).toBe('share.roleViewer');
    expect(rolePromiseKey('admin-del-futuro')).toBe('invite.joinAsViewer');
  });
});
