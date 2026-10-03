# Color libre en las etiquetas, y la fila que se abre desde la pastilla — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el color de una etiqueta sea cualquier hex elegido en un selector, que la pastilla lo pinte como las insignias (relleno tintado + texto del mismo tono derivado hasta 4.5:1), y que insignia y pastilla abran la hoja de la tarea.

**Architecture:** El contrato pasa de enum de doce a hex, aceptando además los nombres viejos y normalizándolos a hex al pasar por el servidor, para no tirar los colores que ya hay guardados. Una función pura deriva el par `{relleno, texto}` de una pastilla mezclando el color con la superficie y oscureciéndolo o aclarándolo hasta que llega a 4.5:1. Un componente nuevo de selector de color monta en dos sitios de la hoja. `TagChip` y `Badge` aceptan un `onPress` opcional en vez de envolverse.

**Tech Stack:** Expo / React Native + React Native Web, TypeScript, Zod (contrato compartido), Drizzle (jsonb), vitest, Tailwind-free `StyleSheet`, Chromium vía CDP para la verificación en navegador.

**Spec:** `docs/superpowers/specs/2026-10-03-color-libre-y-pastilla-pressable-design.md`

## Global Constraints

- El contraste mínimo de una pastilla es **4.5:1** (`MIN_LABEL_CONTRAST`), medido contra **su propio relleno**, nunca contra un fondo supuesto.
- El relleno de una pastilla es el color **mezclado con la superficie al 14%**.
- El texto se deriva en pasos de **2 puntos de luminosidad HSL**, 60 pasos como máximo, hacia **negro en claro** y **blanco en oscuro** —
  **y, si con la dirección del esquema no alcanza, en la contraria.** Una sola dirección NO funciona: sobre el relleno oscuro
  `#1B2231`, `neutral` se queda en 3.80:1 aclarándose y `blue` baja a 3.46:1 oscureciéndose. El contraste con blanco y con negro
  **multiplican por 21** siempre, así que al menos uno de los dos es **√21 ≈ 4,58**: se tiene que poder llegar a los dos extremos.
- Un hex se acepta con **tres o seis** dígitos, con `#` o sin él, y **se guarda siempre en seis**: `#fff` entra y se guarda `#FFFFFF`. `esHex` de `lib/workspace/hsl.ts` ya acepta los dos anchos **a propósito** —su comentario dice que estrecharlo convirtió un camino que funcionaba en el color de reserva, y que dos tests lo cazaron en una sola ejecución—, así que el mapa tiene una sola representación de cada color y no dos.
- El mapa `lists.tagColors` guarda `etiqueta -> hex`. Los nombres de la paleta se **normalizan a hex** al pasar por `sanitiseTagColors`; el valor guardado nunca es un nombre.
- `derivedTagColor(nombre)` **no cambia**: sigue siendo el FNV-1a dentro de los doce, y su valor golden no se toca.
- La sanitización del color vive **en el servidor** (`sync-service.ts`), nunca en el cliente.
- No hay de reservados: la validación es de contrato y vive en `packages/contracts`.
- Todo en `docs/superpowers/specs/` y `docs/superpowers/plans/` se escribe **sin tildes**.
- **Antes del primer typecheck, `npm run build:packages`.** El `typecheck` del root
  lo hace solo y el del workspace no, asi que `npm run typecheck --workspace
  @orbit-hub/mobile` con `packages/contracts/dist` viejo falla con errores que no
  son de este trabajo: la API no arranca con `does not provide an export named
  'sanitiseTagColors'` si el paquete no esta compilado. Pasa lo mismo con la Tarea 1,
  que **cambia el contrato**: sin recompilar, el movil sigue viendo el enum de doce.
- Ninguna medida de este trabajo es de un teléfono. Todas son de **web a 390×844**, y eso incluye dónde cabe el selector.

## Review Focus

Cinco entradas que el spec insinúa y que es fácil no cubrir. Cada una tiene su prueba en la tarea dueña.

1. **Un color elegido casi igual a la superficie.** El relleno sale casi igual a la superficie y el texto tiene que leerse *contra ese relleno*. Se cubre en la Tarea 2 con un color igual al de la superficie.
2. **Un color guardado por un build viejo, con nombre (`'green'`).** Tiene que pintarse verde y no neutral. Se cubre en la Tarea 1 (normalización) y en la Tarea 3 (lectura).
3. **`#ff` o `#ggg` en el campo del selector, y un mapa con basura.** `#fff` entra y sale en `#FFFFFF`; lo que no tiene tres ni seis digitos lo rechaza el campo, y si aun asi llega al mapa lo tira el servidor. Se cubre en la Tarea 4 (campo) y en la Tarea 1 (sanitización).
4. **Una etiqueta de 40 caracteres con un hex libre.** La pastilla no puede empujar la fila. Se cubre en la Tarea 7, donde ya hay una comprobación de la etiqueta de 40 caracteres.
5. **La hoja con el selector abierto y ocho etiquetas encima.** La página tiene que seguir desplazándose y el botón de añadir tiene que seguir alcanzable. Se cubre en la Tarea 7, y es el riesgo que el spec admite por escrito.

