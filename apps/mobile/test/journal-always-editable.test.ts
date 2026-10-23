import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(resolve(__dirname, "..", ruta), "utf8");
const pagina = leer("src/components/journal/journal-day-page.tsx");
const vista = leer("src/components/journal/journal-day-view.tsx");
const pantalla = leer("src/app/(app)/journal/index.tsx");
const editor = leer("src/components/notes/note-editor.tsx");
const dicc = leer("src/lib/i18n/dictionaries.ts");

describe("el diario no tiene modo editar/leer", () => {
  it("no hay boton de Editar ni de Leer: el usuario no elige un modo", () => {
    expect(pagina).not.toContain('t("journal.read")');
    expect(vista).not.toContain('t("journal.edit")</AppText>');
    expect(dicc).not.toContain('"journal.read"');
  });

  it("hay un solo modo: el editor, siempre, en la web y en el movil", () => {
    // Antes un dia con texto descansaba como texto renderizado en el movil (para poder pulsar
    // un chip) y un toque abria el editor: dos modos. Ya no: el editor no se desmonta nunca.
    expect(pagina).not.toContain("escribiendo &&");
    expect(pagina).not.toContain("JournalDayView");
    expect(pagina).not.toContain("setEscribiendo");
    expect(pagina).toContain("<NoteEditor");
  });

  it("tocar un chip mientras se edita abre un menu: abrir, cambiar o quitar el enlace", () => {
    expect(pagina).toContain("onMentionTap={Platform.OS === \"web\" ? undefined : onChipTouched}");
    expect(pagina).toContain('t("journal.chip.open")');
    expect(pagina).toContain('t("journal.chip.change")');
    expect(pagina).toContain('t("journal.chip.unlink")');
    // El selector de "Cambiar enlace" espera a que el menu se haya ido: dos Modal a la vez no se muestran.
    expect(pagina).toContain("setTimeout(() => setPickerOpen(true), SHEET_EXIT_MS)");
    // En la web el clic se lee de la pagina y abre el mismo menu, en vez de navegar de golpe.
    expect(pagina).toContain("onChipTouched({");
    expect(pagina).not.toMatch(/router\.push\(found\.route/);
  });

  it("el editor deduce el toque de un chip: cursor DENTRO, sin haber tecleado", () => {
    expect(editor).toContain("chipAtCaret(html, start)");
    expect(editor).toContain("Date.now() - lastTypedAt.current < 600");
    // No se repite el aviso mientras el cursor siga en el mismo chip.
    expect(editor).toContain("chipUnderCaret.current === key");
  });

  it("al cerrar el menu el cursor queda tras el chip, para poder volver a tocarlo", () => {
    expect(pagina).toContain("editorRef.current?.setSelection(found.match.plainEnd, found.match.plainEnd)");
  });

  it("el swipe de dias funciona escribiendo o no, en toda la pagina", () => {
    // En Android el editor nativo cancela el gesto de RNGH (`begin` y `finalize ok=false`), pero
    // React Native entrega los toques crudos de la pagina entera: ahi se decide el swipe.
    expect(pantalla).toContain("onTouchStart, onTouchMove, onTouchEnd, onTouchCancel");
    expect(pantalla).toContain("classifyDrag(dx, point.pageY - start.y)");
    expect(pantalla).toContain("swipeDirection(dx, dx / seconds, width)");
    // No se le quita el toque a nadie: ningun responder, el editor sigue siendo del editor.
    expect(pantalla).not.toContain("onStartShouldSetResponder");
    expect(pantalla).not.toContain("onMoveShouldSetResponder");
    // El editor crece a su contenido y la pagina hace el scroll, para no pedir el toque a sus padres.
    expect(pagina).toContain("autoGrow");
    expect(editor).toContain("scrollEnabled={autoGrow ? false : undefined}");
  });

  it("en la web sigue el gesto con el raton, que se apaga al escribir porque arrastrar es seleccionar", () => {
    expect(pantalla).toContain('.enabled(Platform.OS === "web" && !editing)');
    expect(pantalla).toContain("onEditingChange={setEditing}");
    // Y la pagina avisa de que ya no escribe cuando se va con su dia.
    expect(pagina).toMatch(/useEffect\(\(\) => \(\) => onEditingChange\?\.\(false\)/);
    expect(pagina).toContain("isTyping({");
    expect(pagina).toContain("onEditingChange?.(escribiendo);");
  });
});

describe("el drawer no tiene un menu general de notas", () => {
  const drawer = leer("src/components/layout/drawer.tsx");

  it("una nota vive en un espacio o carpeta; lo unico global son las plantillas", () => {
    expect(drawer).not.toContain('route: "/(app)/notes"');
    expect(drawer).not.toContain('labelKey: "notes.title"');
    expect(drawer).toContain('route: "/(app)/templates"');
    expect(drawer).toContain('labelKey: "note.templates"');
  });
});

describe("copiar o pasar un dia a otro", () => {
  it("la pantalla ofrece las dos y no las ofrece con el dia vacio", () => {
    expect(pantalla).toContain("transferJournalDay(");
    expect(pantalla).toContain("disabled: !dayHasText");
    expect(pantalla).toContain('"copy"');
    expect(pantalla).toContain('"move"');
  });

  it("guarda lo escrito antes de copiar, y abre despues el dia de destino", () => {
    const flujo = pantalla.slice(pantalla.indexOf("await flushRef.current?.();\n            await transferJournalDay"));
    expect(flujo.indexOf("transferJournalDay")).toBeGreaterThan(-1);
    expect(flujo.indexOf("transferJournalDay")).toBeLessThan(flujo.indexOf("moveTo(picked)"));
  });
});

describe("la barra de formato de las notas ya no es fija", () => {
  it("solo existe mientras el editor tiene el foco", () => {
    expect(editor).toContain("isTyping({ focused: isFocused, keyboardHeight, platform: Platform.OS })");
    expect(editor).toContain("showToolbar && !floating");
    expect(editor).toContain("showToolbar && floating && anchor");
  });

  it("en escritorio flota junto a la seleccion, y pulsarla no quita el foco al editor", () => {
    expect(editor).toContain('Platform.OS === "web" && width >= FLOATING_TOOLBAR_MIN_WIDTH');
    expect(editor).toContain('addEventListener("mousedown", keepFocus)');
  });

  it("en movil va encima del teclado y sus botones no cierran el teclado al pulsarse", () => {
    expect(editor).toContain("bottom: keyboardOverlap");
    expect(editor).toContain('keyboardShouldPersistTaps="always"');
  });

  it("el tachado y el resto de formatos se dibujan con letra, no con iconos que no existen", () => {
    // El nombre sigue apareciendo en un comentario que explica por que se quito: lo que no puede
    // volver es usarlo como icono.
    expect(editor).not.toMatch(/icon: "strikethrough-variant"/);
    expect(editor).toContain('letter: { text: "S", style: "strike" }');
  });
});
