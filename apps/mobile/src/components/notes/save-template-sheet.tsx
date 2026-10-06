import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Sheet, SheetOptions, type SheetOption } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { saveTemplateFromNote } from "@/hooks/use-note-templates";
import { useTheme } from "@/theme";

/**
 * Turning the note on screen into a template.
 *
 * It is a sheet and not a dialog because it asks two things — a name and who can
 * see it — and a dialog with two fields in it is a form wearing a costume. The
 * name starts as the note's own: somebody who made a good note and is keeping it
 * has usually already written the name they would have called it.
 *
 * The scope is a choice and not a setting, and it is asked here because the
 * default is the answer most people want and the other one is the answer people
 * forget exists. A template everybody in the space can see is a thing published
 * to a team, and it should be a tap somebody can see themselves taking.
 */
/** A line that says what went wrong, and is not a button. */
function ErrorLine({ message }: { message: string }) {
  return (
    <AppText variant="caption" tone="danger">
      {message}
    </AppText>
  );
}

export interface SaveTemplateSheetProps {
  visible: boolean;
  workspaceId: string;
  /** The name to start from, which is the note's own. */
  initialName: string;
  /** The document being saved, already validated. */
  document: string;
  description?: string;
  onClose: () => void;
  onSaved?: (name: string) => void;
}

export function SaveTemplateSheet({
  visible,
  workspaceId,
  initialName,
  document,
  description,
  onClose,
  onSaved,
}: SaveTemplateSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState<"personal" | "workspace">("workspace");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded every time the sheet opens, so the name of the note you were just
  // reading is the name in the box rather than the name from the last time.
  useEffect(() => {
    if (visible) {
      setName(initialName);
      setScope("workspace");
      setError(null);
    }
  }, [initialName, visible]);

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveTemplateFromNote({
        workspaceId,
        name: trimmed,
        document,
        ...(description === undefined ? {} : { description }),
        scope,
      });
      onSaved?.(trimmed);
      onClose();
    } catch {
      setError(t("note.templates.failedBody"));
    } finally {
      setSaving(false);
    }
  }, [description, document, name, onClose, onSaved, saving, scope, t, workspaceId]);

  const { setSucio } = useSheetSucio();

  /**
   * Sucio **solo con el nombre cambiado**.
   *
   * El ambito —"en el espacio" o "solo mia"— es elegir entre dos botones y se ve
   * cual esta elegido, asi que no hay nada que perder y nada que preguntar. El
   * nombre es lo que se escribe, y es lo que se pierde en silencio.
   */
  useEffect(() => {
    setSucio(name.trim() !== initialName.trim());
  }, [name, initialName, setSucio]);

  const opciones: SheetOption[] = [
    {
      key: "workspace",
      label: t("note.templateScopeWorkspace"),
      icon: "people-outline",
      selected: scope === "workspace",
      onPress: () => setScope("workspace"),
    },
    {
      key: "personal",
      label: t("note.templateScopePersonal"),
      icon: "person-outline",
      selected: scope === "personal",
      onPress: () => setScope("personal"),
    },
    /*
      Y **no hay fila de "guardar"**, porque el Guardar es el del pie del panel.

      Estaba aqui como una fila mas del menu, entre "en el espacio" y "solo mia", y
      una accion que se guarda en una lista de opciones es una accion que hay que
      buscar leyendo: el mismo boton, en dos sitios distintos, y solo uno se mueve.
    */
  ];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("note.templates.saveCurrent")}
      scrollable
      /* El Guardar es el del pie, como en las demas hojas. */
      onSave={() => void save()}
      saveDisabledReason={name.trim().length === 0 ? t("itemEdit.nameNeeded") : undefined}
    >
      <View style={{ gap: theme.spacing.md }}>
        <TextField
          value={name}
          onChangeText={setName}
          placeholder={t("note.templateName")}
          label={t("note.templateName")}
          autoCapitalize="sentences"
        />
        <SheetOptions options={opciones} />
        {error ? <ErrorLine message={error} /> : null}
      </View>
    </Sheet>
  );
}