---

### Task 1: El contrato acepta un hex libre y normaliza los nombres viejos

**Files:**
- Modify: `packages/contracts/src/tag-colors.ts`
- Modify: `apps/mobile/src/hooks/use-lists.ts:327` — `setTagColor`
- Modify: `apps/mobile/src/lib/lists/tag-colors.ts:22` — `planTagColorChange`, y `:115` — `labelTextColor`
- Modify: `apps/mobile/src/components/lists/item-edit-sheet.tsx` — `onTagColor`, `pickColor`, `colorOf` y las props de `TagColorStrip`
- Test: `apps/mobile/test/tag-colors.test.ts` — **los tests de `sanitiseTagColors` ya viven aqui**, no hay que crear un fichero de pruebas en el contrato. Se anaden aqui los nuevos.

> **Por que toca cuatro ficheros mas.** Cambiar `TagColors` de
> `Record<string, ItemIconColor>` a `Record<string, string>` deja de compilar todo
> lo que toma el color como enum, y **`use-lists.ts` no es de ninguna otra tarea**.
> Esta tarea **ensancha las firmas, sin cambiar comportamiento**; el comportamiento
> nuevo llega en la Tarea 5 sobre el mismo `item-edit-sheet.tsx`. La API no se toca:
> `content-schema.ts:325` usa `TagColors` como `$type` y no asume el enum.

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces:
  - `export const TAG_HEX: RegExp` — `/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/`, el mismo patron que `esHex`
  - `export function normalizaColor(texto: unknown): string | null` — `#aabbcc` / `aabbcc` / `#AbC` -> `#AABBCC`; lo demas -> `null`
  - El color de un icono sigue siendo `ItemIconColor`. El de una etiqueta, un `string`.
  - `export type TagColors = Record<string, string>` (cambia: el valor deja de ser `ItemIconColor` y pasa a `string`)
  - `export function sanitiseTagColors(value: unknown): TagColors` — ahora **normaliza** un nombre de la paleta a su hex y descarta lo que no sea ni hex ni nombre.

- [ ] **Step 1: Escribir el test que falla**

En el fichero de pruebas del contrato, con estos nombres exactos:

```ts
it("acepta un hex libre", () => {
  expect(sanitiseTagColors({ Mercadona: "#3B5FDE" })).toEqual({ Mercadona: "#3B5FDE" });
});

it("convierte un nombre viejo de la paleta en su hex", () => {
  // Un build anterior guardaba "green". No se puede descartar: es un color que
  // alguien eligió, y perderlo en silencio es peor que perder el formato.
  expect(sanitiseTagColors({ Mercadona: "green" })).toEqual({ Mercadona: "#16A34A" });
});

it("descarta lo que no es un color y conserva lo demas", () => {
  expect(sanitiseTagColors({ Mercadona: "#3B5FDE", Alcampo: "no-es-un-color" })).toEqual({
    Mercadona: "#3B5FDE",
  });
});

it("amplia un hex de tres digitos a seis", () => {
  // `esHex` ya acepta los dos anchos y hay un motivo escrito: estrecharlo
  // convertio en el color de reserva un camino que funcionaba. `#fff` es blanco
  // sin ambiguedad, y el mapa guarda una sola forma de cada color.
  expect(sanitiseTagColors({ Mercadona: "#fff" })).toEqual({ Mercadona: "#FFFFFF" });
  expect(sanitiseTagColors({ Mercadona: "#AbC" })).toEqual({ Mercadona: "#AABBCC" });
});

it("descarta lo que no tiene tres ni seis digitos", () => {
  expect(sanitiseTagColors({ Mercadona: "#ff" })).toEqual({});
  expect(sanitiseTagColors({ Mercadona: "#fffffff" })).toEqual({});
});

it("no puede lanzar, con ningun hex que llegue", () => {
  for (const malo of ["", "#", "#12", "#1234567", "  ", "rgb(1,2,3)", null, 7, {}]) {
    expect(() => sanitiseTagColors({ Mercadona: malo })).not.toThrow();
  }
});
```

> El hex de `green` **no lo saques de memoria**: está en `ICON_COLORS` de `apps/mobile/src/lib/lists/item-icons.ts`, que es un fichero del móvil y el contrato no lo puede importar. Cópialo a mano y deja un comentario diciendo de dónde sale.

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest run packages/contracts` (o el workspace que lo contenga)
Expected: FAIL — `"acepta un hex libre"` falla con `{}` recibido, porque la paleta no incluye `"#3B5FDE"`.

