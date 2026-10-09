/**
 * La hoja vieja de carpeta, **tal cual estaba**: su bloque `options` y los seis
 * paneles hermanos que montaba, sin los comentarios.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE Y NO SE LEE LA HOJA VIEJA
 * ------------------------------------------------------------------
 *
 * Porque la T7 borra `src/components/folders/folder-menu-sheet.tsx` —si queda, hay
 * dos menus de carpeta y el que gana es el que se importa ultimo—, y un guard que
 * lee un archivo que se guardo se queda comprobando nada sin avisar. La lista de
 * filas esta congelada aca y el test la **parsea**, igual que hace
 * `fixtures/list-menu-sheet-options.ts` con la de lista: escritas a mano serían una
 * copia del registro que se desincroniza en silencio.
 *
 * ------------------------------------------------------------------
 * POR QUE ADEMAS SE CONGELAN LOS SEIS PANELES
 * ------------------------------------------------------------------
 *
 * Porque esa hoja era lo unico que montaba **`Sheet` sobre `Sheet`**, y el
 * contraste es lo que le da sentido al "una sola hoja" que afirma
 * `entity-menu-sheet.test.ts`: sin el, "un solo `Sheet`" tambien lo cumpliria un
 * archivo que simplemente tiene menos contenido. Y como el archivo se borra, el
 * numero queda congelado aca en vez de medido.
 *
 * Los seis, en el orden en que los montaba:
 *
 * 1. `<Sheet>` — el menu, con `visible={pedido !== null && !inside}`
 * 2. `<Sheet>` — los tipos de lista, con `visible={creatingKind !== null}`
 * 3. `<Sheet>` — compartir, con `visible={sharing}`
 * 4. `<RenameSheet>` — renombrar, con `visible={renaming}`
 * 5. `<IconPickerSheet>` — el icono, con `visible={pickingIcon}`
 * 6. `<ConfirmSheet>` — borrar, con `visible={confirmDelete}`
 *
 * Y el flag que los conmutaba era `inside`, que se ponia en `true` cuando
 * cualquiera de los cinco paneles de arriba estaba abierto: el menu se cerraba
 * (`!inside`) mientras el otro aparecia. Eso es exactamente el panel-sobre-panel
 * que el repo evita, porque `Sheet` es un `Modal`.
 *
 * ------------------------------------------------------------------
 * COMO SE EXTRAJO EL BLOQUE, PARA QUE SE PUEDA REHACER
 * ------------------------------------------------------------------
 *
 * Del archivo, entre `const options: SheetOption[]` y el `if (!folder) return null;`
 * que la sigue, quitando los comentarios de bloque y los de linea que no esten
 * dentro de una URL:
 *
 *     const i = f.indexOf("const options: SheetOption[]");
 *     const j = f.indexOf("if (!folder) return null;", i);
 *     f.slice(i, j)
 *       .replace(/\/\*[\s\S]*?\*\//g, "")
 *       .replace(/(^|[^:])\/\/.*$/gm, "$1")
 *
 * Y da **seis filas y ocho etiquetas**: `pin` y `delete` son dos cada una, porque su
 * copy depende del estado —puesta o no en el panel,duena o no— y una fila que
 * cambia de copy es una fila con dos etiquetas.
 */
export const BLOQUE_DE_LA_HOJA_VIEJA =
  'const options: SheetOption[] = useMemo(\n' +
  '    () => [\n' +
  '      {\n' +
  '        key: "new-list",\n' +
  '        label: t("lists.createHere"),\n' +
  '        icon: "add-circle-outline",\n' +
  '        onPress: () => setCreatingKind("tasks"),\n' +
  '      },\n' +
  '      \n' +
  '      \n' +
  '      \n' +
  '      ...(onTogglePin\n' +
  '        ? [\n' +
  '            {\n' +
  '              key: "pin",\n' +
  '              label: onPanel\n' +
  '                ? t("dashboard.takeOffPanel")\n' +
  '                : t("dashboard.putOnPanel"),\n' +
  '              icon: (onPanel\n' +
  '                ? "remove-circle-outline"\n' +
  '                : "apps-outline") as SheetOption["icon"],\n' +
  '              \n' +
  '              \n' +
  '              \n' +
  '              onPress: () => {\n' +
  '                onTogglePin();\n' +
  '                onClose();\n' +
  '              },\n' +
  '            },\n' +
  '          ]\n' +
  '        : []),\n' +
  '      {\n' +
  '        key: "rename",\n' +
  '        label: t("common.rename"),\n' +
  '        icon: "create-outline",\n' +
  '        onPress: () => setRenaming(true),\n' +
  '      },\n' +
  '      {\n' +
  '        key: "icon",\n' +
  '        label: t("icons.title"),\n' +
  '        icon: "image-outline",\n' +
  '        onPress: () => setPickingIcon(true),\n' +
  '      },\n' +
  '      \n' +
  '      \n' +
  '      \n' +
  '      \n' +
  '      ...(folder && folder.role === "owner"\n' +
  '        ? [\n' +
  '            {\n' +
  '              key: "share",\n' +
  '              label: t("share.pickSomeone"),\n' +
  '              icon: "people-outline" as const,\n' +
  '              description: t("share.isALink"),\n' +
  '              onPress: () => setSharing(true),\n' +
  '            },\n' +
  '          ]\n' +
  '        : []),\n' +
  '      {\n' +
  '        \n' +
  '        key: "delete",\n' +
  '        label: folder?.shared ? t("common.deleteNotYours") : t("common.delete"),\n' +
  '        icon: "trash-outline",\n' +
  '        tone: "danger",\n' +
  '        description: folder?.shared\n' +
  '          ? t("common.deleteNotYoursHint")\n' +
  '          : t("lists.deleteFolderBody"),\n' +
  '        disabled: folder?.shared,\n' +
  '        onPress: () => setConfirmDelete(true),\n' +
  '      },\n' +
  '    ],\n' +
  '    [onClose, onPanel, onTogglePin, t],\n' +
  '  );';

