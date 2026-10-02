import { View } from "react-native";

import type { ExportResult } from "@/hooks/use-export";
import type { ApiError } from "@/lib/api/client";
import { exportErrorKey } from "@/lib/export/errors";
import { pluralKey, useTranslation } from "@/lib/i18n";
import type { Translate } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { Button } from "../ui/button";
import { Sheet, useLastValue } from "../ui/sheet";
import { AppText } from "../ui/text";

/** One settled attempt: what came out of it, or why nothing did. */
export interface ExportAttempt {
  /** The delivered file, and the numbers read out of that same file. */
  result: ExportResult | null;
  /** What the attempt failed with, when it failed. */
  error: ApiError | null;
  /**
   * The same request again, and not a new one.
   *
   * Held by whoever pressed the button rather than rebuilt here, because rebuilding
   * it is how a retry becomes a second export with another format and another
   * name: same path, same format, same title, same fallback id, or it is not a
   * retry.
   */
  onRetry: () => void;
}

export interface ExportResultSheetProps {
  /** The attempt on screen, and `null` while the sheet is closed. */
  attempt: ExportAttempt | null;
  onClose: () => void;
}

/**
 * What an export left behind: how much, under what name, and — when it failed —
 * why, with the button to ask again.
 *
 * **The numbers come from the file that was delivered, and that is the whole point
 * of the sheet.** A line that says what the request asked for is a promise; this
 * one says what is in the file, which is the only version of it a person can check.
 *
 * Nothing here says whether the file was downloaded or shared, because there is no
 * sentence for that in either language and a string written into a component is a
 * string no translator ever sees. The name is what identifies the file on both
 * systems, and on a phone the system's own share panel is the last thing the person
 * saw before this.
 */
export function ExportResultSheet({ attempt: pedido, onClose }: ExportResultSheetProps) {
  /*
    The last attempt there was, **not the one the caller is holding**.

    Same reason as every other sheet in this app — the caller says "closed" by
    handing over nothing, and a panel that takes itself out of the tree on that
    frame never plays the exit it is halfway through. Here it also covers the other
    direction: the caller starts a retry and the hook empties `result` and `error`
    as the attempt begins, so without this the panel would empty itself one frame
    after the retry button was pressed.
  */
  const attempt = useLastValue(pedido);

  const t = useTranslation();
  const theme = useTheme();

  if (!attempt) return null;

  const { result, error } = attempt;
  const counts = result ? countsLine(result.counts, t) : null;

  return (
    <Sheet
      visible={pedido !== null}
      onClose={onClose}
      title={t("export.title")}
    >
      <View
        style={{
          gap: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
        }}
      >
        {/*
          One of the two, and never both in a frame.

          `run` empties the result when an attempt starts, so a failure arrives
          with no numbers of a previous success next to it — and the order here is
          the second half of that guarantee: if one day it did, the failure is what
          gets painted, because the counts of the file that came out last time are
          not what happened in this attempt.
        */}
        {error ? (
          <AppText variant="body" tone="danger">
            {t(exportErrorKey(error) ?? "export.error.unknown")}
          </AppText>
        ) : result ? (
          <>
            {counts ? (
              <AppText variant="bodyStrong">{counts}</AppText>
            ) : null}
            {/*
              The name under the numbers, and the whole name: it is the thing the
              person has to find in their downloads, and a truncated one is a name
              they cannot search for. It is allowed to wrap onto a second line for
              that reason.
            */}
            <AppText variant="caption" tone="muted">
              {t("export.saved", { name: result.filename })}
            </AppText>
          </>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          {error ? (
            <Button label={t("export.retry")} fullWidth onPress={attempt.onRetry} />
          ) : null}
          {/*
            And the way out is always here, failed or not. On a failure the retry is
            the obvious thing to press and closing is the one people forget exists,
            and a button that only exists when things went well is a button that is
            missing at the moment somebody looks for it.
          */}
          <Button
            label={t("export.close")}
            variant={error ? "ghost" : "primary"}
            fullWidth
            onPress={onClose}
          />
        </View>
      </View>
    </Sheet>
  );
}

/**
 * The line of numbers, **and nothing at all when there is no envelope to read.**
 *
 * A CSV is rows: it has no envelope, so `counts` is `null` for it, and a line built
 * out of that `null` would be "0 lists · 0 items · 0 notes" — numbers the file does
 * not contain, printed as if it did. So the sheet says the name and nothing about
 * the amount, which is the truth about a CSV.
 *
 * The two shapes come from the same contract and are told apart by the one key the
 * account's counts have and a list's do not. `lists` is the sentence written for the
 * account — three kinds of thing, so three numbers — and a list is items and
 * nothing else, so it is the counted phrase.
 */
function countsLine(counts: ExportResult["counts"], t: Translate): string | null {
  if (!counts) return null;

  if ("lists" in counts) {
    return t("export.counts", {
      lists: counts.lists,
      items: counts.items,
      notes: counts.notes,
    });
  }

  return t(pluralKey("export.done", counts.items), { count: counts.items });
}
