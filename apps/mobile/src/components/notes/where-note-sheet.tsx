import { useState } from "react";
import { View } from "react-native";

import { Sheet } from "@/components/ui/sheet";
import { Pick, PlacePicker } from "@/components/workspace/place-picker";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface WhereNoteSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (place: { workspaceId: string; folderId: string | null }) => void;
}

/**
 * Where a note goes, when nothing says.
 *
 * It exists because a template follows the person and not a space: opened from the
 * notes list, or from anywhere outside a space, there is no folder it obviously
 * belongs to, and a note created "somewhere" is a note somebody will look for in
 * the wrong place. Asking is one tap for somebody with one space, and the only
 * honest answer for somebody with five.
 *
 * La decision vive en `PlacePicker` y esto es solo el cromo: el `Sheet`, el
 * titulo y el boton de confirmar. Sin colecciones, que aqui no existen.
 */
export function WhereNoteSheet({ visible, onClose, onPick }: WhereNoteSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  if (!visible) return null;

  const spaces = tree.spaces();

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t("note.where.title")}
      scrollable={false}
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <PlacePicker
          workspaceId={workspaceId}
          folderId={folderId}
          collectionId={null}
          showCollections={false}
          onChange={(place) => {
            setWorkspaceId(place.workspaceId);
            setFolderId(place.folderId);
          }}
        />

        {/*
          The one space is used without asking, and that is what the button being
          enabled means here. It was written as "disabled unless a space was
          picked", which greys out the only case where there is nothing to pick:
          somebody with a single space got a sheet asking them a question they had
          already answered, and then a button that would not do anything about it.
        */}
        <Pick
          icon="checkmark"
          label={t("note.where.create")}
          selected={false}
          disabled={spaces.length === 0}
          onPress={() => {
            const target = workspaceId ?? spaces[0]?.id ?? null;
            if (!target) return;
            onPick({ workspaceId: target, folderId });
          }}
        />
      </View>
    </Sheet>
  );
}
