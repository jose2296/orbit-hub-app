import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import type { Collection } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Sheet, SheetOptions, useLastValue } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { deleteCollectionAction, updateCollectionAction } from "@/lib/collections/actions";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

type Paso = "menu" | "rename" | "delete";

export interface CollectionMenuSheetProps {
  /** La coleccion sobre la que se actua, o `null` con la hoja cerrada. */
  collection: Collection | null;
  onClose: () => void;
}

/**
 * Lo que se puede hacer con una coleccion, en una sola hoja de tres paginas:
 * el menu, renombrar y confirmar el borrado.
 *
 * Es la misma hoja de acciones que tienen una lista, una carpeta y una nota, para
 * que una coleccion se gestione desde el mismo sitio y con el mismo gesto. Borrar
 * no se lleva los enlaces: pasan a "sin clasificar" (`deleteCollectionAction`).
 */
export function CollectionMenuSheet({ collection: pedida, onClose }: CollectionMenuSheetProps) {
  // La ultima y no la del llamador: el llamador la pone a `null` para cerrar y la
  // hoja tiene que seguir pintando mientras baja.
  const collection = useLastValue(pedida);

  const theme = useTheme();
  const t = useTranslation();
  const { setSucio } = useSheetSucio();

  const [paso, setPaso] = useState<Paso>("menu");
  const [nombre, setNombre] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura empieza en el menu, con el nombre de la coleccion y sin error.
  useEffect(() => {
    if (!pedida) return;
    setPaso("menu");
    setNombre(pedida.name);
    setTrabajando(false);
    setError(null);
  }, [pedida]);

  // Sucio es haber cambiado el nombre: abrir y salir sin tocar nada no pregunta.
  useEffect(() => {
    setSucio(paso === "rename" && collection !== null && nombre.trim() !== collection.name);
  }, [paso, nombre, collection, setSucio]);

  const opciones = useMemo<SheetOption[]>(
    () => [
      {
        key: "rename",
        label: t("common.rename"),
        icon: "create-outline",
        onPress: () => setPaso("rename"),
      },
      {
        key: "delete",
        label: t("common.delete"),
        icon: "trash-outline",
        tone: "danger",
        description: t("collections.delete.hint"),
        onPress: () => setPaso("delete"),
      },
    ],
    [t],
  );

  if (!collection) return null;

  const guardarNombre = async () => {
    const limpio = nombre.trim();
    if (limpio.length === 0 || trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      await updateCollectionAction({ id: collection.id, baseVersion: collection.version, name: limpio });
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("errors.unknown"));
    } finally {
      setTrabajando(false);
    }
  };

  const borrar = async () => {
    if (trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      await deleteCollectionAction(collection.id);
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("errors.unknown"));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Sheet
      visible={pedida !== null}
      onClose={onClose}
      step={paso}
      title={paso === "delete" ? t("collections.delete.confirm") : collection.name}
      subtitle={paso === "menu" ? t("collections.kind") : paso === "rename" ? t("common.rename") : collection.name}
      onBack={paso === "menu" ? undefined : () => setPaso("menu")}
      // Solo renombrar tiene algo que guardar; el borrado lleva su propio boton.
      onSave={paso === "rename" ? () => void guardarNombre() : undefined}
      saveDisabledReason={nombre.trim().length === 0 ? t("itemEdit.nameNeeded") : undefined}
    >
      {paso === "menu" ? <SheetOptions options={opciones} /> : null}

      {paso === "rename" ? (
        <View style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}>
          <TextField
            label={t("share.save.collectionName")}
            value={nombre}
            onChangeText={setNombre}
            returnKeyType="done"
            autoFocus
          />
          {error ? (
            <AppText variant="caption" style={{ color: theme.colors.danger }}>
              {error}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {paso === "delete" ? (
        <View style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}>
          <AppText variant="body" tone="muted">
            {t("collections.delete.body")}
          </AppText>
          {error ? (
            <AppText variant="caption" style={{ color: theme.colors.danger }}>
              {error}
            </AppText>
          ) : null}
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={trabajando ? t("common.saving") : t("common.delete")}
              variant="danger"
              disabled={trabajando}
              fullWidth
              onPress={() => void borrar()}
            />
            <Button label={t("common.cancel")} variant="ghost" fullWidth onPress={() => setPaso("menu")} />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
