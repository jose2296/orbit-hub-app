import type { ListPeopleResponse, Person, PersonMatch } from "@orbit-hub/contracts";
import { useCallback, useState } from "react";

import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/client";

/**
 * The people you have already had a transaction with.
 *
 * Not offline-first, for the same reason the member list and the inbox are not: who
 * you know is a fact about other people, decided on the server, and a cached
 * directory is a copy that can be wrong about whether somebody is still somebody
 * you share with. Revoking a share is exactly the moment it would be wrong, and
 * that is the moment somebody opens this list to share again.
 *
 * So it reads from the network when the sheet opens, writes nothing into the local
 * cache, and says so when it cannot reach the server instead of offering a list
 * from last Tuesday.
 *
 * There is **no search endpoint and no fallback to the user table**, and that is
 * the whole privacy decision of this feature, not an omission. See
 * `docs/architecture/adr/0032-personas.md`.
 */
export interface PeopleState {
  people: Person[];
  isLoading: boolean;
  error: string | null;
}

export function usePeople() {
  const [state, setState] = useState<PeopleState>({
    people: [],
    isLoading: false,
    error: null,
  });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const answer = await api.get<ListPeopleResponse>("/people");
      setState({ people: answer.items, isLoading: false, error: null });
    } catch (error) {
      // An empty list and a failed request are both "no rows", and they are not the
      // same thing: one is honest and the other is a broken screen that looks like
      // somebody who has never shared anything in their life. The picker keeps the
      // free-text field either way, so a failure here degrades to "share by email",
      // which is exactly what the app did before this existed.
      setState({
        people: [],
        isLoading: false,
        error: error instanceof ApiError ? error.message : null,
      });
    }
  }, []);

  return { ...state, load };
}

/**
 * Find somebody you already know of, to follow them.
 *
 * Deliberately its own hook and not a flag on `usePeople`: this is the only call in
 * the app that reads the accounts table, and giving it its own name means the next
 * reader can find it with a search for "who reads users" instead of having to notice
 * that one of the branches of a hook about your own directory does.
 *
 * It is asked for **on demand and not while typing**: every keystroke would be a
 * request over a table of accounts, and the server would (rightly) refuse the short
 * ones anyway. Three characters is the minimum there and here.
 */
export function usePeopleSearch() {
  const [items, setItems] = useState<PersonMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    const limpio = query.trim();
    if (limpio.length < 3) {
      setItems([]);
      setError(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const answer = await api.get<{ items: PersonMatch[] }>(
        `/people/search?q=${encodeURIComponent(limpio)}`,
      );
      setItems(answer.items);
    } catch (problem) {
      setItems([]);
      setError(problem instanceof ApiError ? problem.message : null);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setError(null);
    setIsSearching(false);
  }, []);

  return { items, isSearching, error, search, clear };
}

/** Follow somebody: one row into the directory and nothing else happens. */
export async function followPerson(personId: string): Promise<void> {
  await api.post(`/people/${personId}/follow`, {});
}

/** Stop following. The row leaves the directory and the picker with it. */
export async function unfollowPerson(personId: string): Promise<void> {
  await api.delete(`/people/${personId}/follow`);
}

/**
 * The people whose name or address matches what has been typed.
 *
 * Filtering happens here, on the client, over a list that is already bounded by the
 * caller's own relations. Sending the query to the server would be a search
 * endpoint, and a search endpoint over a table is the thing this feature is
 * specifically not.
 */
export function filterPeople(people: Person[], query: string): Person[] {
  const limpio = query.trim().toLowerCase();
  // Everything, when nothing has been typed. An empty directory that only shows
  // people once you type is a directory that looks broken on arrival.
  if (!limpio) return people;

  return people.filter((person) => {
    const nombre = person.user.displayName.toLowerCase();
    const correo = person.user.email.toLowerCase();
    return (
      nombre.includes(limpio) ||
      correo.includes(limpio) ||
      // The local part before the @, because people search for "marta" and not for
      // "marta@" when they are looking at a list of names.
      correo.split("@")[0]?.includes(limpio) === true
    );
  });
}
