/**
 * El bloque `opciones` de la hoja vieja de nota, **tal cual estaba** y sin los
 * comentarios.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE Y NO SE LEE LA HOJA VIEJA
 * ------------------------------------------------------------------
 *
 * Porque la T7 borra `src/components/notes/note-menu-sheet.tsx` —si queda, hay dos
 * menus de nota y el que gana es el que se importa ultimo—, y un guard que lee un
 * archivo que se guardo se queda comprobando nada sin avisar. Esa es la mitad de
 * este patron que `menus-test-helpers.ts` existe para cazar, del otro lado: la
 * lista de filas esta congelada aca y el test la **parsea**, en vez de escribir a
 * mano las seis etiquetas que la hoja pintaba.
 *
 * Escritas a mano seria una copia del registro que se desincroniza en silencio: el
 * dia que el registro cambie, el test seguiria diciendo que las seis estan y
 * estaria mintiendo sobre algo que el mismo test puede comprobar.
 *
 * ------------------------------------------------------------------
 * COMO SE EXTRAJO, PARA QUE SE PUEDA REHACER
 * ------------------------------------------------------------------
 *
 * Del archivo, entre `const opciones: SheetOption[]` y el `if (step === "icon")`
 * que la sigue, quitando los comentarios de bloque y los de linea que no esten
 * dentro de una URL:
 *
 *     const i = f.indexOf("const opciones: SheetOption[]");
 *     const j = f.indexOf('if (step === "icon")', i);
 *     f.slice(i, j)
 *       .replace(/\/\*[\s\S]*?\*\//g, "")
 *       .replace(/(^|[^:])\/\/.*$/gm, "$1")
 *
 * Y da **cinco filas y seis etiquetas**: `delete` es una fila con dos, porque una
 * fila que cambia de copy con el estado —prestada o no— es una fila con dos
 * etiquetas.
 *
 * Lo que la hoja offeria y este bloque **no** dice, porque no era una fila:
 * `note.templates.saveCurrent` solo se ofrecia con `onSaveAsTemplate`, que era un
 * prop opcional. Eso es la capacidad `saveAsTemplate`, y lo decide el registro.
 */
export const BLOQUE_DE_LA_HOJA_VIEJA =
  'const opciones: SheetOption[] = [\n' +
  '    {\n' +
  '      key: "rename",\n' +
  '      label: t("note.rename"),\n' +
  '      icon: "create-outline",\n' +
  '      onPress: () => setStep("rename"),\n' +
  '    },\n' +
  '    {\n' +
  '      key: "icon",\n' +
  '      label: t("icons.title"),\n' +
  '      icon: "image-outline",\n' +
  '      onPress: () => setStep("icon"),\n' +
  '    },\n' +
  '    \n' +
  '    ...(puedeCompartir\n' +
  '      ? [\n' +
  '          {\n' +
  '            key: "share",\n' +
  '            label: t("share.pickSomeone"),\n' +
  '            icon: "people-outline" as const,\n' +
  '            description: t("share.isALink"),\n' +
  '            onPress: () => setStep("share"),\n' +
  '          },\n' +
  '        ]\n' +
  '      : []),\n' +
  '    ...(onSaveAsTemplate\n' +
  '      ? [\n' +
  '          {\n' +
  '            key: "template",\n' +
  '            label: t("note.templates.saveCurrent"),\n' +
  '            icon: "bookmark-outline" as const,\n' +
  '            onPress: () => onSaveAsTemplate(note),\n' +
  '          },\n' +
  '        ]\n' +
  '      : []),\n' +
  '    {\n' +
  '      key: "delete",\n' +
  '      \n' +
  '      label: note.shared ? t("common.deleteNotYours") : t("note.delete"),\n' +
  '      icon: "trash-outline",\n' +
  '      tone: "danger",\n' +
  '      disabled: busy || note.shared,\n' +
  '      ...(note.shared ? { description: t("common.deleteNotYoursHint") } : {}),\n' +
  '      onPress: () => void remove(),\n' +
  '    },\n' +
  '  ];';