import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet, useLastValue } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Pick, PlacePicker } from "@/components/workspace/place-picker";
import { updateBookmarkAction } from "@/lib/bookmarks/actions";
import { createCollectionAction } from "@/lib/collections/actions";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** Lo que el triage necesita de un bookmark: a donde pertenece y que mostrar. */
export interface BookmarkAClasificar {
  id: string;
  version: number;
  workspaceId: string;
  title: string;
  url: string;
}

export interface AssignSheetProps {
  bookmark: BookmarkAClasificar | null;
  onClose: () => void;
}

/**
 * Clasificar un enlace que ya existe, en dos paginas.
 *
 * Hoja nueva y no `ShareSaveSheet` en modo asignar, a proposito: la de
 * guardar crea bookmarks nuevos con su guard de doble-guardado y su `onSaved`
 * con navegacion, y adaptarla a "reasignar uno existente" es mas friccion que
 * una hoja de cien lineas que reusa `PlacePicker`. Si las dos convergen,
 * fusionarlas es borrar una.
 *
 * Con cambio de espacio: `updateBookmarkAction` acepta `workspaceId` y el
 * servidor valida que puedes escribir en el destino. Antes no se podia, y este
 * comentario decia "igual que una nota" — que era la razon equivocada: una nota
 * no se mueve porque su campo tampoco estaba en la lista blanca, no porque no se
 * debiera. Lo que cambia de espacio resetea carpeta y coleccion, que son ids del
 * espacio viejo.
 */
