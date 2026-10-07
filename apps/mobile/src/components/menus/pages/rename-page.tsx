import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface RenamePageProps {
  /**
   * El nombre editado, y **lo escribe la hoja y no la pagina**.
   *
   * No por pereza: el borrador tiene que sobrevivir a que esta pagina se monte y
   * se desmonte cada vez que se vuelve y se entra, y quien decide cuando se abre
   * el menu es la hoja. Una pagina que guardara el borrador en su propio estado
   * lo perderia en el frame en que `Sheet` cambia de `step`.
   *
   * Y por eso esta pagina **no recibe `ctx`**: antes lo recibia para comparar el
   * borrador con el titulo y armar "sucio", y esa comparacion ahora vive en la
   * hoja. Lo que le queda no depende del tipo de entidad —renombrar es renombrar en
   * los cinco—, asi que un `ctx` sin usar seria una firma que miente sobre lo que
   * la pagina necesita.
   */
  nombre: string;
  onChange: (valor: string) => void;
  /**
   * El handler, **ya envuelto por la hoja**: corre, avisa el fallo sin cerrar y
   * cierra solo si va bien. Por eso la pagina no hace try/catch: la regla de
   * error es una y vive en un solo sitio, que es donde vive el reintentar.
   */
  onRename: () => void;
  trabajando: boolean;
}

/**
 * Renombrar, y la misma pagina para una lista, una nota, una carpeta, una
 * coleccion y un enlace.
 *
 * ------------------------------------------------------------------
 * POR QUE NO USA EL GUARDAR DEL `Sheet`
 * ------------------------------------------------------------------
 *
 * Porque el `Guardar` del pie se apaga solo cuando su `onSave` **resuelve**
 * (`sheet.tsx:230-246`), y `onSave` no puede rechazar sin dejar una promesa sin
 * manejar. O sea: con el Guardar del pie, un renombrar que falla apaga la
 * pregunta de "salir sin guardar" y el nombre escrito se va sin avisar. Un boton
 * dentro de la pagina deja que la hoja decida cuando queda sucio, y esa es la
 * unica decision que importa aca.
 *
 * ------------------------------------------------------------------
 * POR QUE ACA NO HAY `useSheetSucio`
 * ------------------------------------------------------------------
 *
 * Porque "sucio" no es de esta pagina. El borrador vive en la hoja y sobrevive a
 * la flecha: escribir, tocar ← y cerrar se iba sin preguntar si el aviso lo
 * guardara la pagina, porque el aviso se desarmaba en el mismo toque que dejaba el
 * texto escrito. La verdad esta en la hoja, derivando `sucio` del borrador, y esta
 * pagina solo dibuja el campo.
 *
 * Y por la misma razon el boton de "descartar" no esta: la flecha se llama
 * "Volver", no "Descartar", y si de verdad quiere descartar lo escrito lo dice y
 * lo pregunta. Ese boton es de otra tarea.
 */
export function RenamePage({ nombre, onChange, onRename, trabajando }: RenamePageProps) {
  const theme = useTheme();
  const t = useTranslation();

  const vacio = nombre.trim().length === 0;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <TextField
        label={t("rename.field")}
        value={nombre}
        onChangeText={onChange}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={() => {
          if (vacio || trabajando) return;
          onRename();
        }}
      />
      {vacio ? (
        <AppText variant="caption" tone="subtle">
          {t("itemEdit.nameNeeded")}
        </AppText>
      ) : null}
      <Button
        label={trabajando ? t("common.saving") : t("rename.save")}
        disabled={vacio || trabajando}
        fullWidth
        onPress={onRename}
      />
    </View>
  );
}
