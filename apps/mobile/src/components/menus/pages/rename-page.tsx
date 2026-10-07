import { useEffect } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import type { MenuContext } from "@/lib/menus/registry";
import { useTheme } from "@/theme";

export interface RenamePageProps {
  ctx: MenuContext;
  /**
   * El nombre editado, y **lo escribe la hoja y no la pagina**.
   *
   * No por pereza: el borrador tiene que sobrevivir a que esta pagina se monte y
   * se desmonte cada vez que se vuelve y se entra, y quien decide cuando se abre
   * el menu es la hoja. Una pagina que guardara el borrador en su propio estado
   * lo perderia en el frame en que `Sheet` cambia de `step`.
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
 * Y por eso el borrador es de la hoja: "sucio" lo lee el `Sheet`, y el `Sheet` no
 * puede leer el estado de una pagina que todavia no existe.
 */
export function RenamePage({ ctx, nombre, onChange, onRename, trabajando }: RenamePageProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { setSucio } = useSheetSucio();

  const limpio = nombre.trim();
  const vacio = limpio.length === 0;

  /*
    Sucio es "el nombre es distinto del que tenia" y no "hay algo escrito":
    abrir el menu, tocar el campo y volver a poner lo mismo no es un cambio, y
    preguntar por eso es como se enseña a ignorar el aviso.
  */
  const cambiar = (valor: string) => {
    onChange(valor);
    setSucio(valor.trim() !== ctx.entity.title.trim());
  };

  /*
    Y se desarma al salir de la pagina. El aviso de "salir sin guardar" es de
    **esta** pagina y no del menu entero: en la lista de opciones no hay nada
    escrito todavia, y una hoja que pregunta con el menu abierto no esta
    preguntando por nada.
  */
  useEffect(() => () => setSucio(false), [setSucio]);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <TextField
        label={t("rename.field")}
        value={nombre}
        onChangeText={cambiar}
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
