/**
 * El bloque `options` de la hoja vieja de lista, **tal cual estaba** y sin los
 * comentarios.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE Y NO SE LEE LA HOJA VIEJA
 * ------------------------------------------------------------------
 *
 * Porque la T6 borra `src/components/lists/list-menu-sheet.tsx` —si queda, hay dos
 * menus de lista y el que gana es el que se importa ultimo—, y un guard que lee
 * un archivo que se guardo se queda comprobando nada sin avisar. Esa es la mitad
 * de este patron que `menus-test-helpers.ts` existe para cazar, del otro lado: la
 * lista de filas esta congelada aca y el test la **parsea**, en vez de escribir a
 * mano las nueve etiquetas que la hoja pintaba.
 *
 * Escritas a mano seria una copia del registro que se desincroniza en silencio:
 * el dia que el registro cambie, el test seguiria diciendo que las nueve estan y
 * estaria mintiendo sobre algo que el mismo test puede comprobar. Parseando este
 * bloque, la tabla de `list-menu-parity.test.ts` queda **verificada contra el
 * fuente viejo** y no creida.
 *
 * Y el bloque va sin comentarios a proposito: la hoja vieja explica en su prosa
 * por que hace casi cada fila, y un filtro de claves se encontraria con esa prosa
 * y contaria etiquetas que nunca se pintaron. Lo que se extrae es lo que la hoja
 * **hacia**.
 *
 * ------------------------------------------------------------------
 * COMO SE EXTRAJO, PARA QUE SE PUEDA REHACER
 * ------------------------------------------------------------------
 *
 * Del archivo, entre `const options: SheetOption[]` y el `if (!list) return null`
 * que la sigue, quitando los comentarios de bloque y los de linea que no esten
 * dentro de una URL:
 *
 *     const i = f.indexOf("const options: SheetOption[]");
 *     const j = f.indexOf("if (!list) return null;", i);
 *     f.slice(i, j)
 *       .replace(BLOQUE, "")
 *       .replace(LINEA, "$1")
 *
 * Las etiquetas de fila salen con este filtro, que agarra el `label` tanto si es
 * una clave sola como si es un ternario entre dos, y corta en la siguiente
 * propiedad de la fila:
 *
 *     /label:([\s\S]{0,200}?),?\n\s*(icon|description|disabled|tone|onPress|key):/g
 *
 * Y da **siete filas y nueve etiquetas**, que es el numero del brief: `pin` y
 * `delete` son dos cada una, porque una fila que cambia de copy con el estado es
 * una fila con dos etiquetas.
 */
export const BLOQUE_DE_LA_HOJA_VIEJA = "const options: SheetOption[] = useMemo(() => {\n    if (!list) return [];\n    return [\n      ...(onEditStates\n        ? [\n            {\n              key: \"states\",\n              label: t(\"board.editStates\"),\n              icon: \"options-outline\" as const,\n              description: t(\"board.editStatesHint\"),\n              onPress: () => {\n                onClose();\n                onEditStates();\n              },\n            },\n          ]\n        : []),\n      {\n        key: \"rename\",\n        label: t(\"common.rename\"),\n        icon: \"create-outline\",\n        onPress: () => {\n          setName(list.title);\n          setPage(\"rename\");\n        },\n      },\n      {\n        key: \"pin\",\n        label: pinned\n          ? t(\"lists.unpinFromDashboard\")\n          : t(\"lists.pinToDashboard\"),\n        icon: pinned ? \"remove-circle-outline\" : \"apps-outline\",\n        description: t(\"lists.pinHint\"),\n        onPress: () => {\n          onClose();\n          void save(\n            pinned\n              ? withoutPinnedList(layout, list.id)\n              : withPinnedList(layout, list),\n          );\n        },\n      },\n      {\n        key: \"duplicate\",\n        label: t(\"lists.duplicate\"),\n        icon: \"copy-outline\",\n        description: t(\"lists.duplicateHint\"),\n        onPress: () => {\n          onClose();\n          void duplicateList(list);\n        },\n      },\n      \n      \n      \n      \n      \n      ...(list.role === \"owner\"\n        ? [\n            {\n              key: \"share\",\n              label: t(\"share.title\", { name: list.title }),\n              icon: \"people-outline\" as const,\n              \n              \n              \n              \n              description: t(\"share.isALink\"),\n              onPress: () => setPage(\"share\"),\n            },\n          ]\n        : []),\n      {\n        \n        key: \"export\",\n        label: t(\"export.list.title\"),\n        icon: \"download-outline\",\n        description: t(\"export.list.body\"),\n        onPress: () => setPage(\"export\"),\n      },\n      {\n        \n        key: \"delete\",\n        label: list.shared ? t(\"common.deleteNotYours\") : t(\"common.delete\"),\n        icon: \"trash-outline\",\n        tone: \"danger\",\n        description: list.shared\n          ? t(\"common.deleteNotYoursHint\")\n          : t(\"lists.deleteBody\", { count: list.itemCount }),\n        disabled: list.shared,\n        onPress: () => setPage(\"delete\"),\n      },\n    ];\n  }, [list, pinned, layout, t, onClose, onEditStates, duplicateList, save]);";
