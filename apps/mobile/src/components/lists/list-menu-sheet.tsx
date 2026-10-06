import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import type { ExportFormat, Folder, List } from "@orbit-hub/contracts";

import { ExportResultSheet } from "@/components/export/export-result-sheet";
import { ShareNodeForm } from "@/components/shares/share-node-sheet";
import { SharedBadge } from "@/components/shares/shared-badge";
import { useDashboard } from "@/hooks/use-dashboard";
import { useExport } from "@/hooks/use-export";
import type { ExportRequest } from "@/hooks/use-export";
import { useLists } from "@/hooks/use-lists";
import { useShareReach } from "@/hooks/use-shares";
import {
  isPinned,
  withPinnedList,
  withoutPinnedList,
} from "@/lib/dashboard/pin";
import { LIST_KIND_LABEL } from "@/lib/lists/kind";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { IconPickerPanel } from "../ui/icon-picker-sheet";
import { Sheet, SheetOptions, useLastValue } from "../ui/sheet";
import type { SheetOption } from "../ui/sheet";
import { AppText } from "../ui/text";
import { TextField } from "../ui/text-field";

export interface ListMenuSheetProps {
  list: List | null;
  folder: Folder | null;
  onClose: () => void;
  onDeleted?: () => void;
}

/**
 * What can be done with a list.
 *
 * The same handful of things in the same order wherever the menu is opened from,
 * because a menu that reads differently in two places is two menus to learn. It
 * is a panel and not a row of icons because "mark as favourite" and "delete"
 * sitting next to each other as two identical circles is a mistake waiting to
 * happen.
 *
 * Delete is last and it says how many things go with it. Everything else here
 * can be undone by opening the menu again, and the one that cannot asks first.
 *
 * Renaming, sharing and deleting are **pages of this same panel** and not panels of
 * their own. A panel on top of a panel is two backdrops over one screen, and a tap
 * that reaches the wrong one closes what is underneath instead of doing what was
 * asked. One panel whose content changes has neither problem.
 *
 * Choosing the format is such a page too — it is two rows and it answers at once.
 * Reporting the export is not, and that is the one exception here: the answer
 * arrives seconds later, when the file exists, and the panel that chooses the format
 * has been gone for all of it. It is a second panel that comes up afterwards, and
 * the argument above does not reach a thing that has no answer yet.
 */
type Page = "options" | "rename" | "icon" | "share" | "export" | "delete";

