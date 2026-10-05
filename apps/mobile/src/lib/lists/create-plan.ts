import type { ListKind } from '@orbit-hub/contracts';

export interface CreateListInput {
  id: string;
  workspaceId: string;
  /** `null` is the space itself, which is the root folder of the tree. */
  folderId?: string | null;
  kind: ListKind;
  title: string;
  emoji?: string;
}

export interface CreateListPlan {
  /**
   * The one answer both writes use.
   *
   * The cache row and the queued operation used to be written separately, and
   * the operation left the folder out. The list then came back from the server
   * at the workspace root, overwriting a cache that had it right, and neither
   * side had anything to say about it: the push answers `applied` and the local
   * row was never wrong. One value, two writes, no way to disagree.
   */
  folderId: string | null;
  /** What the server is told. */
  payload: {
    workspaceId: string;
    folderId: string | null;
    kind: ListKind;
    title: string;
    emoji?: string;
  };
}

/**
 * Creating a list, as a pure plan.
 *
 * Kept out of the hook so the rules can be checked without a database, the same
 * reason `duplicate.ts` is. The folder is always sent, including as `null`: the
 * sanitiser accepts an explicit root (`sync-service.ts`), and silence is not the
 * same statement as "the root of the space".
 */
export function createListPlan(input: CreateListInput): CreateListPlan {
  const folderId = input.folderId ?? null;

  return {
    folderId,
    payload: {
      workspaceId: input.workspaceId,
      folderId,
      kind: input.kind,
      title: input.title,
      ...(input.emoji ? { emoji: input.emoji } : {}),
    },
  };
}
