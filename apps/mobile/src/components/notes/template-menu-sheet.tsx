import type { NoteTemplate } from "@orbit-hub/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Sheet, SheetOptions, type SheetOption, useLastValue } from "@/components/ui/sheet";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import {
  canEditTemplate,
  publishNoteTemplate,
  removeNoteTemplate,
  shareNoteTemplate,
  unpublishNoteTemplate,
  updateNoteTemplate,
} from "@/hooks/use-note-templates";
import { useSession } from "@/hooks/use-session";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * What you can do to a template that is not being typed into.
 *
 * The same shape as `NoteMenuSheet` and deliberately not the same component: a
 * template is not a note, it belongs to somebody, and the two have one row in
 * common and two that have nothing to do with each other. Sharing the component
 * would mean a `Note | NoteTemplate` union in every handler, and a menu that
 * offers "borrar la nota" over a template is a bug waiting for a name.
 *
 * There is no "fijar" here. Templates are not things you look at often enough to
 * want near you — they are a starting point, and the starting point is reached
 * through this screen, not through a panel.
 */
export interface TemplateMenuSheetProps {
  template: NoteTemplate | null;
  onClose: () => void;
  onChanged?: (template: NoteTemplate) => void;
  onDeleted?: (template: NoteTemplate) => void;
  onFailed?: (message: string) => void;
}

type Step = "menu" | "rename" | "share";

export function TemplateMenuSheet({
  template: pedido,
  onClose,
  onChanged,
  onDeleted,
  onFailed,
}: TemplateMenuSheetProps) {
  /*
    `template` is **the last one, and not the one the caller is holding** — and that
    difference is the whole fix.

    A sheet of options was written as `if (!template) return null`: the caller says the
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
    `template` is **the last one, and not the one the caller is holding** — and that
    difference is the whole fix.

    A sheet of options was written as `if (!template) return null`: the caller says the
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
  const template = useLastValue(pedido);

  const theme = useTheme();
  const t = useTranslation();
  const { user } = useSession();

  const [step, setStep] = useState<Step>("menu");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  // Re-seeded on every open, so the box holds this template's words and not the
  // ones somebody typed into another one ten minutes ago.
  useEffect(() => {
    if (template) {
      setStep("menu");
      setName(template.name);
      setDescription(template.description);
      setBusy(false);
    }
  }, [template?.description, template?.id, template?.name]);

  const close = useCallback(() => {
    setStep("menu");
    onClose();
  }, [onClose]);

  const save = useCallback(async () => {
    if (!template || busy) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    setBusy(true);
    try {
      const changed = await updateNoteTemplate(
        template.id,
        { name: trimmed, description: description.trim() },
        template.version,
      );
      // The server's copy, and not the fields typed above: it carries the version
      // the next save is based on, and a screen that kept its own would send a
      // version that has moved on and be told so by its own account.
      onChanged?.(changed);
      setStep("menu");
    } catch {
      onFailed?.(t("note.template.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [busy, description, name, onChanged, onFailed, t, template]);

  const remove = useCallback(async () => {
    if (!template || busy) return;
    setBusy(true);
    try {
      await removeNoteTemplate(template.id);
      onDeleted?.(template);
      onClose();
    } catch {
      onFailed?.(t("note.template.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }, [busy, onClose, onDeleted, onFailed, t, template]);

  if (!template) return null;

  if (step === "rename") {
    return (
      <Sheet
        visible={pedido !== null}
        onClose={close}
        title={t("note.template.rename")}
        scrollable
      >
        <View style={{ gap: theme.spacing.md }}>
          <TextField
            value={name}
            onChangeText={setName}
            label={t("note.template.name")}
            placeholder={t("note.templateName")}
            autoCapitalize="sentences"
            autoFocus
          />
          <TextField
            value={description}
            onChangeText={setDescription}
            label={t("note.template.description")}
            placeholder={t("note.template.description")}
            autoCapitalize="sentences"
          />
          <SheetOptions
            options={[
              {
                key: "save",
                label: busy ? t("common.saving") : t("common.save"),
                icon: "checkmark",
                tone: "accent",
                disabled: name.trim().length === 0 || busy,
                onPress: () => void save(),
              },
              { key: "cancel", label: t("common.cancel"), onPress: close },
            ]}
          />
        </View>
      </Sheet>
    );
  }

  if (step === "share") {
    return (
      <ShareStep
        template={template}
        busy={busy}
        onBack={() => setStep("menu")}
        onShare={async (input) => {
          setBusy(true);
          try {
            onChanged?.(await shareNoteTemplate(template.id, input));
            setStep("menu");
          } catch {
            onFailed?.(t("note.template.shareFailed"));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  /**
   * Who can share it, and what that means.
   *
   * Only the author. Somebody who was sent the template may well be the person
   * best placed to tell the team about it, but sharing is a decision about other
   * people's screens and the server draws that line at the author; offering the
   * row to somebody else would be a button that always refuses.
   */
  const isAuthor = template.createdBy === user?.id;

  const published = template.scope === "public";

  const opciones: SheetOption[] = [
    {
      key: "rename",
      label: t("note.template.rename"),
      icon: "create-outline",
      disabled: busy,
      onPress: () => setStep("rename"),
    },
    ...(isAuthor
      ? [
          {
            key: "share",
            label:
              template.scope === "workspace"
                ? t("note.template.unshare")
                : t("note.template.share"),
            icon:
              template.scope === "workspace"
                ? ("lock-closed-outline" as const)
                : ("people-outline" as const),
            disabled: busy,
            onPress: () => setStep("share"),
          },
          {
            /*
              Publishing, and it is a row of its own rather than a third option in
              the share sheet, because it is not "the same thing, wider". Sharing
              puts the template in a space where the team can correct its words;
              publishing puts it in front of strangers who can start a note with it
              and change nothing. One decision is about who can help you fix it and
              the other is about who can see it, and a menu that makes them two
              taps of the same list teaches people they are a size setting.
             */
            key: "publish",
            label: published
              ? t("note.template.unpublish")
              : t("note.template.publish"),
            icon: published
              ? ("globe-outline" as const)
              : ("earth-outline" as const),
            disabled: busy,
            onPress: () => {
              setBusy(true);
              const call = published
                ? unpublishNoteTemplate
                : publishNoteTemplate;
              void call(template.id)
                .then((changed) => onChanged?.(changed))
                .catch(() => onFailed?.(t("note.template.publishFailed")))
                .finally(() => setBusy(false));
            },
          },
        ]
      : []),
    {
      key: "delete",
      label: t("note.template.delete"),
      icon: "trash-outline",
      tone: "danger",
      disabled: busy,
      onPress: () => void remove(),
    },
  ];

  return (
    <Sheet visible onClose={close} title={template.name} scrollable={false}>
      <SheetOptions options={opciones} />
      {canEditTemplate(template, user?.id) ? null : (
        /*
          The one case where this sheet says something rather than offering
          something. A template you cannot change — the app's own, or somebody
          else's published — and a screen that silently refused to save would look
          broken. Which of the two it is matters, so it says which.
        */
        <AppText
          variant="caption"
          tone="muted"
          style={{ marginTop: theme.spacing.md }}
        >
          {template.builtInKey
            ? t("note.template.builtInBody")
            : t("note.template.someoneElsesBody")}
        </AppText>
      )}
    </Sheet>
  );
}

