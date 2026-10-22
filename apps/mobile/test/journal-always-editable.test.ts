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

  it("en la web el editor esta siempre; solo el movil descansa en el texto renderizado", () => {
    // El editor no recibe pulsaciones sobre un enlace en el movil (la libreria solo tiene
    // `onMentionPress` en el componente de solo lectura), asi que ahi un dia con texto se
    // lee renderizado y un toque en el texto abre el editor.
    expect(pagina).toMatch(/Platform\.OS !== "web" && !escribiendo && tieneTexto/);
    expect(vista).toContain("onMentionPress");
    expect(vista).toContain("onPress={onTextPress}");
    // Un enlace gana al toque de escribir: el contenedor decide tras un instante y mira si
    // algun enlace aviso.
    expect(vista).toContain("shouldEnterEdit(lastLinkPressAt.current, Date.now())");
    expect(vista).toContain("onLinkPress={onLinkPress}");
  });

  it("abrir el selector de menciones no cuenta como terminar de escribir", () => {
    // Si el foco que se va al abrir la hoja desmontara el editor, `onPick` se quedaria
    // sin editor al que escribir el enlace.
    expect(pagina).toContain("pickerAbierto.current");
    expect(pagina).toMatch(/!pickerAbierto\.current/);
  });

  it("el gesto de cambiar de dia se apaga mientras se escribe", () => {
    expect(pantalla).toContain(".enabled(!editing)");
    expect(pantalla).toContain("onEditingChange={setEditing}");
    // Y la pagina avisa de que ya no escribe cuando se va con su dia.
    expect(pagina).toMatch(/useEffect\(\(\) => \(\) => onEditingChange\?\.\(false\)/);
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
    expect(editor).toContain("const showToolbar = !readOnly && isFocused;");
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
