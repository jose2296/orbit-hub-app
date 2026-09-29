import type {
  CreateShareRequest,
  Share,
  ShareListResponse,
  ShareReach,
  ShareRole,
} from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/client";

/**
 * What has been shared with this person, and who they have shared with.
 *
 * Not offline-first, for the same reason the member list is not: a grant is an act
 * between two people decided on the server when somebody presses a button. A
 * cached "shared with me" is a copy that can be wrong about whether the person
 * who sent it still wants you in their list — and the inbox is exactly the screen
 * where being wrong matters, because the action it offers is "put this in my
 * space".
 *
 * So it reads from the network when it opens, writes nothing into the local
 * cache, and says so when it cannot reach the server instead of showing an
 * inbox from last Tuesday. What the app *does* keep offline is the thing itself:
 * once a grant exists, the sync brings the list down like any other, and you can
 * work on it with the aeroplane mode on. Being able to see the inbox needs the
 * network; being able to use what you got does not.
 */
export interface SharesState {
  /** Unplaced things. Once you file one it belongs to that space and leaves. */
  inbox: Share[];
  isLoading: boolean;
  error: string | null;
}

export function useShares() {
  const [state, setState] = useState<SharesState>({
    inbox: [],
    isLoading: false,
    error: null,
  });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const inbox = await api.get<ShareListResponse>("/shares/inbox");
      setState({ inbox: inbox.items, isLoading: false, error: null });
    } catch (error) {
      setState({
        inbox: [],
        isLoading: false,
        error: error instanceof ApiError ? error.message : null,
      });
    }
  }, []);

  // Nothing is loaded on mount, on purpose.
  //
  // It used to be, and every caller paid for it: the two share sheets only want
  // `share` and `place` and were fetching the whole inbox to get them, and the
  // drawer is mounted from the first frame — including the frames where the
  // session is still being restored — so its copy went out with no token and came
  // back 401, every time the menu was drawn. The one caller that wants the inbox
  // asks for it, and asks once there is a session to ask with.

  /** Gives a node to somebody. A link, not a copy: it stays where it is. */
  const share = useCallback(
    async (input: CreateShareRequest) => {
      return api.post<{ id: string }>("/shares", input);
    },
    [],
  );

  /** Takes it back. The other side finds out on the next pull. */
  const revoke = useCallback(async (shareId: string) => {
    await api.delete(`/shares/${shareId}`);
  }, []);

  /** Files a received thing in one of your own spaces, and it leaves the inbox. */
  const place = useCallback(
    async (input: {
      shareId: string;
      workspaceId: string;
      folderId: string | null;
    }) => {
      await api.post(`/shares/${input.shareId}/place`, {
        workspaceId: input.workspaceId,
        folderId: input.folderId,
      });
      await load();
    },
    [load],
  );

  return { ...state, load, share, revoke, place };
}

/**
 * Who a delete is about to hit.
 *
 * The question a screen asks *before* the confirmation, and the reason it is a
 * separate call and not a field on the thing: "you are about to delete this from
 * three places" has to be on screen before anybody taps confirm, and there is no
 * way to ask that afterwards.
 *
 * Returns `null` while it is asking, and also when the answer could not be
 * fetched — a count you could not get is not a count, and inventing a zero here
 * would say "nobody else has this" on the strength of a failed request. The
 * delete still works; it just does not claim to know.
 */
export function useShareReach(
  target: { nodeType: Share['nodeType']; nodeId: string } | null,
) {
  const [reach, setReach] = useState<ShareReach | null>(null);

  useEffect(() => {
    if (!target) {
      setReach(null);
      return;
    }

    let cancelled = false;
    setReach(null);

    api
      .get<ShareReach>(`/shares/${target.nodeType}/${target.nodeId}/reach`)
      .then((answer) => {
        if (!cancelled) setReach(answer);
      })
      .catch(() => {
        if (!cancelled) setReach(null);
      });

    return () => {
      cancelled = true;
    };
  }, [target?.nodeType, target?.nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return reach;
}

/** The two roles, in the order they should be offered. */
export const SHARE_ROLES: readonly ShareRole[] = ["editor", "viewer"] as const;
