/**
 * What a grant lets somebody do, and what it does not.
 *
 * A grant is a second door into the same tree, and two doors into a tree with one
 * set of keys is a tree where somebody can walk in and open a door that was
 * supposed to be locked. So the rule is short and it is not negotiable per
 * screen: **a person's access to a node is the strongest of the two ways they have
 * of reaching it.**
 *
 * That is the whole rule, and almost everything surprising follows from it:
 *
 * - A folder shared with somebody inside a space they are not a member of gives
 *   them that folder, not the space. The space is somebody else's.
 * - A list inside a shared folder that they have also mounted in a space of their
 *   own is editable through both, and the strongest wins. If the folder says
 *   viewer and their space says editor, it is editor — and if that is wrong, the
 *   fix is not in this file, it is in not sharing it twice.
 * - **A grant never raises you above a space you are already in.** This one took a
 *   second pass and it is the easiest mistake in the whole block. The obvious rule
 *   --"the strongest of the two doors"-- escalates: somebody who is a *viewer* in
 *   space A has a folder shared into it, and now they are editing inside a space
 *   where they were only supposed to look. A grant is a second door, not a key
 *   that overrides the locks already on the door.
 * - **Sharing does not chain.** Somebody who was given a list cannot pass it on,
 *   so the circle always has one person who could hand it to someone else, and
 *   there is no question of who can see a list that nobody knows about.
 *
 * `canShare` is separate and it is the one that is deliberately false for
 * grantees: being able to edit a thing is not being able to decide who else sees
 * it, and those are different powers.
 */

/** What somebody can do with a node. */
export type ShareAccess = "none" | "view" | "edit";

/** The strongest of two accesses. */
function max(a: ShareAccess, b: ShareAccess): ShareAccess {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The weakest of two, used as a ceiling. */
function min(a: ShareAccess, b: ShareAccess): ShareAccess {
  return RANK[a] <= RANK[b] ? a : b;
}

/** The strength of an access, for the "the strongest of the two" rule. */
const RANK: Record<ShareAccess, number> = { none: 0, view: 1, edit: 2 };

/** What a membership gives. Owning a space means being able to edit it, and more. */
function fromMembership(role: string | null | undefined): ShareAccess {
  if (role === 'owner' || role === 'editor') return 'edit';
  if (role === 'viewer') return 'view';
  return 'none';
}

/** What a grant gives. There is no "owner" here on purpose: nobody owns a grant. */
function fromGrant(role: string | null | undefined): ShareAccess {
  if (role === 'editor') return 'edit';
  if (role === 'viewer') return 'view';
  return 'none';
}

export interface AccessFacts {
  /** Their role in the space the node lives in, or null if they are not a member. */
  membershipRole: string | null;
  /**
   * Their role in the space they filed it in, or null. It is a *second ceiling*:
   * they chose that space, and filing a list inside a space where they are a
   * viewer does not make them its editor.
   */
  mountRole: string | null;
  /**
   * The role of the strongest grant that reaches this node or anything above it,
   * or null. "Above it" is what makes a shared folder carry its lists.
   */
  grantRole: string | null;
}

/**
 * The access these facts add up to.
 *
 * Three terms, and getting the order right is the whole file:
 *
 * - **Your membership in the space it lives in** stands on its own. Nobody can take
 *   it away from you by sharing anything.
 * - **The grant is a floor, and a ceiling caps it.** A grant of editor in a space
 *   where you are a viewer is a viewer, or else sharing yourself a folder would be
 *   a way around the permissions of a space you are already in.
 * - **The grant never lowers you either.** Shared as viewer, filed in a space where
 *   you are an editor: you are an editor there. The rooms you are standing in are
 *   yours.
 *
 * So: the strongest of your own membership and the grant-capped-by-the-rooms. And
 * somebody who is in none of those spaces has no ceiling, which is exactly the case
 * of somebody a list was shared with on purpose.
 */
export function accessOf(facts: AccessFacts): ShareAccess {
  const tuya = fromMembership(facts.membershipRole);

  const techos = [facts.membershipRole, facts.mountRole]
    .map(fromMembership)
    .filter((acceso) => acceso !== 'none');
  const limite = techos.length === 0 ? 'edit' : techos.reduce<ShareAccess>(
    (masBajo, actual) => min(masBajo, actual),
    'edit',
  );

  const porConcesion = min(fromGrant(facts.grantRole), limite);
  return max(tuya, porConcesion);
}

export function canEdit(facts: AccessFacts): boolean {
  return accessOf(facts) === 'edit';
}

export function canView(facts: AccessFacts): boolean {
  return accessOf(facts) !== 'none';
}

/**
 * Whether this person may hand the node to somebody else.
 *
 * True for a member of its space, and false for a grantee, always. A grantee can
 * edit a list with fifty items in it and cannot decide that a sixth person sees
 * them, and the two are not on a scale: one is about the contents and the other is
 * about who is let in.
 */
export function canShare(facts: AccessFacts): boolean {
  return facts.membershipRole === 'owner' || facts.membershipRole === 'editor';
}

/**
 * Whether a grant may be revoked: the person who granted it, and nobody else.
 *
 * Not "anybody who can edit it". Two people editing the same list does not make
 * the second one the owner of who else sees it, and letting him take the share
 * away would be a way of ending somebody's access without telling anybody.
 */
export function canRevoke(args: { grantOwnerId: string | null; userId: string }): boolean {
  return args.grantOwnerId !== null && args.grantOwnerId === args.userId;
}
