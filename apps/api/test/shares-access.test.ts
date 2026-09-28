import { describe, expect, it } from 'vitest';

import { accessOf, canEdit, canRevoke, canShare, canView } from '../src/modules/shares/access.js';

const NINGUNA = { membershipRole: null, mountRole: null, grantRole: null };

describe('accessOf', () => {
  it('with neither door, no access', () => {
    expect(accessOf(NINGUNA)).toBe('none');
    expect(canView(NINGUNA)).toBe(false);
    expect(canEdit(NINGUNA)).toBe(false);
  });

  it('a member of the space gets what the role says', () => {
    expect(accessOf({ membershipRole: 'owner', mountRole: null, grantRole: null })).toBe('edit');
    expect(accessOf({ membershipRole: 'editor', mountRole: null, grantRole: null })).toBe('edit');
    expect(accessOf({ membershipRole: 'viewer', mountRole: null, grantRole: null })).toBe('view');
  });

  it('a grant alone is enough, without being a member of the space', () => {
    // This is the whole point of the block: somebody can reach a node in a space
    // that is not theirs.
    expect(accessOf({ membershipRole: null, mountRole: null, grantRole: 'editor' })).toBe('edit');
    expect(accessOf({ membershipRole: null, mountRole: null, grantRole: 'viewer' })).toBe('view');
  });

  it('the strongest of the two doors wins, when there is no ceiling', () => {
    // Not a member of the space it lives in, not filed anywhere, shared with you
    // as editor: you can edit it. And the other way round --shared as viewer,
    // filed in your own space as editor-- lands on the same answer, because the
    // order of the arguments must not be the answer.
    expect(accessOf({ membershipRole: null, mountRole: null, grantRole: 'editor' })).toBe('edit');
    // Compartida como "ver" y colocada en un espacio tuyo donde puedes editar:
    // la concesion no te baja de editor. Los espacios donde estas son tuyos.
    expect(accessOf({ membershipRole: null, mountRole: 'editor', grantRole: 'viewer' })).toBe('view');
  });

  it('an editor of the space keeps editing it, shared or not', () => {
    expect(accessOf({ membershipRole: 'editor', mountRole: null, grantRole: 'viewer' })).toBe('edit');
    expect(accessOf({ membershipRole: 'owner', mountRole: null, grantRole: null })).toBe('edit');
  });

  it('never less than one door on its own', () => {
    expect(accessOf({ membershipRole: 'viewer', mountRole: null, grantRole: null })).toBe('view');
    expect(accessOf({ membershipRole: null, mountRole: null, grantRole: 'editor' })).toBe('edit');
  });

  it('a share does not escalate anybody inside their own space', () => {
    // Somebody who is a viewer in space A has a folder shared into it. With the
    // obvious rule --the strongest of the two-- they would be editing inside a
    // space where they were only supposed to look, and granting yourself a folder
    // would be a way around the permissions of a space you are already in.
    expect(accessOf({ membershipRole: 'viewer', mountRole: null, grantRole: 'editor' })).toBe('view');
  });

  it('filing it in a space where you are a viewer does not make you its editor', () => {
    // You chose that space. The grant is a door, not a key that overrides the lock
    // on the door you walked in.
    expect(accessOf({ membershipRole: null, mountRole: 'viewer', grantRole: 'editor' })).toBe('view');
    expect(accessOf({ membershipRole: null, mountRole: 'editor', grantRole: 'editor' })).toBe('edit');
  });

  it('the weakest of the rooms caps what the grant can give you', () => {
    // Editor where you filed it, viewer in the space it lives in: the grant cannot
    // hand you more than the weakest room allows, so you are a viewer. The other
    // way round as well, so the order of the arguments is not the answer.
    expect(accessOf({ membershipRole: 'viewer', mountRole: 'editor', grantRole: 'editor' })).toBe('view');
    expect(accessOf({ membershipRole: 'editor', mountRole: 'viewer', grantRole: 'editor' })).toBe('edit');
  });

  it('a grant alone has no ceiling, because you are in none of those spaces', () => {
    // This is the case the block exists for: somebody who was given a list in a
    // space that is not theirs edits it, and nothing about it is an accident.
    expect(accessOf({ membershipRole: null, mountRole: null, grantRole: 'editor' })).toBe('edit');
  });
});

describe('canShare', () => {
  it('is for members of the space who can edit it', () => {
    expect(canShare({ membershipRole: 'owner', mountRole: null, grantRole: null })).toBe(true);
    expect(canShare({ membershipRole: 'editor', mountRole: null, grantRole: null })).toBe(true);
  });

  it('is not for a viewer, and not for a grantee however much they can edit', () => {
    // Being able to edit fifty items is not being able to decide that a sixth
    // person sees them. Those are different powers and this is where they are
    // kept apart.
    expect(canShare({ membershipRole: 'viewer', mountRole: null, grantRole: null })).toBe(false);
    expect(canShare({ membershipRole: null, mountRole: null, grantRole: 'editor' })).toBe(false);
    expect(canShare({ membershipRole: null, mountRole: null, grantRole: 'viewer' })).toBe(false);
  });

  it('is not for a grantee who is also a member of the space, but only as viewer', () => {
    // They are a member, so the check has to look at the role and not at the
    // existence of a membership, or "viewer" would be able to share.
    expect(canShare({ membershipRole: 'viewer', mountRole: null, grantRole: 'editor' })).toBe(false);
  });
});

describe('canRevoke', () => {
  it('is for the person who granted it', () => {
    expect(canRevoke({ grantOwnerId: 'yo', userId: 'yo' })).toBe(true);
    expect(canRevoke({ grantOwnerId: 'otro', userId: 'yo' })).toBe(false);
  });

  it('is for nobody when the grant has no owner left', () => {
    // A deleted account leaves a tombstone. The grant stays, nobody can take it
    // back, and that is better than letting the next person to touch it decide.
    expect(canRevoke({ grantOwnerId: null, userId: 'yo' })).toBe(false);
  });

  it('is not for somebody who can edit the thing', () => {
    // Two people editing the same list does not make the second one the owner of
    // who else sees it.
    expect(canRevoke({ grantOwnerId: 'el-que-compartio', userId: 'quien-edita' })).toBe(false);
  });
});
