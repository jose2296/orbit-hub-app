import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { Sheet } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { PlacePicker } from "@/components/workspace/place-picker";
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
 * titulo y el Guardar del pie. Sin colecciones, que aqui no existen.
 */
export function WhereNoteSheet({ visible, onClose, onPick }: WhereNoteSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();
  const { setSucio } = useSheetSucio();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  /*
    Limpio al abrir, y **aunque antes recordaba**.

    Una hoja nunca llega sucia: abrir, no tocar nada y salir no debe preguntar
    "lo pierdes" por una eleccion de la vez anterior.
  */
  useEffect(() => {
    if (visible) {
      setWorkspaceId(null);
      setFolderId(null);
    }
  }, [visible]);

  const spaces = useMemo(() => tree.spaces(), [tree]);

  /*
    Sucio es **haber elegido sitio**, y nada mas.

    Moverse por espacios y carpetas es mirar, no elegir: solo el destino cuenta.
    Y sin destino no hay nada que perder, que es justo el estado en el que se abre.

    The one space is used without asking: with a single space the destination is
    already decided, so Guardar is enabled whenever there is a space at all.
  */
  const destino = workspaceId ?? spaces[0]?.id ?? null;
  useEffect(() => {
    setSucio(workspaceId !== null || folderId !== null);
  }, [workspaceId, folderId, setSucio]);

  if (!visible) return null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t("note.where.title")}
      scrollable={false}
      /*
        El Guardar es el del pie, y elige el destino: el mismo en todas las hojas
        y fuera del area que scrollea.
      */
      onSave={() => {
        if (!destino) return;
        onPick({ workspaceId: destino, folderId });
      }}
      saveDisabledReason={!destino ? t("note.where.chooseSpace") : undefined}
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
      </View>
    </Sheet>
  );
}
