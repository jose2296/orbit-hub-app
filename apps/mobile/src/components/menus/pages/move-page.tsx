import { useMemo, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { PlacePicker } from "@/components/workspace/place-picker";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { useTranslation } from "@/lib/i18n";
import type { MenuContext } from "@/lib/menus/registry";
import type { DestinoDeMudanza } from "@/lib/move/plan";
import { useTheme } from "@/theme";

export interface MovePageProps {
  ctx: MenuContext;
  /** Ya envuelto por la hoja: corre, avisa el fallo sin cerrar y cierra si va bien. */
  onMover: (destino: DestinoDeMudanza) => void;
  trabajando: boolean;
}

/**
 * A donde va una carpeta, lista, nota, coleccion o bookmark.
 *
 * El selector es el de siempre (`PlacePicker`, el mismo de `WhereNoteSheet`): espacio y
 * carpeta, sin colecciones. Con un solo espacio el destino ya esta decidido y el
 * boton se enciende sin tocar nada, como en la hoja de la nota.
 *
 * Tiene su boton adentro y no usa el Guardar del pie, por la misma razon que
 * `RenamePage`: el pie se apaga solo cuando su promesa resuelve, y un mover que falla
 * no puede dejar al usuario sin saber donde se quedo.
 */
export function MovePage({ ctx, onMover, trabajando }: MovePageProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  const spaces = useMemo(() => tree.spaces(), [tree]);
  const espacio = workspaceId ?? (spaces.length === 1 ? (spaces[0]?.id ?? null) : null);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <PlacePicker
        workspaceId={workspaceId}
        folderId={folderId}
        collectionId={null}
        showCollections={false}
        excludeFolderId={ctx.kind === "folder" ? ctx.entity.id : undefined}
        onChange={(lugar) => {
          setWorkspaceId(lugar.workspaceId);
          setFolderId(lugar.folderId);
        }}
      />
      <Button
        label={espacio ? t("move.confirm") : t("move.confirmDisabled")}
        disabled={!espacio || trabajando}
        fullWidth
        onPress={() => {
          if (!espacio || trabajando) return;
          onMover({ workspaceId: espacio, folderId });
        }}
      />
    </View>
  );
}