/**
 * The spaces a template can be put in.
 *
 * A list and not a field, because a person with five spaces cannot be asked to
 * type an id and a person with one should not have to read a list of one to find
 * the answer. And the first row is always taking it back, because a template
 * somebody has already shared is the one case where the person opening this sheet
 * is most likely to want the other action.
 */
function ShareStep({
  template,
  busy,
  onBack,
  onShare,
}: {
  template: NoteTemplate;
  busy: boolean;
  onBack: () => void;
  onShare: (input: {
    scope: "personal" | "workspace";
    workspaceId?: string;
  }) => Promise<void>;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();
  const spaces = useMemo(() => tree.spaces(), [tree]);

  const isShared = template.scope === "workspace";

  return (
    <Sheet
      visible
      onClose={onBack}
      title={t("note.template.chooseSpace")}
      scrollable={false}
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <AppText variant="caption" tone="muted">
          {t("note.template.shareBody")}
        </AppText>

        <View style={{ gap: 2 }}>
          {isShared ? (
            <SpaceRow
              icon="lock-closed-outline"
              label={t("note.template.takeBack")}
              selected
              disabled={busy}
              onPress={() => void onShare({ scope: "personal" })}
            />
          ) : null}

          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
            <View style={{ gap: 2 }}>
              {spaces.map((space) => (
                <SpaceRow
                  key={space.id}
                  icon="grid-outline"
                  label={space.name}
                  selected={false}
                  disabled={busy}
                  onPress={() =>
                    void onShare({ scope: "workspace", workspaceId: space.id })
                  }
                />
              ))}
            </View>
          </ScrollView>

          {spaces.length === 0 ? (
            <AppText variant="caption" tone="muted">
              {t("note.where.noSpaces")}
            </AppText>
          ) : null}
        </View>

        <Pressable onPress={onBack} accessibilityRole="button">
          <AppText variant="body" tone="muted">
            {t("common.cancel")}
          </AppText>
        </Pressable>
      </View>
    </Sheet>
  );
}

function SpaceRow({
  icon,
  label,
  selected,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 40,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.md,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: selected
          ? theme.colors.accentSoft
          : pressed
            ? theme.colors.surfaceMuted
            : "transparent",
      })}
    >
      <Ionicons
        name={icon as never}
        size={16}
        color={selected ? theme.colors.accent : theme.colors.textMuted}
      />
      <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}
