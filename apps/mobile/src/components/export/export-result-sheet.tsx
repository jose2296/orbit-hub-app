import { View } from "react-native";

import type { ExportResult } from "@/hooks/use-export";
import type { ApiError } from "@/lib/api/client";
import { exportCountsLine } from "@/lib/export/counts";
import { exportErrorKey } from "@/lib/export/errors";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { Button } from "../ui/button";
import { Sheet, useLastValue } from "../ui/sheet";
import { AppText } from "../ui/text";

/** One settled attempt: what came out of it, or why nothing did. */
export interface ExportAttempt {
  /**
   * The delivered file, and the numbers read out of that same file.
   *
   * **`how` — whether it was downloaded or shared — is carried here and not
   * painted.** The field stays on the type because the delivery genuinely differs
   * between the web and a phone, and the day somebody needs to tell the two apart
   * this is where the answer is: it is decided in `saveExport` and it is the one
   * part of the result that says which system did the delivering. Until then it
   * has no sentence in either language, and inventing copy for it now would be a
   * string no translator ever sees — while the system has just said it anyway, in
   * its own download bar or its own share panel.
   */
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
  /**
   * What the panel is about, **and whose defaults to its own title.**
   *
   * `export.title` is "Export my data", which is right for the whole account and
   * wrong for one list — a panel that says it over a single list is telling the
   * person they got more than they asked for. So the list path passes the list's
   * own title, which is also the better answer in both cases: it is what the file
   * is about and what its name is built from.
   */
  title?: string;
  onClose: () => void;
}

/**
 * What an export left behind: how much, under what name, and — when it failed —
 * why, with the button to ask again.
 *
 * **The numbers come from the file that was delivered, and that is the whole point
 * of the sheet.** A line that says what the request asked for is a promise; this
 * one says what is in the file, which is the only version of it a person can check.
 * The sentence itself is `exportCountsLine`, in `lib/export`, because choosing which
 * figures get said is the part that is easy to get wrong and it is not the part
 * that is worth having untested.
 *
 * **A success is two lines and a way out, and that is all it is.** The system has
 * already said the file arrived — the browser's download bar, or the share panel it
 * opened itself — so this panel does not congratulate anybody: no tick, no "done",
 * no second announcement of the same event. It says how much came out, names the
 * file, and gets out of the way.
 *
 * That restraint is why the failure can afford to be loud. A red line and two
 * buttons is a very different panel from two lines and one, and a person who just
 * saw the difference is being told something rather than shown a dialog.
 */
export function ExportResultSheet({ attempt: pedido, title, onClose }: ExportResultSheetProps) {
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
  /*
    The numbers, and **the sentence that is empty when there is nothing to count.**

    A CSV has no envelope, so its `counts` is `null` and the line is `''`; the test
    on that empty string is the one that keeps a lone separator off the panel, and
    the component's part is not to draw a line for it — an empty `<AppText>` is
    still a line tall, so the condition is here and not only in the formatter.
  */
  const counts = result ? exportCountsLine(result.counts, t) : "";

  return (
    <Sheet
      visible={pedido !== null}
      onClose={onClose}
      title={title ?? t("export.title")}
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
          <View style={{ gap: 2 }}>
            {/*
              The numbers, in the weight the sheet is about, and the name under
              them in the weight a caption has. Two lines, and the second one is a
              caption because the file has already been announced by the system and
              this is the receipt, not the news.
            */}
            {counts ? <AppText variant="bodyStrong">{counts}</AppText> : null}
            {/*
              And the whole name, allowed to wrap: it is the thing the person has to
              find in their downloads, and a truncated one is a name they cannot
              search for. Which is also the only thing here that says where the file
              went, since the system's own panel said it once and then closed.
            */}
            <AppText variant="caption" tone="muted">
              {t("export.saved", { name: result.filename })}
            </AppText>
          </View>
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
