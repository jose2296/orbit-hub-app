import { useMemo } from "react";
import { View } from "react-native";

import { JournalDayView } from "@/components/journal/journal-day-view";
import { useJournalEntry, useMentionTargets } from "@/hooks/use-journal";
import { lookupIn } from "@/lib/journal/entries";
import { useTheme } from "@/theme";

/**
 * A neighbouring day, as it would read, shown while the page is being swiped to it.
 *
 * It is read-only and never writes: looking at a day next to this one must not
 * create anything. An empty day shows an empty page of the same background.
 */
export function JournalDayPreview({ userId, day }: { userId: string; day: string }) {
  const theme = useTheme();
  const { record, loaded } = useJournalEntry(userId, day);
  const targets = useMentionTargets();
  const lookup = useMemo(() => (targets === null ? null : lookupIn(targets)), [targets]);

  if (!loaded || targets === null || lookup === null || !record || record.plainText.trim().length === 0) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }
  return <JournalDayView document={record.document} lookup={lookup} targets={targets} />;
}
