import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface PlacePickerPlace {
  workspaceId: string;
  folderId: string | null;
  collectionId: string | null;
  /**
   * Si la persona **eligio** colección (o "Sin clasificar") en este sitio.
   *
   * `collectionId: null` solo no basta: es lo que hay antes de tocar nada y
   * tambien lo que hay tras elegir "Sin clasificar". Cambiar de espacio o de
   * carpeta lo vuelve a poner en `false`, porque la colección es de otro sitio.
   */
  collectionChosen: boolean;
}

export interface PlacePickerProps {
  workspaceId: string | null;
  folderId: string | null;
  collectionId: string | null;
  /**
   * Si ya se eligio colección. Sin esto, "Sin clasificar" aparece marcada de
   * entrada y se puede guardar sin haber decidido nada; con `false` no hay nada
   * marcado hasta que se toca una. Por defecto `true`, el comportamiento de
   * siempre para quien no pide una eleccion explicita.
   */
  collectionChosen?: boolean;
  onChange: (place: PlacePickerPlace) => void;
  /** WhereNoteSheet lo usa en false: alla no hay colecciones. */
  showCollections?: boolean;
}

/**
 * Donde va algo, sin el cromo.
 *
 * Es la decision que `WhereNoteSheet` ya sabia tomar (espacio + carpeta),
 * con el eje de colecciones sumado. Sin `Sheet`, sin titulo y sin botones:
 * un `View` con listas, y el cromo lo pone el llamador.
 *
 * Controlado: lo que se ve sale de las props y cada toque avisa con
 * `onChange`. Cambiar de espacio tira carpeta y coleccion, y cambiar de
 * carpeta tira la coleccion, porque un id de otro sitio no significa nada.
 */
export function PlacePicker({
  workspaceId,
  folderId,
  collectionId,
  collectionChosen = true,
  onChange,
  showCollections = true,
}: PlacePickerProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();

  const spaces = useMemo(() => tree.spaces(), [tree]);

  // Con un solo espacio no hay nada que elegir, asi que se usa sin preguntar
  // y solo la carpeta vale una pregunta.
  const effectiveWorkspaceId =
    workspaceId ?? (spaces.length === 1 ? (spaces[0]?.id ?? null) : null);
  const folders = effectiveWorkspaceId
    ? tree.foldersOf(effectiveWorkspaceId, folderId)
    : [];
  const collections =
    showCollections && effectiveWorkspaceId
      ? tree.collectionsOf(effectiveWorkspaceId, folderId)
      : [];

  return (
    <View style={{ gap: theme.spacing.md }}>
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
                  onPress={() =>
                    onChange({
                      workspaceId: space.id,
                      folderId: null,
                      collectionId: null,
                      collectionChosen: false,
                    })
                  }
                />
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {spaces.length === 1 ? (
        <AppText variant="caption" tone="muted">
          {spaces[0]?.name}
        </AppText>
      ) : null}

      {effectiveWorkspaceId ? (
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
                onPress={() =>
                  onChange({
                    workspaceId: effectiveWorkspaceId,
                    folderId: null,
                    collectionId: null,
                    collectionChosen: false,
                  })
                }
              />
              {folders.map((folder) => (
                <Pick
                  key={folder.id}
                  icon="folder-outline"
                  label={folder.name}
                  selected={false}
                  onPress={() =>
                    onChange({
                      workspaceId: effectiveWorkspaceId,
                      folderId: folder.id,
                      collectionId: null,
                      collectionChosen: false,
                    })
                  }
                />
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {showCollections && effectiveWorkspaceId ? (
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {t("place.chooseCollection")}
          </AppText>
          <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
            <View style={{ gap: 2 }}>
              <Pick
                icon="ellipsis-horizontal-circle-outline"
                label={t("place.unclassified")}
                selected={collectionChosen && collectionId === null}
                onPress={() =>
                  onChange({
                    workspaceId: effectiveWorkspaceId,
                    folderId,
                    collectionId: null,
                    collectionChosen: true,
                  })
                }
              />
              {collections.map((collection) => (
                <Pick
                  key={collection.id}
                  icon="bookmark-outline"
                  label={collection.name}
                  selected={collection.id === collectionId}
                  onPress={() =>
                    onChange({
                      workspaceId: effectiveWorkspaceId,
                      folderId,
                      collectionId: collection.id,
                      collectionChosen: true,
                    })
                  }
                />
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export function Pick({
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
        // El color solo cuando esta marcada: un `color: undefined` pisa el del
        // tema y en oscuro el texto cae al negro por defecto.
        style={selected ? { flex: 1, color: theme.colors.accent } : { flex: 1 }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
