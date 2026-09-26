import type {
  AcceptInvitationResponse,
  Invitation,
  ListInvitationsResponse,
  ListWorkspaceMembersResponse,
  MembershipRole,
  PreviewInvitationResponse,
  WorkspaceMember,
} from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/client";

/**
 * The people in a space, and the invitations waiting for an answer.
 *
 * This is the one screen in the app that is not offline-first, and the reason
 * is the same one the API gives: a member list is not something two devices
 * reconcile. Who is in a space is decided on the server, at the moment
 * somebody presses a button, and a cached copy of it is a copy that can be
 * wrong about whether you are still welcome somewhere.
 *
 * So it reads from the network when it opens, it does not write anything into
 * the local cache, and it says when it could not reach the server instead of
 * showing a list from last Tuesday.
 */
export interface MembersState {
  members: WorkspaceMember[];
  invitations: Invitation[];
  isLoading: boolean;
  error: string | null;
}

export function useMembers(workspaceId: string | null) {
  const [state, setState] = useState<MembersState>({
    members: [],
    invitations: [],
    isLoading: false,
    error: null,
  });

  const load = useCallback(async () => {
    if (!workspaceId) {
      setState({ members: [], invitations: [], isLoading: false, error: null });
      return;
    }

    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const [members, invitations] = await Promise.all([
        api.get<ListWorkspaceMembersResponse>(
          `/workspaces/${workspaceId}/members`,
        ),
        // Owners see the invitations; everybody else gets a 403 and there is
        // nothing for them to see in this list anyway.
        api
          .get<ListInvitationsResponse>(
            `/workspaces/${workspaceId}/invitations`,
          )
          .catch(() => ({ items: [] })),
      ]);

      setState({
        members: members.items,
        invitations: invitations.items,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState({
        members: [],
        invitations: [],
        isLoading: false,
        error: error instanceof ApiError ? error.message : null,
      });
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = useCallback(
    async (input: { role: "editor" | "viewer"; email?: string }) => {
      if (!workspaceId) throw new Error("No space");
      const created = await api.post<Invitation>(
        `/workspaces/${workspaceId}/invitations`,
        {
          role: input.role,
          ...(input.email ? { email: input.email } : {}),
        },
      );
      await load();
      return created;
    },
    [workspaceId, load],
  );

  const revoke = useCallback(
    async (invitationId: string) => {
      if (!workspaceId) return;
      await api.delete(
        `/workspaces/${workspaceId}/invitations/${invitationId}`,
      );
      await load();
    },
    [workspaceId, load],
  );

  const changeRole = useCallback(
    async (userId: string, role: Exclude<MembershipRole, "owner">) => {
      if (!workspaceId) return;
      await api.patch(`/workspaces/${workspaceId}/members/${userId}`, { role });
      await load();
    },
    [workspaceId, load],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      if (!workspaceId) return;
      await api.delete(`/workspaces/${workspaceId}/members/${userId}`);
      await load();
    },
    [workspaceId, load],
  );

  return { ...state, load, invite, revoke, changeRole, removeMember };
}

/**
 * The invitation behind a link, before deciding about it.
 *
 * Read on its own and not through `useMembers`, because whoever opens the link
 * is not in the space yet, so there is no space to be a member of.
 *
 * `enabled` is there because the preview says *who is reading it* and there is
 * nobody to ask before the session is restored. Asking anyway is a request
 * with no token on it, which is a 401 in the log of every link that anybody
 * ever opens signed out, and a log full of expected failures is a log nobody
 * reads.
 */
export function useInvitationPreview(token: string | null, enabled = true) {
  const [state, setState] = useState<{
    preview: PreviewInvitationResponse | null;
    isLoading: boolean;
    error: string | null;
  }>({ preview: null, isLoading: false, error: null });

  useEffect(() => {
    if (!token || !enabled) return;

    let cancelled = false;
    setState({ preview: null, isLoading: true, error: null });

    api
      .get<PreviewInvitationResponse>(`/invitations/${token}`)
      .then((preview) => {
        if (!cancelled) setState({ preview, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          preview: null,
          isLoading: false,
          error: error instanceof ApiError ? error.message : null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [token, enabled]);

  const accept = useCallback(async () => {
    if (!token) throw new Error("No link");
    return api.post<AcceptInvitationResponse>(
      `/invitations/${token}/accept`,
      {},
    );
  }, [token]);

  const decline = useCallback(async () => {
    if (!token) return;
    await api.post(`/invitations/${token}/decline`, {});
  }, [token]);

  return { ...state, accept, decline };
}
