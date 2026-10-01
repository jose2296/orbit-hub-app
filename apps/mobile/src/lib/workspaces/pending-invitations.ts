import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";

/**
 * How many invitations are waiting, for the badge in the menu.
 *
 * **A separate call from the one the screen makes, and it has to be small.** The menu
 * is mounted from the first frame — including the frames where the session is still
 * being restored — so this cannot wait for a token or every drawer open is a 401 and a
 * number that arrives too late to be seen.
 *
 * The count is asked **once per session**, not on every open, and that is the whole
 * design. A badge is a thing you notice when it changes: a counter that refetches on
 * each open is a number that flickers, and a number that flickers is a number people
 * stop believing. An invitation is an event with a mail attached — the person already
 * heard about it — so a count that is a minute or two stale is not a lie.
 *
 * It is asked again after the screen answers one, which is the only moment it is
 * definitely wrong: `refresh` is called by the screen on accept and on decline.
 */
let cache: { count: number; at: number } | null = null;

/** Long enough that a menu open does not refetch, short enough to feel current. */
const FRESH_MS = 60_000;

export function usePendingInvitations(enabled: boolean) {
  const [count, setCount] = useState(() => cache?.count ?? 0);
  const pedido = useRef(false);

  const refresh = useCallback(async () => {
    if (pedido.current) return;
    pedido.current = true;
    try {
      const response = await api.get<{ items: unknown[] }>("/invitations");
      const total = response.items.length;
      cache = { count: total, at: Date.now() };
      setCount(total);
    } catch {
      /*
        Silence on purpose, and it is worth saying why. A badge is decoration: if the
        network is not there, the number it would show is "I do not know", and a row
        that says it does not know is worse than a row that is not there. The screen
        this count points at *does* report its failure, in the place where somebody is
        actually waiting for an answer.
      */
    } finally {
      pedido.current = false;
    }
  }, []);

  useEffect(() => {
    // Nothing to ask without a session, and asking is what produces the 401.
    if (!enabled) return;

    // Read once: `cache && … < FRESH_MS` is a boolean, and a boolean does not narrow
    // the thing it was computed from, so `cache.count` would be "possibly null".
    const cached = cache;
    if (cached && Date.now() - cached.at < FRESH_MS) {
      setCount(cached.count);
      return;
    }

    void refresh();
  }, [enabled, refresh]);

  return { count, refresh };
}

/** Test seam: the cache is module state, and a test has to be able to start empty. */
export function resetPendingInvitationsCache(): void {
  cache = null;
}