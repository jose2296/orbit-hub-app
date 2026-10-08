import { useEffect } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
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
   * borrador con el titulo y armar "sucio", y ahora recibe **los dos datos con
   * nombre** —`borrador` y `titulo`— en vez del `ctx` entero. Lo que le queda no
   * depende del tipo de entidad —renombrar es renombrar en los cinco—, asi que un
   * `ctx` sin usar seria una firma que miente sobre lo que la pagina necesita.
   */
  nombre: string;
  /**
   * El borrador crudo, o `null` si nadie ha escrito todavia.
   *
   * Viaja **aparte de `nombre`** y no solo por comodidad: `nombre` es
   * `borrador ?? titulo`, o sea que con el solo no se puede distinguir "no he
   * escrito nada" de "he borrado el campo a mano", y sin esa distincion un menu
   * recien abierto —donde `nombre` es el titulo y no un cambio— se compararia
   * contra si mismo y la pregunta se armaria antes de que nadie tocara nada.
   */
  borrador: string | null;
  /** El nombre que tiene la entidad ahora, contra el que se compara el borrador. */
  titulo: string;
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
 * POR QUE ACA SI HAY `useSheetSucio`, Y POR QUE NO EN LA HOJA
 * ------------------------------------------------------------------
 *
 * Porque "sucio" se **deriva** de datos que viven en la hoja, y quien lo escribe
 * tiene que ser un **hijo** del `Sheet`: el `SheetSucioContexto.Provider` esta
 * dentro del `<Modal>` (`sheet.tsx:630`) y un contexto no fluye hacia arriba. Esta
 * pagina esta ahi dentro, asi que su `setSucio` llega; la hoja, que pinta el
 * `Sheet`, leeria el valor por defecto y su `setSucio` seria `() => {}`.
 *
 * Que estuvo al reves es un bug que salio caro y por eso vale la pena escribirlo
 * entero: la hoja derivaba "sucio" y escribia a un no-op, la pregunta de "salir sin
 * guardar" **nunca se armo**, y el sintoma es el peor de una hoja —escribir un
 * nombre, cerrar, y perderlo sin preguntar— con dos propiedades que lo hacen
 * invisible: no rompe nada y no hay typecheck que lo note. `rename-sheet.tsx` y
 * `share-node-sheet.tsx` ya lo hacen como esta pagina; `index.tsx` y
 * `reorder-sheet.tsx` lo resuelven con un componente que no pinta nada.
 *
 * Y lo que **no** hay es un `return () => setSucio(false)`. Es el bug que esta
 * pagina cometio en la ronda anterior: la flecha de "Volver" desmonta la pagina con
 * el texto escrito ahi, y si el cleanup desarmara la pregunta, cerrar despues se
 * iria sin preguntar —edicion perdida en silencio, otra vez, por el otro lado—. El
 * borrador sobrevive a la flecha porque vive en la hoja, asi que la pregunta tiene
 * que sobrevivir tambien, y `Sheet` ya limpia su propio "sucio" al abrir
 * (`sheet.tsx:200-205`), que es el unico reset que hace falta.
 *
 * Y por la misma razon el boton de "descartar" no esta: la flecha se llama
 * "Volver", no "Descartar", y si de verdad quiere descartar lo escrito lo dice y
 * lo pregunta. Ese boton es de otra tarea.
 */
export function RenamePage({
  nombre,
  borrador,
  titulo,
  onChange,
  onRename,
  trabajando,
}: RenamePageProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { setSucio } = useSheetSucio();

  /*
    "Sucio" es **el texto, no el teclado**, y `null` no es un cambio.

    Con `borrador === null` no se ha escrito nada todavia —el menu recien
    abierto—, asi que la pregunta no se arma. Y con el borrador igual al titulo la
    persona ha vuelto a donde estaba: preguntar "¿sales sin guardar?" a alguien que
    no ha cambiado nada es la forma de enseñarle que el aviso no significa nada.

    Sin cleanup, y el motivo esta en la cabecera del componente.
  */
  useEffect(() => {
    setSucio(borrador !== null && borrador.trim() !== titulo.trim());
  }, [borrador, titulo, setSucio]);

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
