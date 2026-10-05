import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * El teclado, y las dos trampas que lo hacian invisible.
 *
 * Las dos se pueden leer en el codigo y ninguna se ve en una captura, y por eso
 * este fichero mira **lo que el codigo dice** y no lo que se dibuja.
 */
const src = (ruta: string) => readFileSync(join(import.meta.dirname, '..', ruta), 'utf8');

describe('el teclado no tapa lo que se está escribiendo', () => {
  it('Screen esquiva el teclado en Android, no solo en iOS', () => {
    const screen = src('src/components/ui/screen.tsx');

    // `undefined` **no es un valor por defecto**: es no hacer nada. Con esto, cada
    // pantalla de la app tenia un `KeyboardAvoidingView` que no esquivaba nada en
    // Android, y parecian deliberadas porque el componente esta en el arbol.
    expect(screen, 'el behavior no puede depender de la plataforma').toContain('behavior="padding"');
    expect(
      screen,
      'un ternario que deja undefined en Android es un no-op disfrazado de configuracion'
    ).not.toMatch(/behavior=\{(?:[^}]*)undefined/);
  });

  it('Sheet mide el teclado a mano, porque un Modal en Android es otra ventana', () => {
    const sheet = src('src/components/ui/sheet.tsx');
    const hook = src('src/hooks/use-keyboard-height.ts');

    // Un `KeyboardAvoidingView` dentro de un `Modal` no oye el evento: el teclado se
    // mide contra la ventana de la actividad y el evento va ahi. Por eso la hoja
    // no lleva uno y lo que lleva es el alto, leido del evento.
    expect(sheet, 'la hoja tiene que usar el alto del teclado').toContain('useKeyboardHeight');
    expect(sheet, 'el relleno de abajo crece con el teclado').toMatch(/paddingBottom: teclado \+/);
    expect(hook, 'y el alto sale de los eventos del teclado').toContain('Keyboard.addListener');
  });

  it('iOS oye el teclado antes de que pase, Android despues, y no al reves', () => {
    const hook = src('src/hooks/use-keyboard-height.ts');
    // Preguntarle a Android cuanto va a medir devuelve 0: el panel daria un salto
    // al final. Y en iOS, con `keyboardDidShow`, el panel llega tarde y se ve
    // subir por debajo del teclado en vez de subir con el.
    expect(hook, 'iOS usa keyboardWillShow').toContain("'ios' ? 'keyboardWillShow' : 'keyboardDidShow'");
    expect(hook).toContain("'ios' ? 'keyboardWillHide' : 'keyboardDidHide'");
  });

  it('el alto del panel es un porcentaje sin teclado y absoluto con teclado', () => {
    const sheet = src('src/components/ui/sheet.tsx');

    // **Los dos, y por eso este testAsian dos mitades.**
    //
    // `maxHeight` en porcentaje se mide contra la ventana, y el teclado no encoge la
    // ventana — la encoge la vista — asi que un panel al 85% con el teclado abierto
    // llega 85% de una ventana que tiene el teclado delante. De ahi el alto absoluto.
    //
    // Y la otra mitad, que es la que este guard no comprobaba: sin teclado el
    // panel tiene que seguir teniendo su tope. El primer intento de esta prueba
    // solo miraba que existiera el `maxHeight` absoluto, asi que **paso con el
    // porcentaje borrado**, que es un panel sin limite en una hoja con veinte
    // opciones. Comprobar que algo nuevo esta presente no dice nada de que lo viejo
    // siga ahi.
    const estilo = sheet.match(/paddingBottom: teclado \+[\s\S]*?\]\}/)?.[0] ?? '';
    expect(estilo, 'con teclado, el alto es absoluto').toMatch(/maxHeight: Math\.round/);
    expect(
      estilo,
      'sin teclado, el alto sigue siendo un porcentaje: un panel sin tope en una hoja con veinte opciones'
    ).toMatch(/maxHeight: `\$\{Math\.round\(maxHeightRatio \* 100\)\}%`/);
    expect(sheet, 'y el alto sale de la ventana').toContain('useWindowDimensions');
  });

  it('un campo de una línea no se quita el foco al enviar, salvo en el último', () => {
    const campo = src('src/components/ui/text-field.tsx');

    // Sin esto la cadena se ejecuta y no se ve: el campo siguiente recibe el foco
    // y lo pierde en el mismo frame. Las dos ramas llaman a `onSubmitEditing`, asi
    // que ningun test de codigo lo distingue — solo se ve mirando donde quedo el
    // foco, y en el navegador.
    expect(campo, 'los campos que encadenan no pueden quitar el foco').toContain(
      'submitBehavior=',
    );
    expect(campo, 'y se decide por la tecla, no siempre igual').toMatch(
      /returnKeyType === 'done'[\s\S]{0,120}'blurAndSubmit'/,
    );
  });

  it('las hojas piden que un toque no cierre el teclado', () => {
    const sheet = src('src/components/ui/sheet.tsx');
    expect(sheet).toContain('keyboardShouldPersistTaps');
  });
});

describe('la cadena de campos llega a los seis formularios', () => {
  const formularios: Array<[string, number]> = [
    ['src/app/(auth)/sign-up.tsx', 4],
    ['src/app/(auth)/sign-in.tsx', 2],
    ['src/app/(auth)/reset-password.tsx', 2],
    ['src/components/notes/template-menu-sheet.tsx', 2],
    ['src/components/lists/item-edit-sheet.tsx', 2],
  ];

  it.each(formularios)('%s encadena sus campos', (ruta, n) => {
    const codigo = src(ruta);
    expect(codigo, 'tiene que usar la cadena').toContain('useFieldChain');
    expect(codigo, `y declararla con ${n} campos`).toContain(`useFieldChain(${n})`);
    // Un `register` por campo, y el ultimo de la cadena con `advance` hacia el
    // envio. Un `returnKeyType="next"` sin esto es una tecla que no hace nada.
    const registros = (codigo.match(/cadena\.register\(\d+\)/g) ?? []).length;
    expect(registros, 'cada campo de la cadena se registra').toBe(n);
    expect(codigo, 'y hay un advance en algun sitio').toContain('cadena.advance(');
  });

  it('el campo de un solo campo no se encadena consigo mismo', () => {
    // Meter un `next` en un formulario de un campo es un no-op con codigo.
    const codigo = src('src/components/ui/rename-sheet.tsx');
    expect(codigo, 'un solo campo hace su envio y listo').not.toContain('useFieldChain');
  });
});