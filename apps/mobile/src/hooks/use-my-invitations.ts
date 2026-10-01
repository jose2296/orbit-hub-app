import { useCallback, useEffect, useState } from "react";

import type { AcceptInvitationResponse, Invitation } from "@orbit-hub/contracts";

import { api, toApiError } from "@/lib/api";

/**
 * The invitations waiting for this person to answer.
 *
 * **This is what the mail used to be.** Accepting an invitation meant opening a link
 * in a message, which means the notification was also the only door — and a door inside
 * a message that gets searched and buried is a door that gets lost. Here the invitation
 * is a row in the app, next to everything else, and the mail only has to say it exists.
 *
 * **Not read from the local store, and not offline-first.** An invitation is somebody
 * else's decision offered to you: it is created when the owner presses a button, it can
 * be revoked while your phone is in a drawer, and a cached copy would go on offering to
 * accept something that no longer exists. The server is the only place that knows.
 *
 * The token comes back with the list, and that is not a leak: the list only ever
 * contains invitations whose address is this account's own, so it hands out exactly the
 * authority the mail already handed to that inbox.
 */
export function useMyInvitations() {
  const [items, setItems] = useState<Invitation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get<{ items: Invitation[] }>("/invitations");
      setItems(response.items);
      setError(null);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Accepts, and says which space it was.
   *
   * The space comes back with the answer rather than being looked up after, so the
   * screen navigates to something that is known to exist rather than to an id that
   * might not.
   */
  const accept = useCallback(async (token: string) => {
    setPendingToken(token);
    setError(null);
    try {
      const response = await api.post<AcceptInvitationResponse>(
        `/invitations/${token}/accept`,
        {},
      );
      // Out of the list before the navigation: coming back to a screen that still
      // shows the thing you just accepted is the kind of detail that makes people
      // press it twice.
      setItems((previos) => previos.filter((i) => i.token !== token));
      return response.workspace;
    } catch (caught) {
      setError(toApiError(caught).message);
      return null;
    } finally {
      setPendingToken(null);
    }
  }, []);

  const decline = useCallback(async (token: string) => {
    setPendingToken(token);
    setError(null);
    try {
      await api.post(`/invitations/${token}/decline`, {});
      setItems((previos) => previos.filter((i) => i.token !== token));
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setPendingToken(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    items,
    isLoading,
    error,
    pendingToken,
    load,
    accept,
    decline,
  };
}