export function AssignSheet({ bookmark: pedido, onClose }: AssignSheetProps) {
  // El ultimo y no el del llamador: el llamador lo pone a null para cerrar y
  // la hoja necesita seguir pintando mientras baja. Patron de `note-menu-sheet`.
  const bookmark = useLastValue(pedido);

  const theme = useTheme();
  const t = useTranslation();

  const [pagina, setPagina] = useState<1 | 2>(1);
  const [carpetaId, setCarpetaId] = useState<string | null>(null);
  // El espacio elegido, que arranca siendo el del bookmark y puede cambiar.
  const [espacioId, setEspacioId] = useState<string>(pedido?.workspaceId ?? "");
  const [coleccionId, setColeccionId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [emoji, setEmoji] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura es otro enlace: se vacia la eleccion para que la coleccion
  // del anterior no quede marcada en este.
  useEffect(() => {
    if (!pedido) return;
    setPagina(1);
    setCarpetaId(null);
    setColeccionId(null);
    setNombre("");
    setEmoji("");
    setOcupado(false);
    setError(null);
  }, [pedido]);

  if (!bookmark) return null;

  const cambioDeLugar = (lugar: {
    workspaceId: string;
    folderId: string | null;
    collectionId: string | null;
  }) => {
    /*
      El espacio se puede cambiar, y **cambiar resetea el destino**.

      Este `if` devolvia el toque al espacio del bookmark. La razon que se escribio
      entonces era "el servidor no acepta el cambio", y era cierta: el campo no
      estaba en `SYNC_WRITABLE_FIELDS`. Ahora si esta, con la validacion del
      destino en `sync-service.ts`, asi que el picker puede ofrecerlo.

      Pero cambiar de espacio **invalida** la carpeta y la coleccion antiguas: son
      ids de ese espacio. Llevarlas habria dejado un bookmark archivado en una
      carpeta que no existe donde acaba de caer — la fila que despues no se puede
      borrar desde la app. Por eso se resetean y el servidor las resuelve contra el
      destino, que es la mitad autoritativa.
    */
    if (lugar.workspaceId !== bookmark.workspaceId) {
      setCarpetaId(null);
      setColeccionId(null);
      setEspacioId(lugar.workspaceId);
      return;
    }
    setCarpetaId(lugar.folderId);
    setColeccionId(lugar.collectionId);
  };

  /**
   * El triage manda solo la coleccion y nada mas.
   *
   * El `folderId` lo deriva el servidor de la coleccion (invariante de fase 1):
   * mandarlo a mano y que discrepe es 422. Y `baseVersion` lo pide el tipo
   * aunque `localUpdate` lea la version vigente de la cache: se pasa la que
   * habia en pantalla, que es lo unico que esta hoja conoce.
   */
  const clasificar = async (destinoId: string) => {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      await updateBookmarkAction({
        id: bookmark.id,
        baseVersion: bookmark.version,
        ...(espacioId !== bookmark.workspaceId ? { workspaceId: espacioId } : {}),
        collectionId: destinoId,
      });
      onClose();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : t("errors.unknown"),
      );
    } finally {
      setOcupado(false);
    }
  };

  // La coleccion nace en el espacio del bookmark y en la carpeta que el picker
  // ya tiene: la carpeta aqui solo decide donde nace, nunca se manda con el
  // bookmark. Y al crearla se clasifica sin mas toques: escribir el nombre y
  // pulsar Crear ya es la intencion, pedir Confirmar despues seria preguntar
  // dos veces lo mismo.
  const crearColeccion = async () => {
    const nombreLimpio = nombre.trim();
    if (ocupado || nombreLimpio.length === 0) return;
    setOcupado(true);
    setError(null);
    try {
      const id = await createCollectionAction({
        workspaceId: bookmark.workspaceId,
        folderId: carpetaId,
        name: nombreLimpio,
        emoji: emoji.trim().length === 0 ? null : emoji.trim(),
      });
      await updateBookmarkAction({
        id: bookmark.id,
        baseVersion: bookmark.version,
        ...(espacioId !== bookmark.workspaceId ? { workspaceId: espacioId } : {}),
        collectionId: id,
      });
      onClose();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : t("errors.unknown"),
      );
    } finally {
      setOcupado(false);
    }
  };

  if (pagina === 2) {
    return (
      <Sheet
        visible={pedido !== null}
        onClose={onClose}
        onBack={() => setPagina(1)}
        title={t("share.save.createCollection")}
        subtitle={bookmark.url}
        scrollable={false}
      >
        <View style={{ gap: theme.spacing.md }}>
          <TextField
            label={t("share.save.collectionName")}
            placeholder={t("share.save.collectionNamePlaceholder")}
            value={nombre}
            onChangeText={setNombre}
            returnKeyType="next"
          />
          <TextField
            label={t("share.save.emojiLabel")}
            value={emoji}
            onChangeText={setEmoji}
            returnKeyType="done"
          />
          {error ? (
            <AppText variant="caption" style={{ color: theme.colors.danger }}>
              {error}
            </AppText>
          ) : null}
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={ocupado ? t("common.saving") : t("common.create")}
              disabled={nombre.trim().length === 0 || ocupado}
              fullWidth
              onPress={() => void crearColeccion()}
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

  return (
    <Sheet
      visible={pedido !== null}
      onClose={onClose}
      title={t("bookmarks.assign.title")}
      subtitle={
        bookmark.title.length > 0 ? bookmark.title : bookmark.url
      }
      scrollable={false}
    >
      <View style={{ gap: theme.spacing.md }}>
        <AppText variant="caption" tone="muted">
          {t("bookmarks.assign.hint")}
        </AppText>
        <PlacePicker
          workspaceId={bookmark.workspaceId}
          folderId={carpetaId}
          collectionId={coleccionId}
          onChange={cambioDeLugar}
          showCollections
        />
        <Pick
          icon="add-outline"
          label={t("share.save.newCollection")}
          selected={false}
          onPress={() => setPagina(2)}
        />
        {error ? (
          <AppText variant="caption" style={{ color: theme.colors.danger }}>
            {error}
          </AppText>
        ) : null}
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={ocupado ? t("common.saving") : t("bookmarks.assign.confirm")}
            disabled={!coleccionId || ocupado}
            fullWidth
            onPress={() =>
              coleccionId ? void clasificar(coleccionId) : undefined
            }
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
