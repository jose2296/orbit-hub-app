import { useState } from "react";
import { View } from "react-native";

import { WorkspaceColorPicker } from "@/components/workspace/workspace-color-picker";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useTranslation } from "@/lib/i18n";
import { DEFAULT_WORKSPACE_COLOR } from "@/lib/workspace/color";
import { DEFAULT_WASH, type WashVariant } from "@/lib/workspace/wash";
import { useTheme } from "@/theme";

export interface WorkspaceCreateSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the new space, so the screen can go somewhere. */
  onCreated?: (workspaceId: string) => void;
}

/**
 * The form that makes a space, opened by the plus.
 *
 * It used to be the last card of the list, inline, with its own field and its own
 * save button. That put the *only* way to make a space at the bottom of a scroll,
 * below a list of the ones you already have: the form for something new was in the
 * least useful place on a screen whose whole job is the list you already have. And
 * it had no colour in it, so a space was born grey and had to be visited and
 * edited to become itself.
 *
 * Now the plus in the corner opens this, with the name and the colour together,
 * which is the same thing the menu of an existing space asks for: a space is a
 * name and a colour, and neither is a second thought.
 *
 * The colour starts on `slate` rather than on nothing, and the picker is right
 * there, so a space that is created and never edited still looks like something.
 */
export function WorkspaceCreateSheet({
  visible,
  onClose,
  onCreated,
}: WorkspaceCreateSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { createWorkspace } = useWorkspaces();

  const [name, setName] = useState("");
  // The picker's own types, not narrower ones. A colour is a name from the list
  // *or* a `#RRGGBB` the person wrote, and typing this state as the union of the
  // palette would say the second is impossible, which is the thing the picker is
  // for.
  const [color, setColor] = useState<string>(DEFAULT_WORKSPACE_COLOR);
  const [colorTo, setColorTo] = useState<string | null>(null);
  const [wash, setWash] = useState<WashVariant>(DEFAULT_WASH);
  const [saving, setSaving] = useState(false);

  // Starting from the last one used would be a kindness, except that the last one
  // is almost always the space you are standing in, and a new space that arrives
  // painted like its neighbour is a new space you cannot find. `slate` is the
  // colour that says "nothing chosen yet" without being empty.
  const canSave = name.trim().length > 0 && !saving;

  function reset() {
    setName("");
    setColor(DEFAULT_WORKSPACE_COLOR);
    setColorTo(null);
    setWash(DEFAULT_WASH);
  }

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0 || saving) return;

    setSaving(true);
    try {
      const id = await createWorkspace({
        name: trimmed,
        color,
        colorTo,
        wash,
      });
      reset();
      onClose();
      onCreated?.(id);
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("workspaces.create")}
      subtitle={t("workspaces.createBody")}
      scrollable
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.md,
        }}
      >
        <TextField
          value={name}
          onChangeText={setName}
          label={t("workspaces.nameLabel")}
          placeholder={t("workspaces.namePlaceholder")}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={() => {
            void save();
          }}
        />

        <WorkspaceColorPicker
          value={color}
          valueTo={colorTo}
          wash={wash}
          onPick={setColor}
          onPickTo={setColorTo}
          onPickWash={setWash}
        />

        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t("workspaces.create")}
            disabled={!canSave}
            fullWidth
            loading={saving}
            onPress={() => {
              void save();
            }}
          />
          <Button
            label={t("common.cancel")}
            variant="ghost"
            fullWidth
            onPress={() => {
              reset();
              onClose();
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}
