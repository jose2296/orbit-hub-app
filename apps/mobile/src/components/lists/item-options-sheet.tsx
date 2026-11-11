import { useState } from "react";
import { View } from "react-native";

import type { ListItem } from "@orbit-hub/contracts";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ListRow } from "@/components/ui/list-row";
import { Sheet } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface ItemOptionsSheetProps {
  /** El item cuyas opciones se muestran. `null` cierra la hoja. */
  item: ListItem | null;
  onClose: () => void;
  onEdit: (item: ListItem) => void;
  /** Marca o desmarca el item. Solo las listas de tareas lo tienen. */
  onToggle?: (item: ListItem) => void;
  /** Borra el item. Se llama solo despues de confirmar. */
  onDelete: (item: ListItem) => void;
}

/**
 * Las opciones de un item: se abre con la pulsacion larga de su fila.
 *
 * El titulo es el nombre completo del item, sin cortar: es lo que dice de que
 * item se trata, y es para lo que se abre esta hoja.
 *
 * Borrar pide confirmacion en un dialogo aparte, igual que el resto de borrados.
 */
export function ItemOptionsSheet({
  item,
  onClose,
  onEdit,
  onToggle,
  onDelete,
}: ItemOptionsSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [confirmando, setConfirmando] = useState(false);

  const cerrarConConfirmacion = () => {
    setConfirmando(false);
    onClose();
  };

  return (
    <>
      <Sheet
        visible={item !== null}
        onClose={onClose}
        title={item?.title ?? ""}
        scrollable={false}
      >
        {item ? (
          <View style={{ gap: theme.spacing.xs }}>
            <ListRow
              title={t("itemOptions.edit")}
              icon="create-outline"
              onPress={() => {
                onClose();
                onEdit(item);
              }}
            />
            {onToggle ? (
              <ListRow
                title={item.completed ? t("itemOptions.undone") : t("itemOptions.done")}
                icon={item.completed ? "arrow-undo-outline" : "checkmark-circle-outline"}
                onPress={() => {
                  onClose();
                  onToggle(item);
                }}
              />
            ) : null}
            <ListRow
              title={t("itemOptions.delete")}
              icon="trash-outline"
              destructive
              onPress={() => setConfirmando(true)}
            />
          </View>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={confirmando && item !== null}
        title={t("itemOptions.deleteTitle", { name: item?.title ?? "" })}
        body={t("itemOptions.deleteBody")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (item) onDelete(item);
          cerrarConConfirmacion();
        }}
        onCancel={() => setConfirmando(false)}
      />
    </>
  );
}
