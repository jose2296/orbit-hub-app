import { useEffect, useState } from "react";
import { View } from "react-native";

import { Sheet } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
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
  // Elegir colección (o "Sin clasificar") es obligatorio y explicito: `null` solo
  // es lo que hay antes de tocar nada, y guardaba el enlace sin clasificar sin
  // que nadie lo hubiera decidido.
  const [eligioColeccion, setEligioColeccion] = useState(false);
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
    setEligioColeccion(false);
    setNombre("");
    setEmoji("");
    setSaving(false);
    setCreando(false);
    setError(null);
    resetShareGuard();
  }, [visible, payload]);

  const tieneUrl = payload.url.trim().length > 0;
  const hayEspacios = tree.spaces().length > 0;

  const { setSucio } = useSheetSucio();

  // Sucio es haber tocado algo: el titulo que cambia, un sitio elegido o una
  // coleccion a medio escribir. Abrir y salir sin tocar nada no pregunta.
  useEffect(() => {
    setSucio(
      titulo !== (payload.title ?? "") ||
        destino.workspaceId !== null ||
        eligioColeccion ||
        nombre.trim().length > 0 ||
        emoji.trim().length > 0,
    );
  }, [
    titulo,
    destino.workspaceId,
    eligioColeccion,
    nombre,
    emoji,
    payload.title,
    setSucio,
  ]);

  const guardar = async () => {
    if (!destino.workspaceId || !eligioColeccion || saving || !tieneUrl) return;
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
      setEligioColeccion(true);
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

  // Por que el Guardar del pie no se puede pulsar, dicho en voz alta: un boton
  // gris sin explicacion es un boton que se pulsa dos veces para averiguarlo.
  const razonGuardar = !tieneUrl
    ? t("share.save.noUrl")
    : !destino.workspaceId
      ? t("share.save.chooseSpace")
      : !eligioColeccion
        ? t("share.save.chooseCollection")
        : undefined;
  const razonCrear =
    nombre.trim().length === 0 ? t("itemEdit.nameNeeded") : undefined;

  /*
    Una sola hoja con dos paginas (`step`), y no dos hojas que se desmontan una a
    la otra: asi el panel cambia de alto con el muelle en vez de cerrarse y
    abrirse. El cuerpo **scrollea** y el Guardar vive en el pie, fuera de lo que
    scrollea: el titulo, el selector de sitio y la coleccion no caben juntos en
    un movil, y con `scrollable={false}` lo de debajo del primer campo quedaba
    cortado e imposible de tocar.
  */
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      step={pagina === 1 ? "guardar" : "coleccion"}
      title={
        pagina === 1 ? t("share.save.title") : t("share.save.createCollection")
      }
      subtitle={pagina === 1 ? payload.url : host}
      onBack={pagina === 2 ? () => setPagina(1) : undefined}
      onSave={() => (pagina === 1 ? guardar() : crearColeccion())}
      saveDisabledReason={
        pagina === 1 ? razonGuardar : razonCrear
      }
      artwork={
        pagina === 1 ? (
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
        ) : undefined
      }
    >
      {pagina === 2 ? (
        <View
          style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
        >
          <TextField
            label={t("share.save.collectionName")}
            placeholder={t("share.save.collectionNamePlaceholder")}
            value={nombre}
            onChangeText={setNombre}
            returnKeyType="next"
            autoFocus
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
        </View>
      ) : (
        <View
          style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
        >
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
            collectionChosen={eligioColeccion}
            onChange={(place) => {
              setDestino({
                workspaceId: place.workspaceId,
                folderId: place.folderId,
                collectionId: place.collectionId,
              });
              setEligioColeccion(place.collectionChosen);
            }}
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
        </View>
      )}
    </Sheet>
  );
}