- [ ] **Step 3: Implementar**

En `packages/contracts/src/tag-colors.ts`:

- Los doce nombres a hex, en una constante local `PALETA_A_HEX: Record<string, string>`, con los doce valores de `ICON_COLORS` (`item-icons.ts:104-133`).
- `tagColorSchema` pasa el valor a `z.string()`; la clave sigue siendo `z.string().trim().min(1).max(40)`.
- `normalizaColor` es el **dueño** del formato en el repositorio, y vive aqui porque `packages/contracts` no puede importar de `apps/mobile`. El movil tiene su validador —`esHex`, en `lib/workspace/hsl.ts`— y **los dos tienen que aceptar exactamente lo mismo**.
- En `sanitiseTagColors`: `const hex = normalizaColor(color)`; si sale un hex se guarda ese; si no, si el valor está en `PALETA_A_HEX` se guarda su hex; si no, se descarta.

  La mayúscula es para que `"#aabbcc"` y `"#AABBCC"` no sean dos colores distintos en el mapa. Normaliza también el nombre de la clave con `trim()`, como ya hace.

- Actualiza el comentario de `tagColorSchema`, que hoy dice que un color de etiqueta es un color de icono, y deja escrito por qué ya no: la paleta de iconos sigue siendo de doce y la de etiquetas es libre, y `derivedTagColor` sigue sacando de los doce porque deducir es otra cosa.

- [ ] **Step 4: Correr y ver que pasa**

Run: el mismo comando.
Expected: PASS los cinco.

- [ ] **Step 5: Ensanchar las cuatro firmas que toman el color**

Sin cambiar comportamiento, solo el tipo:

- `use-lists.ts:327` — `setTagColor(list, tag, color: string | null)`, y quita `ItemIconColor` del import si se queda sin uso.
- `tag-colors.ts:22` — `planTagColorChange(map, tag, color: string | null)`.
- `tag-colors.ts:115` — `labelTextColor(colour: string, ...)`. **Esta la borra la Tarea 3**; aquí solo se ensancha para que el arbol compile.
- `item-edit-sheet.tsx` — `onTagColor` (`:70`), `pickColor` (`:333`), `colorOf` (`:252`) y las props de `TagColorStrip` (`:863`, `:938`, `:939`), todas a `string`.

Run: `npm run typecheck --workspace @orbit-hub/mobile`
Expected: **limpio**. Si algo sigue quejándose de `ItemIconColor`, es un consumidor que no estaba en la lista y hay que encontrarlo antes de seguir.

- [ ] **Step 6: Actualizar el test de la API que fija el formato viejo**

`apps/api/test/sync.test.ts` tiene `expect(list.body.data.tagColors).toEqual({ Mercadona: 'green' })`. Pasa a `toEqual({ Mercadona: '#16A34A' })` y el comentario de al lado, que dice "el que no pudo se descartó en vez de guardarse", debe actualizarse: ahora lo que no puede es `"no-es-un-color"`, y lo que **no** puede pasar es un nombre viejo siendo descartado.

Run: `npm run test --workspace @orbit-hub/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/tag-colors.ts apps/mobile/src/hooks/use-lists.ts apps/mobile/src/lib/lists/tag-colors.ts "apps/mobile/src/components/lists/item-edit-sheet.tsx" apps/mobile/test/tag-colors.test.ts apps/api/test/sync.test.ts
git commit -m "El color de una etiqueta es un hex, y los nombres viejos se convierten"
```

---

### Task 2: La pastilla deriva relleno y texto

**Files:**
- Modify: `apps/mobile/src/lib/lists/tag-colors.ts`
- Test: `apps/mobile/test/tag-colors.test.ts`

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces:
  - `export function mixHex(a: string, b: string, t: number): string` — interpolación lineal por canal, redondeada.
  - `export function tagColorHex(colour: string): string` — si `colour` es hex, **la devuelve tal cual**; si es un nombre de la paleta, su hex; si no, `ICON_COLORS.neutral`.
  - `export function labelPillColors(colour: string, surface: string, scheme: "light" | "dark"): { fill: string; text: string }`

  > `tagColorHex` **no** puede ser `iconColor` de `item-icons.ts`: esa devuelve neutral para lo que no conoce, así que un hex libre volvería neutral. Por eso es una función nueva.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("el relleno es el color mezclado con la superficie", () => {
  // La composicion se afirma con `mixHex` y no con un hex escrito a mano: el
  // redondeo del ultimo canal es lo unico que haria fallar un numero fijo, y eso
  // no es lo que este test comprueba.
  expect(labelPillColors("#16A34A", "#FFFFFF", "light").fill).toBe(
    mixHex("#16A34A", "#FFFFFF", 0.14),
  );
});

