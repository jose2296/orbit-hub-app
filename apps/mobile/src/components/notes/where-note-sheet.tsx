import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Sheet } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { AppText } from "@/components/ui/text";
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
 * The folder is offered too, not just the space, because the reason somebody is
 * here is usually a folder — they are in the middle of organising something — and
 * making them go back to pick one after the note exists is the wrong order.
 */
export function WhereNoteSheet({ visible, onClose, onPick }: WhereNoteSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const { setSucio } = useSheetSucio();

  /*
    Limpio al abrir, y **aunque antes recordaba**.

    Antes la hoja recordaba el ultimo sitio elegido, y con el contrato eso es
    llegar sucia: abrir, no tocar nada y salir preguntaria "lo pierdes" por una
    eleccion de la vez anterior. Una hoja nunca llega sucia.
  */
  useEffect(() => {
    if (visible) {
      setWorkspaceId(null);
      setFolderId(null);
    }
  }, [visible]);

  /*
    Sucio es **haber elegido sitio**, y nada mas.

    Moverse por espacios y carpetas es mirar, no elegir: solo el destino cuenta.
    Y sin destino no hay nada que perder, que es justo el estado en el que se abre.
  */
  const spaces = useMemo(() => tree.spaces(), [tree]);
  const folders = workspaceId ? tree.foldersOf(workspaceId, folderId) : [];

  /*
    Sucio es **haber elegido sitio**, y nada mas.

    Moverse por espacios y carpetas es mirar, no elegir: solo el destino cuenta.
    Y sin destino no hay nada que perder, que es justo el estado en el que se abre.
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
        El Guardar es el del pie, y elige el destino. La fila de confirmar que
        habia abajo hacia lo mismo desde dentro, y era la que se iba con el
        contenido en una hoja larga.
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
        {spaces.length === 0 ? (
          <AppText variant="body" tone="muted">
            {t("note.where.noSpaces")}
          </AppText>
        ) : null}

        {spaces.length > 1 ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("note.where.chooseSpace")}
            </AppText>
            <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled>
              <View style={{ gap: 2 }}>
                {spaces.map((space) => (
                  <Pick
                    key={space.id}
                    icon="grid-outline"
                    label={space.name}
                    selected={workspaceId === space.id}
                    onPress={() => {
                      setWorkspaceId(space.id);
                      setFolderId(null);
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {/* With one space there is nothing to choose, so it is used without asking
            and only the folder is worth a question. */}
        {spaces.length === 1 ? (
          <AppText variant="caption" tone="muted">
            {spaces[0]?.name}
          </AppText>
        ) : null}

        {workspaceId ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("note.where.chooseFolder")}
            </AppText>
            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
              <View style={{ gap: 2 }}>
                <Pick
                  icon="ellipsis-horizontal-circle-outline"
                  label={t("note.where.rootOfSpace")}
                  selected={folderId === null}
                  onPress={() => setFolderId(null)}
                />
                {folders.map((folder) => (
                  <Pick
                    key={folder.id}
                    icon="folder-outline"
                    label={folder.name}
                    selected={false}
                    onPress={() => setFolderId(folder.id)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {/*
          The one space is used without asking, and that is what the button being
          enabled means here. It was written as "disabled unless a space was
          picked", which greys out the only case where there is nothing to pick:
          somebody with a single space got a sheet asking them a question they had
          already answered, and then a button that would not do anything about it.
        */}
        {/*
          Y aqui **ya no hay fila de confirmar**.

          Elegia el destino desde dentro, y ahora lo elige el Guardar del pie: el
          mismo en todas las hojas y fuera del area que scrollea.
        */}
      </View>
    </Sheet>
  );
}

function Pick({
  icon,
  label,
  selected,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: disabled === true }}
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
        opacity: disabled ? 0.4 : 1,
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
      <AppText
        variant="body"
        numberOfLines={1}
        style={{ flex: 1, color: selected ? theme.colors.accent : undefined }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