/**
 * Los paneles hermanos de la hoja vieja de carpeta, **con la forma que tenian**.
 *
 * No es el archivo entero: son las lineas que abren cada `<Sheet>` y cada hoja
 * hermana, con su `visible`, que es lo que conmutaba el flag `inside`. Se leen con
 * el mismo `hojasMontadas` que usa `entity-menu-sheet.test.ts`, asi que el numero
 * sale de contar y no de escribir —y asi el contraste no depende de que alguien
 * reescriba el fixture para que la afirmacion siga valiendo.
 */
export const PANELES_DE_LA_HOJA_VIEJA = [
  '<Sheet',
  '<Sheet',
  '<Sheet',
  '<RenameSheet',
  '<IconPickerSheet',
  '<ConfirmSheet',
].join("\n");

/**
 * El bloque de los tipos, **con la forma que tenia**.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE BLOQUE Y NO UNO DERIVADO DEL DE ARRIBA
 * ------------------------------------------------------------------
 *
 * Porque `createOptions` esta **antes** de `options` en el archivo viejo, asi que la
 * extraccion documentada mas arriba —"entre `const options` y `if (!folder) return
 * null;`"— no lo toma: queda fuera. Y queda congelado aparte porque es el bloque que
 * la pagina `create` tiene que reponer, y la fila de "crear una lista aqui" sin el no
 * es una perdida con nombre: el menu de una carpeta ofrecia de verdad esta eleccion.
 *
 * ------------------------------------------------------------------
 * COMO SE EXTRAJO, PARA QUE SE PUEDA REHACER
 * ------------------------------------------------------------------
 *
 * Del archivo, entre `const createOptions: SheetOption[]` y el
 * `const options: SheetOption[]` que la sigue, con el mismo filtro de comentarios:
 *
 *     const i = f.indexOf("const createOptions: SheetOption[]");
 *     const j = f.indexOf("const options: SheetOption[]", i);
 *     f.slice(i, j)
 *       .replace(/\/\*[\s\S]*?\*\//g, "")
 *       .replace(/(^|[^:])\/\/.*$/gm, "$1")
 *
 * Y las tres cosas que el guard de `create-page.test.ts` le pregunta al bloque
 * estan todas aca, sin interpretar: que las filas salen de `LIST_KIND_ORDER` —la
 * misma lista que leen el formulario de listas y `CreateSheet`—, que la etiqueta es
 * `t(LIST_KIND_LABEL[kind])`, y que al tocarse **delega el tipo y no cierra nada**:
 * `onCreateInside(kind)` y ni una palabra de cerrar.
 */
export const TIPOS_DE_LA_HOJA_VIEJA =
  'const createOptions: SheetOption[] = useMemo(\n' +
  '    () =>\n' +
  '      LIST_KIND_ORDER.map((kind): SheetOption => ({\n' +
  '        key: kind,\n' +
  '        label: t(LIST_KIND_LABEL[kind]),\n' +
  '        onPress: () => {\n' +
  '          onCreateInside(kind);\n' +
  '        },\n' +
  '      })),\n' +
  '    [onCreateInside, t],\n' +
  '  );';

/**
 * El flag que los conmutaba, y **la fila que lo llevaba**.
 *
 * `inside` era `renaming || confirmDelete || creatingKind !== null || sharing ||
 * pickingIcon`, y el menu se cerraba con `visible={pedido !== null && !inside}`.
 *
 * Se afirma el `!inside` del menu porque es lo que hace que los dos `Sheet` que lo
 * montan **no** se pisen: sin el, el menu seguiria visible debajo del panel que se
 * abre y un toque que llegara a la de arriba cerraria la de abajo.
 */
export const CONMUTADOR_DE_LA_HOJA_VIEJA = "visible={pedido !== null && !inside}";