it("mixHex interpola y redondea", () => {
  // 127.5 rounds to 128: el unico valor de la mezcla que no admite dos respuestas.
  expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  expect(mixHex("#16A34A", "#FFFFFF", 0)).toBe("#16A34A");
  expect(mixHex("#16A34A", "#FFFFFF", 1)).toBe("#FFFFFF");
});

it("el texto llega a 4.5:1 contra su propio relleno", () => {
  // Los hex son de `ICON_COLORS`, la paleta de doce. **No** son los del tema:
  // `success` es #0E9F6E y `green` de la paleta es #16A34A, y con el valor
  // equivocado la pastilla se dibujaria de un color y se guardaria otro.
  for (const color of ["#16A34A", "#D97706", "#2563EB", "#9333EA", "#E11D48"]) {
    for (const scheme of ["light", "dark"] as const) {
      const surface = scheme === "light" ? "#FFFFFF" : "#111827";
      const { fill, text } = labelPillColors(color, surface, scheme);
      expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
    }
  }
});

it("lee tambien cuando el color es casi el de la superficie", () => {
  // El peor caso: un color elegido tan parecido a la superficie que el relleno
  // sale casi igual que ella. El texto tiene que leerse contra ESE relleno.
  const surface = "#F0F2F8";
  const { fill, text } = labelPillColors("#EFF1F7", surface, "light");
  expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
});

it("lee con un blanco puro y con un negro puro", () => {
  expect(contrastRatio(labelPillColors("#FFFFFF", "#FFFFFF", "light").text, labelPillColors("#FFFFFF", "#FFFFFF", "light").fill))
    .toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
  expect(contrastRatio(labelPillColors("#000000", "#111827", "dark").text, labelPillColors("#000000", "#111827", "dark").fill))
    .toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
});

it("un hex libre sale tal cual y un nombre viejo sale en su hex", () => {
  expect(tagColorHex("#3B5FDE")).toBe("#3B5FDE");
  expect(tagColorHex("green")).toBe("#16A34A");
});
```

- [ ] **Step 2: Correr y ver que falla**

Expected: FAIL con `labelPillColors is not defined`.

- [ ] **Step 3: Implementar**

- `mixHex(a, b, t)`: quita el `#`, pasa a entero, interpola cada canal `a + (b - a) * t`, redondea, devuelve `#RRGGBB` en mayúsculas.
- `tagColorHex`: `normalizaColor(colour) ?? PALETA_A_HEX[colour] ?? ICON_COLORS.neutral`, importando `normalizaColor` del contrato y `ICON_COLORS` de `item-icons.ts`. **La paleta no se copia a mano**: `ICON_COLORS` ya se exporta y se importa.

  Y un test ata los dos validadores, para que no se separen:

```ts
it("el validador del movil y el del contrato aceptan lo mismo", () => {
  for (const candidato of ["#fff", "fff", "#FFFFFF", "aabbcc", "#AbC", "#ff", "#gggggg", "", 7, null]) {
    expect(esHex(candidato)).toBe(normalizaColor(candidato) !== null);
  }
});
```

  La razon de que este test exista: si un dia `esHex` se estrecha o `normalizaColor` se ensancha, el usuario tendria un campo que acepta un color y un mapa que lo guarda y otro que no. Son dos y solo uno puede tener razon.
- `labelPillColors`: `fill = mixHex(hex, surface, 0.14)`. Para `text`, **dos barridos**: primero la dirección del esquema —luminosidad
  HSL hacia 0 en claro, hacia 100 en oscuro—, y si tras 60 pasos no ha llegado a
  `MIN_LABEL_CONTRAST`, **el barrido contrario**. El segundo no es opcional: la version de
  una sola dirección **falla con cuatro de los doce** sobre el relleno oscuro.
  Devuelve el primer candidato que pasa.

  Deja escrito en el comentario **por qué converge**, y con la cuenta, no con la
  intuicion: los contrastes con blanco y con negro **multiplican por 21** para
  cualquier luminancia de relleno, `(1,05/(L+0,05))·((L+0,05)/0,05) = 21`, asi que
  **al menos uno de los dos es √21 ≈ 4,58**. Ese es el motivo por el que desaparece la
  puerta de contraste en vez de moverse, y por el que hacen falta **los dos**
  barridos: hay que poder llegar a los dos extremos.

