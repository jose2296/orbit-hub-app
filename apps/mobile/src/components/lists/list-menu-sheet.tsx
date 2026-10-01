import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import type { Folder, List } from "@orbit-hub/contracts";

import { ShareNodeForm } from "@/components/shares/share-node-sheet";
import { SharedBadge } from "@/components/shares/shared-badge";
import { useDashboard } from "@/hooks/use-dashboard";
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

import { Button } from "../ui/button";
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
 * Renaming and deleting are **pages of this same panel** and not panels of their
 * own. A panel on top of a panel is two backdrops over one screen, and a tap
 * that reaches the wrong one closes what is underneath instead of doing what was
 * asked. One panel whose content changes has neither problem.
 */
type Page = "options" | "rename" | "share" | "delete";

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

    So the value that is drawn is the last one there was — declared here, at the
    top, so that everything below keeps the name it always had and now has a value
    that cannot be null — and the caller's own argument, which goes to `null` at
    once, is what `visible` is asked from. The panel keeps its identity while it
    leaves, and the dismissal is a movement instead of a cut.
  */
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

  // Reopening the menu always starts at the options, whatever page it was left
  // on: a menu that opens in the middle of a flow is a menu that surprises.
  useEffect(() => {
    if (list) {
      setPage("options");
      setName(list.title);
      // Armed when the panel opens rather than when delete is pressed, so the
      // sentence about other people's phones is already there by the time anybody
      // reads the confirmation.
      setReached(true);
    }
  }, [list]);

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

  const subtitle =
    page === "options"
      ? `${t(LIST_KIND_LABEL[list.kind])}${folder ? ` · ${folder.name}` : ""}`
      : page === "rename"
        ? t("rename.title", { what: t(LIST_KIND_LABEL[list.kind]) })
        : page === "share"
          ? t("share.subtitle", { name: list.title })
          : t("lists.deleteTitle", { what: list.title });

  return (
    <Sheet
      visible={pedido !== null}
      onClose={onClose}
      title={list.title}
      subtitle={subtitle}
      scrollable={false}
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
              <Button
                label={t("common.cancel")}
                variant="ghost"
                fullWidth
                onPress={() => setPage("options")}
              />
            </View>
          </View>
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
              <Button
                label={t("common.cancel")}
                variant="ghost"
                fullWidth
                onPress={() => setPage("options")}
              />
            </View>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
