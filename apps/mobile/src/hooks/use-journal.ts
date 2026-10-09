import type { JournalDay } from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  journalDaysWithText,
  mentionTargetIndex,
  readJournalEntry,
} from "@/lib/journal/entries";
import type { JournalEntryRecord } from "@/lib/journal/entries";
import type { MentionTarget } from "@/lib/journal/mentions";
import { subscribeToLocalStore } from "@/lib/offline";

/**
 * Reading the journal out of the cache.
 *
 * Each hook reads again whenever the cache changes, which is what a pull does, so
 * a page shows what another device wrote without the screen asking for it. The
 * writes live in `lib/journal/entries.ts`, as they do for notes.
 */

/** The entry of one day, or null when nothing was written for it. */
export function useJournalEntry(userId: string | undefined, day: string) {
  const [record, setRecord] = useState<JournalEntryRecord | null>(null);
  // False until the cache has been read once. An editor opened before that would
  // start empty and then be asked to show text it has already been drawn without.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setRecord(null);
      setLoaded(true);
      return;
    }
    const next = await readJournalEntry(userId, day as JournalDay);
    setRecord(next);
    setLoaded(true);
  }, [userId, day]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return { record, loaded, reload: load };
}

/** The days that have words in them, for the dots on the calendar. */
export function useJournalDaysWithText(userId: string | undefined): Set<string> {
  const [days, setDays] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!userId) {
      setDays(new Set());
      return;
    }
    let active = true;
    const load = async () => {
      const next = await journalDaysWithText(userId);
      if (active) setDays(next);
    };
    void load();
    const unsubscribe = subscribeToLocalStore(() => {
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  return days;
}

/**
 * Every target a chip can point at, read once per change of the cache.
 *
 * Drawing is synchronous and a chip is drawn inside the text, so the lookup has
 * to be ready before the text is. The index is rebuilt when the cache changes and
 * not per chip.
 */
export function useMentionTargets(): Map<string, MentionTarget> | null {
  // Null until the first read, so a screen can tell "not read yet" from "nothing to link".
  const [index, setIndex] = useState<Map<string, MentionTarget> | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const next = await mentionTargetIndex();
      if (active) setIndex(next);
    };
    void load();
    const unsubscribe = subscribeToLocalStore(() => {
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return index;
}