- [ ] **Step 4: Correr y ver que pasa**

Expected: PASS los cinco.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/lists/tag-colors.ts apps/mobile/test/tag-colors.test.ts
git commit -m "La pastilla deriva el texto hasta que se lee, en vez de rendirse"
```

---

### Task 3: `TagChip` pinta los dos colores

**Files:**
- Modify: `apps/mobile/src/components/lists/tag-chip.tsx`
- Test: `apps/mobile/test/tag-colors.test.ts`

**Interfaces:**
- Consumes: `labelPillColors(colour, surface, scheme)` y `tagColorHex(colour)` de la Tarea 2; `derivedTagColor` del contrato.
- Produces: `TagChip` con la misma firma, y su `colors` pasa a ser `TagColors | undefined` donde el valor es un hex.

- [ ] **Step 1: Escribir el test que falla**

```ts
it("el texto de la pastilla no sale nunca en el color del tema", () => {
  const tema = { surface: "#F0F2F8", text: "#0E1220", scheme: "light" as const };
  for (const color of ITEM_ICON_COLORS) {
    const { text } = labelPillColors(iconColor(color), tema.surface, tema.scheme);
    expect(text).not.toBe(tema.text);
  }
});
```

- [ ] **Step 2: Correr y ver que falla**

Expected: FAIL, porque `labelTextColor` devuelve el color del tema para nueve de los doce.

- [ ] **Step 3: Implementar**

En `TagChip`, sustituye el `fill`/`text` fijo por una llamada a `labelPillColors`, pasando `theme.colors.surfaceMuted` como superficie y `theme.scheme === "dark" ? "dark" : "light"` como esquema.

`colors?.[tag]` es ahora un hex; `derivedTagColor(tag)` sigue devolviendo un nombre. **Pasa los dos por `tagColorHex`**, que es lo que hace que un nombre viejo guardado en el mapa siga pintándose en su color y no en neutral.

Borra `labelTextColor` — que tiene **una** llamada de produccion, en `tag-chip.tsx:61`, y seis
de test en `tag-color-plan.test.ts`, que Task 3 borra—.

**`MIN_LABEL_CONTRAST` NO se borra, en ningun caso.** `labelPillColors` lo usa, y es
permanente: es el liston que la pastilla tiene que cruzar. El plan de antes decia
"borralo si queda solo en este fichero", y despues de esta tarea **si** queda solo en
este fichero —porque `labelTextColor` era la otra llamada— y borrarlo rompe la funcion
que Task 4 y Task 5 heredan. Que el revisor de esta tarea loوصلo.

Y los tests **deben llevar el 4.5 escrito a mano**, no leer el constante: este fichero
dice en su cabecera que el test lo escribe a proposito para que bajen los dos a la vez,
y los tests nuevos de esta tarea lo leen. Si alguien baja `MIN_LABEL_CONTRAST` a 4.0, con
el test leyendo el constante **toda la suite se pone verde** mientras cada pastilla
baja del liston en silencio. Hoy el unico sitio con un 4.5 escrito a mano es
`tag-color-plan.test.ts`, **y Task 3 lo borra entero**: sin esto, la puerta se puede
bajar sin que nada lo note.

- [ ] **Step 4: Correr los dos Conjuntos**

Run: `npx vitest run apps/mobile/test/tag-colors.test.ts` y `npm run test --workspace @orbit-hub/mobile`
Expected: PASS.

**Y borra aqui, no en la Tarea 7, los dos tests que fijan la puerta de contraste**:
`"usa el color del tema cuando el de la etiqueta no se lee"` y `"pinta el color
del tema antes que un color que no se puede calcular"`. Fijan exactamente lo que
esta tarea quita, asi que entre la Tarea 3 y la Tarea 7 el arbol estaria en rojo, y
la Tarea 7 leeria tests que ya no existen. En su lugar queda el de arriba.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/lists/tag-chip.tsx apps/mobile/src/lib/lists/tag-colors.ts apps/mobile/test/tag-colors.test.ts
git commit -m "La pastilla pinta relleno y texto, y el texto ya no es del tema"
```

---

### Task 4: El selector de color

**Files:**
- Create: `apps/mobile/src/components/lists/tag-color-picker.tsx`
- Test: `apps/mobile/test/tag-color-picker.test.ts`

**Interfaces:**
- Consumes: `HUE_STRIP`, `hexToHsv`, `hsvToHex`, `puntoAHsv`, `puntoAHue` de `@/lib/workspace/picker`; `normalizaColor` del contrato.
- Produces:

```ts
export interface TagColorPickerProps {
  /** The colour currently chosen, or `null` for "derived from the name". */
  value: string | null;
  /** Called on every committed choice. `null` means "go back to derived". */
  onChange: (hex: string | null) => void;
  /** Omitted when the picker is mounted for a label that does not exist yet. */
  onClose?: () => void;
  /** The label name, used for the accessibility labels. */
  tag?: string;
}
export function TagColorPicker(props: TagColorPickerProps): JSX.Element;
```

  Además, y esto es lo que sí se prueba sin navegador:

```ts
export function normalizaHex(texto: string): string | null;  // "#aabbcc" -> "#AABBCC"; "#fff" -> "#FFFFFF"; "#ff" -> null
export function hexDeHsv(h: number, s: number, v: number): string;
```

- [ ] **Step 1: Los tests de la lógica, que es lo unico comprobable sin navegador**

```ts
it("normaliza un hex de seis digitos a mayusculas", () => {
  expect(normalizaHex("#aabbcc")).toBe("#AABBCC");
  expect(normalizaHex("aabbcc")).toBe("#AABBCC");
});

