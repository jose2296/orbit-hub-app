import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface RenameSheetProps {
  visible: boolean;
  /** What is being renamed, for the title of the panel. */
  title: string;
  /** The name it has now. */
  value: string;
  onClose: () => void;
  onRename: (name: string) => void;
}

/**
 * Renaming a list, a folder or a space.
 *
 * A panel and not a prompt on the page because the name is the one thing about
 * a thing that everything else hangs off: a link, a heading and a search all
 * use it, and renaming half way is worse than not renaming at all.
 *
 * It starts with the current name selected, because the usual reason to open it
 * is to change one letter, and making somebody select the whole word first is
 * work for nothing.
 */
export function RenameSheet({
  visible,
  title,
  value,
  onClose,
  onRename,
}: RenameSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [name, setName] = useState(value);
  const { setSucio } = useSheetSucio();

  /*
    El borrador empieza con el nombre actual, y **vuelve a el cada vez que se abre**.
    No porque sea un descuido del effect, sino porque es lo que hace que una hoja no
    llegue sucia: si alguien abrio, escribio y salio sin guardar, la siguiente vez
    que abra empieza donde estaba y no donde lo dejo a medias.
  */
  useEffect(() => {
    if (visible) setName(value);
  }, [visible, value]);

  /*
    "Sucio" es **el texto, no el teclado**.

    Se compara con el nombre que habia al abrir y no con "ha escrito algo": volver a
    borrar lo que habia te deja con el panel exactamente como estaba, y preguntar
    "¿sales sin guardar?" a alguien que no ha cambiado nada es la forma de
    enseñarle que el aviso no significa nada.
  */
  const cambiado = name.trim() !== value.trim();
  useEffect(() => {
    setSucio(cambiado);
  }, [cambiado, setSucio]);

  const submit = () => {
    const trimmed = name.trim();
    // Un nombre vacio no es un nombre: la fila seria una linea en blanco en la que
    // no hay nada que volver a encontrar.
    if (!trimmed || !cambiado) return;
    onRename(trimmed);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("rename.title", { what: title })}
      scrollable={false}
      /*
        El Guardar es **el del pie del panel**, no el que estaba aqui dentro.

        Dos botones de guardar en la misma pantalla es el mismo boton en el sitio
        donde alguien lo busca y en el sitio donde no lo mira, y el de dentro se
        va con el contenido. El de `Sheet` es el unico que hay, esta en todas las
        hojas, y no lo trae quien se acuerte de añadirlo: lo trae `onSave`.
      */
      onSave={submit}
    >
      <View
        style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
      >
        <TextField
          value={name}
          onChangeText={setName}
          label={t("rename.field")}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        {/*
          Y **no hay Cancelar aqui**: la ✕ de arriba y el fondo ya cierran, y ya
          preguntan. Un boton mas que cerraba lo mismo era una tercera forma de
          hacer lo mismo, y la unica que no hacia la pregunta.
        */}
      </View>
    </Sheet>
  );
}

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  /** What will happen, in one sentence, in the words of the thing. */
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}

/**
 * Asks before something that cannot be undone.
 *
 * Deleting is the only thing in the app that cannot be undone, so it is the only
 * thing that asks. The description says what happens to what is inside, because
 * "delete folder" says nothing about the lists in it and that is the part
 * people get wrong.
 */
export function ConfirmSheet({
  visible,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  busy = false,
}: ConfirmSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Sheet visible={visible} onClose={onClose} title={title} scrollable={false}>
      <View
        style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
      >
        <ConfirmBody description={description} />
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={confirmLabel}
            variant="danger"
            onPress={() => {
              onConfirm();
              onClose();
            }}
            loading={busy}
            fullWidth
          />
          <Button
            label={t("common.cancel")}
            variant="ghost"
            onPress={onClose}
            fullWidth
          />
        </View>
      </View>
    </Sheet>
  );
}

function ConfirmBody({ description }: { description: string }) {
  const t = useTranslation();
  return (
    <View>
      <AppText variant="body">{description}</AppText>
      <AppText variant="caption" tone="subtle">
        {t("confirm.irreversible")}
      </AppText>
    </View>
  );
}
