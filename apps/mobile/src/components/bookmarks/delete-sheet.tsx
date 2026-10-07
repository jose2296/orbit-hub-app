import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet, useLastValue } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { deleteBookmarkAction } from "@/lib/bookmarks/actions";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** Lo que la confirmacion necesita de un bookmark: a quien borra y que muestra. */
export interface BookmarkABorrar {
  id: string;
  title: string;
  url: string;
}

export interface BookmarkDeleteSheetProps {
  bookmark: BookmarkABorrar | null;
  onClose: () => void;
}

/**
 * Confirmar antes de borrar un bookmark, con doble boton.
 *
 * Compartida por el inbox y la lista: el patron es identico en las dos
 * (titulo de confirmacion, aviso, `danger` + `ghost`, patron
 * `place-share-sheet.tsx:263-276`), y dos copias ya demostraron en esta casa
 * que derivan. Sin el, un toque a la papelera en el bolsillo es un enlace
 * menos y un tombstone sincronizado.
 *
 * `deleteBookmarkAction` existe desde la Task 3 (`actions.ts`): tombstone en
 * local y operacion encolada, igual que en las notas. La fila desaparece sola
 * al releer la suscripcion del hook, aqui no se toca ninguna lista.
 */
export function BookmarkDeleteSheet({
  bookmark: pedido,
  onClose,
}: BookmarkDeleteSheetProps) {
  // El ultimo y no el del llamador: el llamador lo pone a null para cerrar y
  // la hoja necesita seguir pintando mientras baja. Patron de `note-menu-sheet`.
  const bookmark = useLastValue(pedido);

  const theme = useTheme();
  const t = useTranslation();

  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura es otro enlace: se vacia el error para que el fallo del
  // anterior no siga pintado en este.
  useEffect(() => {
    if (!pedido) return;
    setBorrando(false);
    setError(null);
  }, [pedido]);

  if (!bookmark) return null;

  const borrar = async () => {
    if (borrando) return;
    setBorrando(true);
    setError(null);
    try {
      await deleteBookmarkAction(bookmark.id);
      onClose();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : t("errors.unknown"),
      );
    } finally {
      setBorrando(false);
    }
  };

  return (
    <Sheet
      visible={pedido !== null}
      onClose={onClose}
      title={t("bookmarks.deleteConfirm")}
      subtitle={
        bookmark.title.length > 0 ? bookmark.title : bookmark.url
      }
      scrollable={false}
    >
      <View style={{ gap: theme.spacing.md }}>
        <AppText variant="body" tone="muted">
          {t("bookmarks.deleteBody")}
        </AppText>
        {error ? (
          <AppText variant="caption" style={{ color: theme.colors.danger }}>
            {error}
          </AppText>
        ) : null}
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={borrando ? t("common.saving") : t("common.delete")}
            variant="danger"
            disabled={borrando}
            fullWidth
            onPress={() => void borrar()}
          />
          <Button
            label={t("common.cancel")}
            variant="ghost"
            fullWidth
            onPress={onClose}
          />
        </View>
      </View>
    </Sheet>
  );
}