export function ListMenuSheet({
  list: pedido,
  folder,
  onClose,
  onDeleted,
}: ListMenuSheetProps) {
  /*
    `list` is **the last one, and not the one the caller is holding** — and that
    difference is the whole fix.

    A sheet of options was written as `if (!list) return null`: the caller says the
    menu is closed by handing over nothing, and the component does the obvious thing
    with nothing — which takes the sheet, and the exit it is in the middle of, out
    of the tree on the very frame the dismissal is asked for. Measured on the web,
    the panel was gone **forty-five milliseconds** after the cross, and the quarter
    of a second it was supposed to travel down was never on screen.

    So the value that is drawn is the last one there was, and the caller's own
    argument — which goes to `null` at once, because that is how a caller says "close"
    — is what `visible` is asked from. The panel keeps its identity while it leaves,
    and the dismissal is a movement instead of a cut.

    **The prop keeps its name and only the local is new.** Renaming what the caller
    passes would be six call sites later, for a change nobody outside this file can
    see.
  */
  const list = useLastValue(pedido);

  const theme = useTheme();
  const t = useTranslation();
  const { updateList, deleteList, duplicateList } = useLists({});
  const { layout, save } = useDashboard();
  /*
    The export, and **the whole of its outcome — because a failure nobody is told
    about is a bug and not a design.**

    The panel is gone long before the file is: the request goes out behind it, the
    download bar or the share panel answers the press, and neither of those knows
    how to say "it failed" or "here are the numbers". So this panel does not end at
    `run` — it hands the settled attempt to the same result sheet Settings opens,
    mounted below, and a list that exports nothing says so instead of going quiet.

    The three states of the hook are read where they are drawn, so the sheet gets
    the attempt that just settled and never one from before it.
  */
  const { run, result, error, running } = useExport();
  /*
    And whether one is already on its way, **in a ref and not in state.**

    The two format rows stay on screen — and stay pressable — for the quarter of a
    second this panel spends leaving, and on a wide screen where the panel only
    fades and does not travel, a second tap lands on the same row. That is a second
    download of the same list and, on a phone, a share panel over the first one. A
    ref is read when the press happens and not when the handler was built, so it
    also covers a press on a panel that is already halfway out.
  */
  const exporting = useRef(false);
  /**
   * The request of the attempt on screen, **held so the retry is the same ask.**
   *
   * Same as in the Settings row, and for the same reason: the format is part of the
   * request, and a retry that rebuilt it would be asking for something else — a CSV
   * that failed and comes back as a JSON. One object, sent again.
   */
  const request = useRef<ExportRequest | null>(null);
  /**
   * Whether the result sheet is up.
   *
   * Its contents are not state of their own: they are the hook's, read where they
   * are drawn. What is state is only "the attempt has settled", because that is the
   * moment the file is on disk — opening on the press instead would put a panel on
   * screen with nothing in it for the seconds a large list takes.
   */
  const [showing, setShowing] = useState(false);
  // Asked when the panel opens, and only then: the answer changes if somebody
  // shares the list in another tab, and there is no delete in flight to be wrong
  // about. `null` while asking, and also when the server could not be reached, so
  // a failed request never says "nobody else has this".
  const [reached, setReached] = useState(false);
  const reach = useShareReach(
    reached && list ? { nodeType: "list", nodeId: list.id } : null,
  );

  const [page, setPage] = useState<Page>("options");
  const [name, setName] = useState(list?.title ?? "");

  /**
   * Whether the menu is open, **and the edge that everything below hangs off.**
   *
   * Reopening always starts at the options, whatever page it was left on: a menu
   * that opens in the middle of a flow is a menu that surprises. The reset hangs
   * off **the open edge and not on the list**, and that is not a style choice.
   *
   * Keyed on `list`, this stopped working the moment the menu stopped unmounting on
   * close, and it failed in the worst way it could. `list` is `useLastValue(pedido)`,
   * which **freezes while `pedido` is `null`** — that is its whole purpose, it is
   * what keeps the panel alive during its dismissal. So its identity only changes
   * when a *different* list arrives, and reopening the *same* one hands back the
   * same object: the store hook holds `List[]` in state, so a re-render passes a
   * referentially stable row. The effect did not fire, and the menu opened on the
   * format page the export left it on, with the rename field still holding the old
   * name. It read as a menu that had lost its place, which is the sentence this
   * comment exists to prevent.
   *
   * So this is the second time this file has been bitten by the difference between
   * unmounting and surviving, and the difference is never visible where it is
   * written: the first was the export state dying with an unmount, this one is the
   * same freeze taken away. **Anything that has to happen when the menu opens
   * belongs to `abierto`, and nothing that has to happen when a list changes
   * belongs here** — that is a different question and it is not this one.
   */
  const abierto = pedido !== null;

  useEffect(() => {
    if (!abierto) return;
    setPage("options");
    // The caller's own list and not `list`: this runs on the frame it arrives, and
    // `pedido` is the value that arrived with it.
    setName(pedido?.title ?? "");
    // Armed when the panel opens rather than when delete is pressed, so the
    // sentence about other people's phones is already there by the time anybody
    // reads the confirmation.
    setReached(true);
    /*
      And the sheet of results is put away as the menu opens, **so a sheet left
      over from an earlier export cannot greet whoever opened this one.**

      It is `abierto` and not "the list changed" that is safe here, and the
      difference is the whole reason this effect had to move: closing the menu does
      not reset anything, because `onClose()` has already run by the time the
      attempt settles and this effect cannot fire on the way back up — the panel
      closing is not the panel opening. The result sheet comes up afterwards, on a
      menu that is still closed, exactly as it should.
    */
    setShowing(false);
  }, [abierto]);

  const pinned = list ? isPinned(layout, list.id) : false;

  const options: SheetOption[] = useMemo(() => {
    if (!list) return [];
    return [
      {
        key: "rename",
        label: t("common.rename"),
        icon: "create-outline",
        onPress: () => {
          setName(list.title);
          setPage("rename");
        },
      },
      {
        key: "pin",
        label: pinned
          ? t("lists.unpinFromDashboard")
          : t("lists.pinToDashboard"),
        icon: pinned ? "remove-circle-outline" : "apps-outline",
        description: t("lists.pinHint"),
        onPress: () => {
          onClose();
          void save(
            pinned
              ? withoutPinnedList(layout, list.id)
              : withPinnedList(layout, list),
          );
        },
      },
      {
        key: "duplicate",
        label: t("lists.duplicate"),
        icon: "copy-outline",
        description: t("lists.duplicateHint"),
        onPress: () => {
          onClose();
          void duplicateList(list);
        },
      },
      // Only for somebody who may decide who else sees it. Editing fifty rows is
      // not deciding that a sixth person sees them — and neither is being an editor
      // of the space the list lives in, because the list belongs to whoever owns
      // that space. The comment here said "owner" for years while the code below it
      // said `owner || editor`, and the code is what ran.
      ...(list.role === "owner"
        ? [
            {
              key: "share",
              label: t("share.title", { name: list.title }),
              icon: "people-outline" as const,
              // The description is the "not a copy" line, because this is the one
              // option on the menu whose consequences are not visible afterwards.
              // Somebody who is about to hand a colleague the ability to edit a real
              // list should read that before pressing it, not discover it later.
              description: t("share.isALink"),
              onPress: () => setPage("share"),
            },
          ]
        : []),
      {
        /*
         * A copy of the list, and not of the account: the account copy is a row in
         * Settings and it is one button, because there is only one format for it.
         * Here there are two, and the difference is a whole afternoon for whoever
         * ends up holding the file — a JSON envelope they need a parser to read, or
         * a table they can open.
         *
         * So these are `export.list.*` and not `export.*`. The account's own
         * strings say "all your content", and over a single list that is a sentence
         * about the wrong thing twice over: the person is told they exported more
         * than they did, and the description promises JSON on a page that offers
         * CSV as well. The sheet of results already draws this same line about
         * `export.title`; this row is where it bit.
         */
        key: "export",
        label: t("export.list.title"),
        icon: "download-outline",
        description: t("export.list.body"),
        onPress: () => setPage("export"),
      },
      {
        /*
         * Same rule as the note menu: a list you were lent is not yours to erase, and
         * a delete would take it from the person who made it rather than from you.
         */
        key: "delete",
        label: list.shared ? t("common.deleteNotYours") : t("common.delete"),
        icon: "trash-outline",
        tone: "danger",
        description: list.shared
          ? t("common.deleteNotYoursHint")
          : t("lists.deleteBody", { count: list.itemCount }),
        disabled: list.shared,
        onPress: () => setPage("delete"),
      },
    ];
  }, [list, pinned, layout, t, onClose, duplicateList, save]);

  if (!list) return null;

  /**
   * Sending one export request, **and the only place in this file that sends one.**
   *
   * `onClose()` before `run` and not after, in the same order `duplicateList` above
   * does it: the panel leaves and the work goes on behind it. A panel that waits on
   * a multi-megabyte file is a panel that looks frozen, and on a phone that wait is
   * measured in tens of seconds.
   *
   * And the panel goes down **and comes back**, once the attempt has settled, with
   * the numbers or the reason. Not a toast and not a new component: the same result
   * sheet Settings opens, mounted below, because a sheet that says what came out is
   * the only thing in this app that can tell a person the export worked.
   *
   * The `finally` and not the end of the `try`, because `run` swallows its own
   * failures —this is what makes it the right shape for a panel to be left in, and
   * the two have to agree or a rethrow here would strand the sheet closed.
   */
  const exportar = async (args: ExportRequest) => {
    if (exporting.current) return;
    exporting.current = true;
    request.current = args;

    onClose();
    try {
      await run(args);
    } finally {
      exporting.current = false;
      setShowing(true);
    }
  };

  /**
   * The request for this list in this format, **built from the list this panel is
   * showing** and not from the caller's argument: the title that names the file — and
   * the id that names it when the title leaves nothing usable — are that list's, not
   * whatever the screen behind has moved on to while the panel was on its way out.
   */
  const requestFor = (format: ExportFormat): ExportRequest => ({
    path: `/lists/${list.id}/export`,
    format,
    title: list.title,
    fallbackId: list.id,
  });

  /**
   * The same request again, **and the very same object.**
   *
   * Reached from the sheet of results, which is the one place a failure can be
   * answered. It re-sends `request.current` and does not rebuild it, which is the
   * whole point: rebuilding would pick up the list's *current* title, so a retry
   * after a rename would be a request for a different file — and a format passed
   * back through `requestFor` would lose the format that failed, turning a CSV into
   * a JSON because JSON is the first row.
   */
  const reintentar = () => {
    const anterior = request.current;
    if (!anterior) return;
    void exportar(anterior);
  };

  /**
   * The two formats, **and in that order.**
   *
   * JSON first because it is the copy: everything the list has, in a form that can
   * be read back. CSV second because it is the one that gets opened in a
   * spreadsheet, and a person who is already in a spreadsheet is looking for that
   * one and not for the other.
   *
   * **Disabled while one is in flight**, which is the only way this page can be on
   * screen during an export at all: the panel closes before the request, so the way
   * back here is to open the menu again mid-download. `exporting` is a ref and this
   * is a render, so it cannot be read here — a ref read during render is the value
   * of the last render, and by the time the person presses anything the answer has
   * moved. `running` is the same fact as state, so it re-renders the panel when it
   * changes and the rows grey out under the finger instead of swallowing the press
   * with nothing on screen to say why.
   */
  const formats: SheetOption[] = [
    {
      key: "json",
      label: t("export.format.json"),
      icon: "code-slash-outline",
      disabled: running,
      onPress: () => void exportar(requestFor("json")),
    },
    {
      key: "csv",
      label: t("export.format.csv"),
      icon: "grid-outline",
      disabled: running,
      onPress: () => void exportar(requestFor("csv")),
    },
  ];

  const subtitle =
    page === "options"
      ? `${t(LIST_KIND_LABEL[list.kind])}${folder ? ` · ${folder.name}` : ""}`
      : page === "rename"
        ? t("rename.title", { what: t(LIST_KIND_LABEL[list.kind]) })
        : page === "icon"
          ? t("icons.title")
          : page === "share"
          ? t("share.subtitle", { name: list.title })
          : page === "export"
            ? /*
                The format, or the wait — **because the panel can be reopened while
                the file is still coming.**

                The rows are disabled in that state and a greyed-out pair of rows
                with no explanation is a broken menu. `export.running` is the same
                sentence Settings puts under its own row for the same reason, and it
                is the only thing here that tells the person the press did land and
                was not lost.
              */
              (running ? t("export.running") : t("export.format"))
            : t("lists.deleteTitle", { what: list.title });

  return (
    /*
      Two panels, and **one of them at a time as a rule, not as a guarantee.**

      They are siblings and not one inside the other because `Sheet` is a `Modal`,
      and a `Modal` inside a `Modal` is a panel on top of a panel — the thing this
      file's own header argues against, and worse, because the inner one is not
      dismissible by anything that is not on top of it.

      **What is guaranteed is one thing only: the request never starts with the
      menu up.** `exportar` calls `onClose()` before `run`, so `pedido` is `null`
      and the menu's `visible` is false before a byte moves.

      **What is not guaranteed is that the result sheet finds the menu down when it
      settles.** Two paths put them together, and neither is exotic:

        - The menu can be reopened while the download is still in flight — the
          format rows are `disabled` precisely because that is reachable. Opening it
          makes `abierto` true again, which fires the effect above and clears
          `showing`; when the attempt settles, `setShowing(true)` in `exportar`'s
          `finally` runs with the menu open, and the result sheet mounts over a
          live `Sheet`.

        - And even without that, `Sheet` keeps its `Modal` mounted for a few
          hundred milliseconds after `visible` goes false — staying alive through
          the dismissal is the whole point of `useLastValue`, and of the fix written
          at the top of this file. A fast export settles inside that window, so the
          leaving and the arriving panels overlap on purpose.

      The overlap is cosmetic: the arriving panel covers the leaving one and
      nothing is left unreachable, and both paths predate the last round of fixes
      to this feature. **It is written down here because this comment used to claim
      the opposite** — "they are never both up" — inside the very argument the
      header of this file makes about stacked panels, and a false invariant in the
      one place that argues against them is worse than the overlap it denies.

      Skipping `setShowing(true)` when the menu is open would remove the overlap and
      would also **throw the report away**, and this file's own reason for having a
      result sheet at all is that a failure nobody is told about is a bug and not a
      design. Closing the menu and showing the sheet afterwards keeps both and is a
      one-line change to `exportar` — but it is behaviour, and behaviour is verified
      by hand on the web, so it is a decision to make on purpose and not one a
      comment quietly makes.
    */
    <>
      <Sheet
        visible={pedido !== null}
        onClose={onClose}
        title={list.title}
        subtitle={subtitle}
        scrollable={false}
        onBack={
          /*
           * The arrow, on every page that is not the first, and **the ✕ stays as it
           * was**: it closes the sheet, which is what it did before and what the
           * ✕ of a sheet means everywhere else in the app. Two exits, two jobs, and
           * the header says which is which.
           *
           * This is what the export page was missing. It had nothing but `options`
           * in it — no form, no cancel — so the only way out was the ✕, which threw
           * away the panel instead of going back to it.
           */
          page === "options" ? undefined : () => setPage("options")
        }
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.sm,
          }}
        >
          {page === "options" ? (
            <>
              {/*
                Whether it is yours or it was handed to you, and whether you can
                change it — above the options, because two of them (share, and the
                delete that asks who else has it) mean something different depending on
                the answer, and you should not have to tap one to find out which.
              */}
              <SharedBadge shared={list.shared} role={list.role} />

              {list.description ? (
                <AppText variant="body" tone="muted" numberOfLines={2}>
                  {list.description}
                </AppText>
              ) : null}
              <SheetOptions options={options} />
            </>
          ) : null}

          {page === "rename" ? (
            <View style={{ gap: theme.spacing.md }}>
              <TextField
                value={name}
                onChangeText={setName}
                label={t("rename.field")}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  const trimmed = name.trim();
                  if (!trimmed) return;
                  onClose();
                  void updateList(list, { title: trimmed });
                }}
              />
              {/* The icon lives here, next to the name, because a list is the
                  thing an icon is a property of and this is where you go to
                  change a list. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("icons.title")}
                onPress={() => setPage("icon")}
                style={({ pressed }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: theme.spacing.md,
                    borderColor: theme.colors.border,
                    borderWidth: 1,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <AppIcon icon={list.icon} size={20} />
                <AppText variant="body" style={{ flex: 1 }}>
                  {t("icons.title")}
                </AppText>
              </Pressable>
              <View style={{ gap: theme.spacing.sm }}>
                <Button
                  label={t("rename.save")}
                  disabled={name.trim().length === 0}
                  fullWidth
                  onPress={() => {
                    const trimmed = name.trim();
                    if (!trimmed) return;
                    onClose();
                    void updateList(list, { title: trimmed });
                  }}
                />
                {/*
                  No "Cancelar" under it any more. It went back one page, and the
                  arrow in the header does the same thing and says so — two controls
                  for one job, one of them called "Cancel" while it was actually
                  "Back". What stays under the button is nothing: the arrow is the
                  way out of this page, and it is in the same place on every page.
                */}
              </View>
            </View>
          ) : null}

          {page === "icon" ? (
            <IconPickerPanel
              current={list.icon}
              onSelect={(icon) => void updateList(list, { icon })}
            />
          ) : null}

          {/*
            "Compartir" is a page of this panel and not a sheet of its own. Two
            panels on one screen is two backdrops, and a tap that reaches the wrong
            one closes what is underneath instead of doing what was asked.
          */}
          {page === "share" ? (
            <ShareNodeForm
              target={{ nodeType: "list", nodeId: list.id, title: list.title }}
              onDone={() => onClose()}
            />
          ) : null}

          {page === "export" ? <SheetOptions options={formats} /> : null}

          {page === "delete" ? (
            <View style={{ gap: theme.spacing.md }}>
              <AppText variant="body">
                {t("lists.deleteBody", { count: list.itemCount })}
              </AppText>

              {/*
                How many people it disappears from, and who.

                Only when there is somebody. A delete that always shows this, even with
                nobody, teaches people to read past the red box and then it is the one
                time it mattered.
              */}
              {reach && reach.count > 0 ? (
                <View
                  style={{
                    gap: theme.spacing.xs,
                    padding: theme.spacing.md,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.danger,
                  }}
                >
                  <AppText
                    variant="callout"
                    style={{ color: theme.colors.danger }}
                  >
                    {t("share.reachBody", { count: reach.count })}
                  </AppText>
                  <AppText variant="caption" tone="subtle">
                    {t("share.reachPeople")}
                  </AppText>
                  {reach.people.map((person) => (
                    <AppText
                      key={person.userId}
                      variant="caption"
                      tone="muted"
                      numberOfLines={1}
                    >
                      {person.email}
                    </AppText>
                  ))}
                </View>
              ) : null}

              <AppText variant="caption" tone="subtle">
                {t("confirm.irreversible")}
              </AppText>
              <View style={{ gap: theme.spacing.sm }}>
                <Button
                  label={t("lists.deleteConfirm")}
                  variant="danger"
                  fullWidth
                  onPress={() => {
                    onClose();
                    void deleteList(list);
                    onDeleted?.();
                  }}
                />
                {/* As on the rename page: the arrow in the header is the way back, and it says
                  "Volver" instead of "Cancelar" while doing the same thing. */}
            </View>
          </View>
        ) : null}
        </View>
      </Sheet>

      {/*
        What came out of the export, or why nothing did — and **the only thing in
        the app that can say either.**

        Built from the hook's own state where it is drawn, so the panel shows the
        attempt that just settled and never one from before it, and the retry it
        carries re-sends the request that failed instead of building a new one.

        **The title is the exported list and not the list on screen**, and it comes
        out of the request because that is where the name of the file came from: if
        the export settled after somebody navigated to another list, a title read
        from `list` would be the wrong list's name over the right list's numbers.
      */}
      <ExportResultSheet
        attempt={showing ? { result, error, onRetry: reintentar } : null}
        title={request.current?.title}
        onClose={() => setShowing(false)}
      />
    </>
  );
}