it("amplia un hex de tres digitos y no acepta los demas", () => {
  // `esHex` ya acepta tres y seis, y hay un comentario en `hsl.ts` que explica
  // que se dejo asi a proposito. Este selector no puede ser mas estrecho que el
  // de los espacios: el mismo usuario, el mismo campo, dos reglas distintas.
  expect(normalizaHex("#fff")).toBe("#FFFFFF");
  expect(normalizaHex("#ff")).toBeNull();
  expect(normalizaHex("#gggggg")).toBeNull();
  expect(normalizaHex("")).toBeNull();
});

it("el color del cuadro y el del campo son el mismo", () => {
  // `Hsv` es `{ h: 0-360 grados, s: 0-1, v: 0-1 }` — la s y la v van de 0 a 1,
  // no de 0 a 100. Es la forma que ya espera `puntoAHsv`.
  const hsv = hexToHsv("#3B5FDE");
  expect(hexDeHsv(hsv.h, hsv.s, hsv.v)).toBe("#3B5FDE");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Expected: FAIL, `normalizaHex is not defined`.

- [ ] **Step 3: Implementar la lógica**

`normalizaHex` **envuelve a `normalizaColor` del contrato**, que es el dueño del
formato. No escribas un segundo `RegExp` de hex en este fichero: el movil y el
contrato tienen que aceptar exactamente lo mismo, y por eso hay un test que los
compara en la Tarea 2.

`hexDeHsv` es una envoltura de `hsvToHex` que devuelve mayúsculas.

- [ ] **Step 4: Correr y ver que pasan**

Expected: PASS los tres.

- [ ] **Step 5: Implementar la interfaz**

Monta, en este orden: los **doce** predefinidos con su nombre y el estado "elegido" marcado; la **tira de tono**; el **cuadro de saturación**; el **campo hex**; y los **recientes** leídos de donde guards los del selector de espacios, si hay un sitio común, y si no, de un estado local con los de esta sesión.

El botón de "volver al color deducido" va **arriba**, antes de los predefinidos, y llama `onChange(null)`.

Cada camino que elija un color pasa por `normalizaHex` o por un predefinido, y **un valor que no pasa no se llama `onChange`**: un color que no existe en el mapa es un color que el servidor se come en silencio.

- [ ] **Step 6: Lo que este componente NO tiene**

**No tiene test de interfaz.** Este repo no monta componentes en vitest —`apps/mobile/test/task-row-layout.test.ts` lee el fuente y `color-picker-math.test.ts` prueba la matemática—, así que la interfaz del selector **solo se comprueba en el navegador**, en la Tarea 7. Deja eso escrito en el comentario de cabeza del componente, para que nadie dé por hecho que está probado.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/components/lists/tag-color-picker.tsx apps/mobile/test/tag-color-picker.test.ts
git commit -m "El selector de color de una etiqueta, con doce atajos y color libre"
```

---

### Task 5: El selector en la hoja, en los dos montajes

**Files:**
- Modify: `apps/mobile/src/components/lists/item-edit-sheet.tsx`

**Interfaces:**
- Consumes: `TagColorPicker`, `normalizaHex` de la Tarea 4; `planTagColorChange` y `setTagColor` que ya existen; `TagColors` de la Tarea 1.
- Produces: nada que otras tareas necesiten. `pickColor` cambia el **segundo**
  parametro de `ItemIconColor | null` a `string | null`; el primero sigue siendo
  el nombre de la etiqueta.

- [ ] **Step 1: Quitar `TagColorStrip`**

Borra el componente `TagColorStrip` de este fichero. Sus dos llámadas —una por cada etiqueta que la tarea lleva— pasan a montar `TagColorPicker` con `value={tagColors[tag] ?? null}` y `onChange={(hex) => void pickColor(tag, hex)}`, envuelto en el mismo `colorDe === tag` que ya decide si se abre.

**El boton que abre el selector no se toca.** Es el mismo, en el mismo sitio, y por eso editar el color de una etiqueta ya creada se hace con lo mismo delante que elegirlo al crearla.

- [ ] **Step 2: Montar el selector bajo el input, con color pendiente**

Estado nuevo: `pendiente: string | null` — el color elegido para una etiqueta que **todavia no existe**.

Debajo del `TextField` de etiqueta nueva, y siempre visible:

```tsx
<TagColorPicker
  tag={newTag.trim() || undefined}
  value={pendiente}
  onChange={(hex) => setPendiente(hex)}
/>
```

- [ ] **Step 3: Que el alta escriba el color, y solo si hay color**

En `addTag`, tras el `save({ tags: [...] })` de siempre:

```ts
if (pendiente) await onTagColor(trimmed, pendiente);
setPendiente(null);
```

**`onTagColor`, que es una prop de la hoja, no `setTagColor`.** La hoja recibe
`listId` y `tagColors`, no la lista; quien escribe es el padre, y por eso el
`onTagColor` que ya existe es por donde se escribe y no por donde se ideo.

`onTagColor` escribe la **lista** y `save` escribe la **tarea**: son dos
entidades distintas y por eso no se pisan. **`pendiente` es opcional**: sin
color, la etiqueta sale deducida y no se escribe nada en `tagColors`.

**El guard `guardando` tambien entra aqui.** Ese guard esta porque
`setTagColor` planifica desde la `list` que su llamante capturo: dos escrituras
dentro de una misma darian las dos desde el mismo mapa y la segunda se comeria
la primera en silencio. El alta con color son dos escrituras seguidas, asi que
**comparte el guard con `pickColor`**: si se estan escribiendo, la segunda no
entra. No es un detalle, es el motivo por el que ese guard existe.

Cuando `newTag` se vacía, `pendiente` se vacía con él: **sin nombre no hay etiqueta a la que un color pertenezca**, y un color colgado de un nombre que ya no existe es un color que nadie puede volver a leer.

- [ ] **Step 4: Comprobar**

Run: `npm run typecheck --workspace @orbit-hub/mobile` y `npm run test --workspace @orbit-hub/mobile`
Expected: ambos limpios. Si algún test fija `TagColorStrip`, actualízalo: ahora la constante es `TagColorPicker`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/lists/item-edit-sheet.tsx apps/mobile/test
git commit -m "El selector va bajo el input, y sustituye a la tira de las etiquetas puestas"
```

---

### Task 6: La insignia y la pastilla abren la hoja

**Files:**
- Modify: `apps/mobile/src/components/ui/badge.tsx`
- Modify: `apps/mobile/src/components/lists/tag-chip.tsx`
- Modify: `apps/mobile/src/app/(app)/list/[listId].tsx`
- Test: `apps/mobile/test/task-row-layout.test.ts`

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces: `Badge` acepta `onPress?: () => void`; `TagChip` acepta `onPress?: () => void`. **Ambos opcionales y sin efecto si no se pasan.**

- [ ] **Step 1: Escribir el test que falla**

```ts
it("la insignia y la pastilla se abren con un toque, sin un envoltorio", () => {
  // Un envoltorio se queda con el flex, y el flex que decide si la pastilla se
  // encoge y si la insignia no está en el elemento de dentro.
  expect(badge).toContain("onPress?: () => void");
  expect(listId).toContain("onPress={onEdit}");
});
```

- [ ] **Step 2: Correr y ver que falla**

Expected: FAIL.

- [ ] **Step 3: `Badge` acepta `onPress`**

Añade `onPress?: () => void` a `BadgeProps`. Cuando viene, el `Pressable` —o lo que envuelva hoy— lo lleva; cuando no viene, **el árbol sale idéntico a hoy**, porque `Badge` está en dieciséis sitios más y ninguno se puede enterar.

- [ ] **Step 4: `TagChip` acepta `onPress`**

Igual. Ojo: `TagChip` ya recibe `children`, y en la hoja los `children` son los botones de quitar y de color. **`children` y `onPress` no se estilan igual**: un toque sobre los botones sigue cayendo en el botón, y un toque en el resto de la pastilla abre la tarea. Que el toque no lo se trague el padre se comprueba en el navegador, no aquí.

- [ ] **Step 5: La fila los pasa `onEdit`**

En `[listId].tsx`, el `Badge` de prioridad y cada `TagChip` de la segunda línea reciben `onPress={onEdit}`, el mismo que ya lleva el nombre.

**Invierte el comentario** que dice que la insignia ahí no es pulsable. La razón que daba —que la hoja ya trae la urgencia a la vista— sigue valiendo para *cambiar* la urgencia desde la fila, que no se puede, y no para *abrir* la tarea. La distinción que queda escrita es entre cambiar un valor y mirar un valor.

- [ ] **Step 6: Comprobar**

Run: `npm run test --workspace @orbit-hub/mobile` y `npm run typecheck --workspace @orbit-hub/mobile`
Expected: ambos limpios.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/components/ui/badge.tsx apps/mobile/src/components/lists/tag-chip.tsx "apps/mobile/src/app/(app)/list/[listId].tsx" apps/mobile/test/task-row-layout.test.ts
git commit -m "La insignia y la pastilla abren la tarea, sin envoltorio"
```

---

### Task 7: El navegador lo comprueba, y el roadmap se actualiza

**Files:**
- Modify: `scripts/verify-tag-colors.mjs`
- Modify: `docs/roadmap.md`
- Modify: `docs/superpowers/specs/2026-10-02-color-de-etiquetas-design.md`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Las comprobaciones nuevas, en el script**

**Lo que hay que conservar es todo lo demas**, no un numero: el script crece, y las **dos** comprobaciones
de la puerta de contraste —"usa el color del tema cuando el de la etiqueta no se lee" y
"pinta el color del tema antes que un color que no se puede calcular"— **quedan borradas desde la
Tarea 3**, porque fijan justo lo que este trabajo quita. Cada comprobacion existente que siga
siendo cierta se queda; y si al mirar el resultado una se ha quedado sin sentido, **se dice en
el informe en vez de borrarse por su cuenta**: el script no comprueba sus propios conteos, asi
que una borrada de mas no suena en ninguna parte. En su lugar van estas:

- **`el texto de la pastilla nunca sale en el color del tema`** — leído del DOM, en claro y en oscuro, para al menos un color de cada uno de los doce deducidos y para tres hex libres. Compara el color computado del texto con `theme.colors.text` de cada esquema.
- **`el texto llega a 4.5:1 contra su propio relleno`** — la misma cuenta, por pastilla, con la aritmética de `contrastRatio` metida en el navegador.
- **`un hex libre se guarda y sale`** — elegido en el selector, aparece en la pastilla de **todas** las tareas de la lista que tengan la etiqueta, y sigue ahí tras recargar. Con el enum de doce esto no podía pasar: el servidor lo habría tirado.
- **`el servidor descarta lo que no es un color, y no falla`** — un `tagColors` con basura sale del push como mapa vacío.
- **`la pastilla y la insignia abren la hoja`** — un toque en cada una, y el título de la hoja es el de la tarea.
- **`una etiqueta de 40 caracteres con un hex libre no empuja la fila`** — la comprobación de la etiqueta larga ya existe; se le añade el color libre.
- **`la hoja con el selector abierto sigue desplazándose y el botón de añadir se alcanza`** — el riesgo que el spec admite. Se mide, no se supone: se comprueba que el botón está dentro del área desplazable.

- [ ] **Step 2: Correr el script y mirar**

Run: `node scripts/verify-tag-colors.mjs`
Expected: todas en verde. **Después mira las capturas en claro y en oscuro**, y en concreto la hoja con el selector abierto: si no cabe o el botón no se alcanza, **no lo ajustes por tu cuenta** — es la palanca que el spec dejó para después de mirar, y la decisión es de quien lo mira.

- [ ] **Step 3: `npm run check`**

Expected: API y móvil en verde, typecheck y config de Expo limpios.

- [ ] **Step 4: El roadmap, que ahora dice lo contrario**

`docs/roadmap.md` afirma, con sus números, que nueve de los doce colores se escriben en el color del tema y que el color elegido es uno de doce. **Las dos cosas son falsas ya.** Reescribe su sección de colores para que diga lo que hay: color libre, relleno al 14%, texto derivado hasta 4.5:1, y **que nunca sale en el color del tema**. Y mantén su costumbre de decir **qué no se ha comprobado**, que aquí es: nada en un teléfono, y que dónde cabe el selector se decidió mirando en web a 390×844.

Al `2026-10-02-color-de-etiquetas-design.md` **no lo borres**: es la historia de cómo se hizo. Pero añádele una línea al principio que diga que este documento cambia la puerta de contraste y que el color deja de ser uno de doce.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-tag-colors.mjs docs/roadmap.md docs/superpowers/specs/2026-10-02-color-de-etiquetas-design.md
git commit -m "El navegador lo comprueba, y el roadmap deja de decir lo contrario"
```