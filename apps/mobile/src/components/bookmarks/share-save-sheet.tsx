import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Pick, PlacePicker } from "@/components/workspace/place-picker";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import type { SharedPayload, SharePlace } from "@/lib/bookmarks/share-intent";
import {
  createBookmarkFromShare,
  resetShareGuard,
} from "@/lib/bookmarks/share-intent";
import { createCollectionAction } from "@/lib/collections/actions";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export type { SharedPayload };

export interface ShareSaveSheetProps {
  payload: SharedPayload;
  visible: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}

// La primera letra del host, y no un fetch del og:image en el cliente: la
// metadata real (incluida la miniatura) la trae la fase 2 despues de guardar.
// Bajar la imagen aqui seria pedirle al movil que descargue lo que sea que el
// enlace apunte, sin pasar por el servidor.
function hostDe(url: string): string {
  const hallado = /^(?:https?:\/\/)?([^/]+)/.exec(url);
  return hallado?.[1] ?? url;
}

/**
 * Donde se guarda un enlace que llega de fuera, en dos paginas.
 *
 * Pagina 1: preview, titulo editable y destino (`PlacePicker` con
 * colecciones y fila "sin clasificar"), mas Guardar fijo abajo. Pagina 2:
 * crear la coleccion sin salir, en el espacio y carpeta que el picker ya
 * tiene, y al volver queda elegida. `SheetProps.onBack` es el patron de la
 * casa para esto: siete hojas tienen mas de una pagina.
 */
export function ShareSaveSheet({
  payload,
  visible,
  onClose,
  onSaved,
}: ShareSaveSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();

  const [pagina, setPagina] = useState<1 | 2>(1);
  const [titulo, setTitulo] = useState(payload.title ?? "");
  // El picker pide espacio desde el primer toque, asi que aqui aun puede no
  // haberlo: el Guardar va deshabilitado hasta que lo haya.
  const [destino, setDestino] = useState<SharePlace>({
    workspaceId: null,
    folderId: null,
    collectionId: null,
  });
  const [nombre, setNombre] = useState("");
  const [emoji, setEmoji] = useState("");
  const [saving, setSaving] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura es un share nuevo: se vacia el formulario y el guard de
  // doble-guardado, para que el id del anterior no bloquee al siguiente.
  useEffect(() => {
    if (!visible) return;
    setPagina(1);
    setTitulo(payload.title ?? "");
    setDestino({ workspaceId: null, folderId: null, collectionId: null });
    setNombre("");
    setEmoji("");
    setSaving(false);
    setCreando(false);
    setError(null);
    resetShareGuard();
  }, [visible, payload]);

  const tieneUrl = payload.url.trim().length > 0;
  const hayEspacios = tree.spaces().length > 0;

  const guardar = async () => {
    if (!destino.workspaceId || saving || !tieneUrl) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createBookmarkFromShare(payload, destino, titulo);
      onClose();
      onSaved(id);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : t("errors.unknown"),
      );
    } finally {
      setSaving(false);
    }
  };

  // La coleccion nace donde se estaba mirando: el espacio y la carpeta los
  // pone el picker, aqui no se preguntan dos veces. Al volver a la pagina 1
  // queda elegida, asi el Guardar la usa sin mas toques.
  const crearColeccion = async () => {
    const nombreLimpio = nombre.trim();
    if (!destino.workspaceId || creando || nombreLimpio.length === 0) return;
    setCreando(true);
    setError(null);
    try {
      const id = await createCollectionAction({
        workspaceId: destino.workspaceId,
        folderId: destino.folderId,
        name: nombreLimpio,
        emoji: emoji.trim().length === 0 ? null : emoji.trim(),
      });
      setDestino({
        workspaceId: destino.workspaceId,
        folderId: destino.folderId,
        collectionId: id,
      });
      setNombre("");
      setEmoji("");
      setPagina(1);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : t("errors.unknown"),
      );
    } finally {
      setCreando(false);
    }
  };

  const host = hostDe(payload.url);

  if (pagina === 2) {
    return (
      <Sheet
        visible={visible}
        onClose={onClose}
        onBack={() => setPagina(1)}
        title={t("share.save.createCollection")}
        subtitle={host}
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
              label={creando ? t("common.saving") : t("common.create")}
              disabled={nombre.trim().length === 0 || creando}
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
      visible={visible}
      onClose={onClose}
      title={t("share.save.title")}
      subtitle={payload.url}
      scrollable={false}
      artwork={
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppText variant="bodyStrong" style={{ color: theme.colors.accent }}>
            {host.slice(0, 1).toUpperCase()}
          </AppText>
        </View>
      }
    >
      <View style={{ gap: theme.spacing.md }}>
        {tieneUrl ? (
          <TextField
            label={t("share.save.titleLabel")}
            placeholder={t("share.save.titlePlaceholder")}
            value={titulo}
            onChangeText={setTitulo}
            returnKeyType="done"
          />
        ) : (
          <AppText variant="body" tone="muted">
            {t("share.save.noUrl")}
          </AppText>
        )}
        {hayEspacios ? null : (
          <AppText variant="caption" tone="muted">
            {t("share.save.noSpaces")}
          </AppText>
        )}
        <PlacePicker
          workspaceId={destino.workspaceId}
          folderId={destino.folderId}
          collectionId={destino.collectionId}
          onChange={setDestino}
          showCollections
        />
        <Pick
          icon="add-outline"
          label={t("share.save.newCollection")}
          selected={false}
          disabled={!destino.workspaceId}
          onPress={() => setPagina(2)}
        />
        {error ? (
          <AppText variant="caption" style={{ color: theme.colors.danger }}>
            {error}
          </AppText>
        ) : null}
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={saving ? t("common.saving") : t("common.save")}
            disabled={!destino.workspaceId || saving || !tieneUrl}
            fullWidth
            onPress={() => void guardar()}
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
