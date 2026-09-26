import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface RenameSheetProps {
  visible: boolean;
  /** What is being renamed, for the title of the panel. */
  title: string;
  /** The name it has now. */
  value: string;
  onClose: () => void;
  onRename: (name: string) => void;
}

/**
 * Renaming a list, a folder or a space.
 *
 * A panel and not a prompt on the page because the name is the one thing about
 * a thing that everything else hangs off: a link, a heading and a search all
 * use it, and renaming half way is worse than not renaming at all.
 *
 * It starts with the current name selected, because the usual reason to open it
 * is to change one letter, and making somebody select the whole word first is
 * work for nothing.
 */
export function RenameSheet({
  visible,
  title,
  value,
  onClose,
  onRename,
}: RenameSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [name, setName] = useState(value);

  useEffect(() => {
    if (visible) setName(value);
  }, [visible, value]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onRename(trimmed);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("rename.title", { what: title })}
      scrollable={false}
    >
      <View
        style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
      >
        <TextField
          value={name}
          onChangeText={setName}
          label={t("rename.field")}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t("rename.save")}
            onPress={submit}
            disabled={name.trim().length === 0}
            fullWidth
          />
          <Button
            label={t("common.cancel")}
            variant="ghost"
            onPress={onClose}
            fullWidth
          />
        </View>
      </View>
    </Sheet>
  );
}

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  /** What will happen, in one sentence, in the words of the thing. */
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}

/**
 * Asks before something that cannot be undone.
 *
 * Deleting is the only thing in the app that cannot be undone, so it is the only
 * thing that asks. The description says what happens to what is inside, because
 * "delete folder" says nothing about the lists in it and that is the part
 * people get wrong.
 */
export function ConfirmSheet({
  visible,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  busy = false,
}: ConfirmSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Sheet visible={visible} onClose={onClose} title={title} scrollable={false}>
      <View
        style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
      >
        <ConfirmBody description={description} />
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={confirmLabel}
            variant="danger"
            onPress={() => {
              onConfirm();
              onClose();
            }}
            loading={busy}
            fullWidth
          />
          <Button
            label={t("common.cancel")}
            variant="ghost"
            onPress={onClose}
            fullWidth
          />
        </View>
      </View>
    </Sheet>
  );
}

function ConfirmBody({ description }: { description: string }) {
  const t = useTranslation();
  return (
    <View>
      <AppText variant="body">{description}</AppText>
      <AppText variant="caption" tone="subtle">
        {t("confirm.irreversible")}
      </AppText>
    </View>
  );
}
