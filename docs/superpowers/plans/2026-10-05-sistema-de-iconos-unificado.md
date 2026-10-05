# Sistema de iconos unificado — Plan de implementación

> **Para agentes que ejecutan este plan:** SUB-SKILL OBLIGATORIA: usa
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para implementarlo tarea por tarea. Los pasos usan
> sintaxis de casilla (`- [ ]`) para dar seguimiento.

**Objetivo:** Que el icono sea un objeto único (`IconRef`) en una columna `jsonb`,
igual en espacios, carpetas, listas, elementos de tarea y notas, elegible desde un
selector con pestañas de emojis e iconos que funcione en web, Android e iOS.

**Arquitectura:** Un schema Zod en `packages/contracts` es `z.discriminatedUnion` de
`emoji | vector`. La API lo sanea clave por clave en `sanitisePayload` y lo valida
contra `VECTOR_ICON_CATALOG`; el cliente lo dibuja con un componente `AppIcon` que
resuelve el color contra el tema en el momento de pintar. Los emojis del catálogo se
generan de `emojilib` a un archivo commiteado; el catálogo de vectores vive en el
paquete compartido porque el servidor lo necesita para rechazar claves inventadas.

**Stack técnico:** Expo SDK 57, expo-router, React Native 0.86 + react-native-web,
Express 5, PostgreSQL con Drizzle ORM, Zod 4, vitest (raíz `npm run test`,
`npm run typecheck`, `npm run check`).

**Spec:** `docs/superpowers/specs/2026-10-05-sistema-de-iconos-unificado-design.md`
— el plan razona desde el spec, así que el spec viaja con él; quien ejecute, lee los dos.

## Restricciones globales

- Una sola columna `jsonb icon`. Ni una tabla con `icon_type`/`icon_value`/`icon_style`
  ni columnas planas. Copiado literal del spec.
- El color se guarda **como token de tema, nunca como hex**. Los tokens son los doce de
  `ITEM_ICON_COLORS` más `auto`. Copiado literal del spec.
- Un emoji es `<AppText>` con el carácter. **Cero dependencias nuevas**: no
  `rn-expo-emoji-picker`, no `lucide-react-native`, no nada. Copiado literal del spec.
- Las cinco entidades con icono son `workspaces`, `folders`, `lists`, `list_items`,
  `notes`. **`note_templates` queda fuera**: su `icon varchar(40)` sigue siendo el
  glifo del tipo de plantilla, texto libre, sin cambio. Copiado literal del spec.
- Los 35 glifos de `built-in-templates.ts`, `notes.tsx`, `pin-picker.tsx`,
  `panel-grid.tsx` y `create-sheet.tsx` **no se tocan**. No son iconos de usuario.
- El buscador de emojis normaliza acentos y consulta una tabla de alias
  español→inglés. Sin las dos cosas solo funciona en inglés. Copiado literal del spec.
- Artefactos técnicos (código, comentarios, tests, copy de UI) en **inglés** o en el
  idioma que ya usa el archivo que se edita; los comentarios siguen el idioma del
  archivo circundante, que es el que está.
- Ningún color, espaciado ni radio hardcodeado en componentes: `useTheme()`. Regla 6
  de `AGENTS.md`.
- Cada tarea cierra con `npm run typecheck` en verde.

## Foco de revisión

Estas son las entradas y condiciones que el spec implica, que ninguna prueba de tarea
cubre por su cuenta, y que son las que más probablemente muerden a una persona usando
la app. Cada una tiene su prueba asignada a la tarea que es dueña del código.

1. **Un emoji escrito a mano desde un cliente viejo o manipulado.** Se espera que se
  guarde y se dibuje; un emoji de más de ocho puntos de código o con espacios debe
   rechazarse sin tirar la fila entera. → Tarea 2.
2. **Un `icon` vectorial con `library` o `style` ausente, o con una clave que esta
   build no tiene** (fila de una build futura, o payload editado a mano). Se espera
   `null` — la fila abre igual, sin icono — y no un 500 ni una fila rota. → Tarea 2.
3. **Elegir icono y después color en el mismo panel.** El color elegido no debe
   borrar el icono. Es un bug que ya se pagó una vez (`roadmap.md:412`). → Tarea 6.
4. **Un `icon: null` en un espacio.** Se dibuja `folder-outline`, no el emoji `📁`.
   Decidido en `roadmap.md:902`. → Tarea 6.
5. **Modo oscuro.** Un icono con token de color se dibuja con el valor del esquema
   activo; el mismo token da dos hex distintos en claro y en oscuro. Un hex guardado
   en la base no tiene este problema porque no existe — es la razón del token. → Tarea 4.
6. **Búsqueda en español del selector.** `libro` tiene que encontrar 📖, `cafe` tiene
   que encontrar ☕, `pañal` no puede fallar por el `ñ`. Sin esto el selector es un
   buscador inglés en una app en español. → Tarea 3.

---

## Estructura de archivos

**Creados:**

| Archivo | Responsabilidad |
| --- | --- |
| `packages/contracts/src/icons.ts` | `iconSchema`, `IconRef`, `iconColorSchema`, `VECTOR_ICON_CATALOG`, `sanitiseIconRef` |
| `scripts/generate-emoji-catalog.mjs` | Genera el catálogo de emojis desde `emojilib` a un archivo commiteado |
| `apps/mobile/src/lib/icons/emoji-catalog.generated.ts` | Salida del script: 1914 entradas. Generado, no editado a mano |
| `apps/mobile/src/lib/icons/emoji-aliases.ts` | Tabla español→inglés de palabras del dominio |
| `apps/mobile/src/lib/icons/search-emoji.ts` | `searchEmojis(query, opts)` con normalización de acentos + alias |
| `apps/mobile/src/components/ui/app-icon.tsx` | El renderer único |
| `apps/mobile/src/components/ui/icon-picker-sheet.tsx` | El selector con pestañas |
| `apps/api/test/icons.test.ts` | Pruebas del sanitizador y del allow-list |

**Modificados:**

| Archivo | Cambio |
| --- | --- |
| `packages/contracts/src/workspace.ts` | Reexporta `./icons.js` como hace con `./item-icons.js` (línea 322-330) |
| `packages/contracts/src/index.ts` | No cambia: `workspace.ts` ya está reexportado y arrastra `icons.ts` |
| `apps/api/src/db/content-schema.ts` | Columna `icon` jsonb en las 5 tablas; borra `emoji` × 3 y `icon`/`iconStyle`/`iconColor` de `listItems` |
| `apps/api/src/db/constants.ts` | `SYNC_WRITABLE_FIELDS`: `emoji`→`icon` × 3, `icon`+`iconStyle`+`iconColor`→`icon` |
| `apps/api/src/modules/sync/sync-service.ts` | Rama `icon` en `sanitisePayload`; inserts de folder/workspace con `icon` |
| `apps/api/src/modules/sync/sync-service.ts` | Inserts de `workspace` (609) y `folder` (628) nombran `icon` |
| `apps/api/src/modules/lists/content-query-service.ts` | Lee `icon` en las 4 mappers (127, 178, 231, 232-233) |
| `apps/api/src/modules/workspaces/workspace-query-service.ts` | Lee `icon` en las 4 mappers (54, 78, 115, 148, 208) |
| `apps/api/src/modules/workspaces/invitation-service.ts` | `emoji` → `icon` (370) |
| `apps/api/src/modules/export/export-service.ts` | `emoji`→`icon` y `icon*`→`icon` (66, 89, 131-133, 189, 316, 338) |
| `apps/api/drizzle/0021_*.sql` + `meta/0021_snapshot.json` | Migración: añade `icon`, hace backfill, dropea columnas viejas |
| `apps/mobile/src/theme/tokens.ts` | `ICON_COLORS` con par light/dark; exporta `iconColorHex(key, scheme)` |
| `apps/mobile/src/lib/lists/item-icons.ts` | `ICON_COLORS` y `iconColor()` delegan en el tema (tarea 7) |
| `apps/mobile/src/lib/lists/item-record.ts` | Normaliza `IconRef` en vez de `icon`+`iconStyle`+`iconColor` |
| Los 6 sitios de render de cliente | Usan `<AppIcon>` |

---

### Tarea 1: El contrato `IconRef` y el catálogo de vectores

**Archivos:**
- Crear: `packages/contracts/src/icons.ts`
- Modificar: `packages/contracts/src/workspace.ts:322-330` (añadir el reexport al lado del de `item-icons`)
- Test: `apps/mobile/test/icons.test.ts`

**Interfaces:**
- Consume: nada. Es la primera tarea.
- Produce:
  - `iconColorSchema: z.ZodType<IconColor>` con `"auto"` + los doce de `ITEM_ICON_COLORS`
  - `type IconColor = z.infer<typeof iconColorSchema>`
  - `iconSchema: z.ZodDiscriminatedUnion<["emoji","vector"], ...>`
  - `type IconRef = z.infer<typeof iconSchema>`
  - `iconRefSchema: typeof iconSchema.nullable()` — la columna
  - `VECTOR_ICON_CATALOG: ReadonlyArray<{ key: string; glyph: string; category: VectorIconCategory; label: string }>`
  - `VECTOR_ICON_GLYPHS: Record<string, string>` — `key` → nombre del glifo **relleno**
  - `VECTOR_ICON_CATEGORIES: readonly VectorIconCategory[]`
  - `isVectorIcon(value: unknown): value is string`
  - `sanitiseIconRef(value: unknown): IconRef | null`
  - `vectorGlyph(key: string, style: "outline"|"fill"): string | null` — el nombre del glifo

- [ ] **Paso 1: escribir el test que falla**

`apps/mobile/test/icons.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VECTOR_ICON_CATALOG, VECTOR_ICON_CATEGORIES, ITEM_ICONS, iconSchema, isVectorIcon, sanitiseIconRef, vectorGlyph } from "@orbit-hub/contracts";

describe("IconRef", () => {
  it("acepta un emoji con su color", () => {
    expect(iconSchema.parse({ type: "emoji", value: "🍎", color: "rose" })).toEqual({
      type: "emoji", value: "🍎", color: "rose",
    });
  });

  it("no admite library ni style en un emoji", () => {
    // La razón de ser la unión discriminada: con un objeto plano esto sería
    // válido y ningún consumidor sabría qué hacer con un library en un emoji.
    expect(iconSchema.safeParse({ type: "emoji", value: "🍎", library: "ionicons" }).success).toBe(false);
    expect(iconSchema.safeParse({ type: "emoji", value: "🍎", style: "fill" }).success).toBe(false);
  });

  it("exige library en un vector y pone style por defecto", () => {
    expect(iconSchema.parse({ type: "vector", value: "pan", library: "ionicons" })).toEqual({
      type: "vector", value: "pan", library: "ionicons", style: "outline", color: "auto",
    });
    expect(iconSchema.safeParse({ type: "vector", value: "pan" }).success).toBe(false);
  });

  it("deja fuera un hex como color", () => {
    // Un hex guardado no tiene modo oscuro. Por eso esto tiene que fallar.
    expect(iconSchema.safeParse({ type: "emoji", value: "🍎", color: "#FF6B6B" }).success).toBe(false);
  });

  it("rechaza un valor de icono vacío", () => {
    expect(iconSchema.safeParse({ type: "emoji", value: "" }).success).toBe(false);
    expect(iconSchema.safeParse({ type: "vector", value: "", library: "ionicons" }).success).toBe(false);
  });
});

describe("sanitiseIconRef", () => {
  it("deja un emoji que puede dibujar", () => {
    expect(sanitiseIconRef({ type: "emoji", value: "🏠" })).toEqual({ type: "emoji", value: "🏠", color: "auto" });
  });

  it("devuelve null en vez de tirar cuando no sabe", () => {
    expect(sanitiseIconRef(null)).toBeNull();
    expect(sanitiseIconRef("pan")).toBeNull();
    expect(sanitiseIconRef({ type: "vector", value: "no-existe", library: "ionicons" })).toBeNull();
    expect(sanitiseIconRef({ type: "vector", value: "pan" })).toBeNull();
  });

  it("cae en auto cuando el color no lo conoce", () => {
    expect(sanitiseIconRef({ type: "emoji", value: "🍎", color: "chartreuse" }))
      .toEqual({ type: "emoji", value: "🍎", color: "auto" });
  });

  it("acepta los doce colores y el auto", () => {
    expect(sanitiseIconRef({ type: "vector", value: "pan", library: "ionicons", color: "teal" }))
      .toEqual({ type: "vector", value: "pan", library: "ionicons", style: "outline", color: "teal" });
  });
});

describe("el catálogo de vectores", () => {
  it("tiene cuatro cientos de iconos y cada uno en un grupo", () => {
    expect(VECTOR_ICON_CATALOG.length).toBeGreaterThanOrEqual(400);
    for (const entry of VECTOR_ICON_CATALOG) {
      expect(VECTOR_ICON_CATEGORIES, entry.key).toContain(entry.category);
      expect(entry.label.length, entry.key).toBeGreaterThan(0);
      expect(entry.glyph.length, entry.key).toBeGreaterThan(0);
    }
  });

  it("no repite claves", () => {
    const keys = VECTOR_ICON_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("deja fuera los 35 glifos del sistema", () => {
    // note_templates y el panel usan estos. Si uno entra en el catálogo aparece
    // como opción elegible y son dos cosas distintas en el mismo selector.
    for (const glyph of ["document-text-outline", "albums-outline", "trash-outline"]) {
      expect(isVectorIcon(glyph), glyph).toBe(false);
    }
  });

  it("incluye los 131 que ya existían, para que nadie pierda el suyo", () => {
    for (const icon of ITEM_ICONS) {
      expect(isVectorIcon(icon), icon).toBe(true);
    }
  });
});

describe("vectorGlyph", () => {
  it("devuelve el glifo relleno y el de trazo desde una sola clave", () => {
    // La clave es la palabra que se escribe y el glifo es el dibujo: `pan` se
    // escribe, `cafe` se dibuja. `pan-outline` no existe.
    expect(vectorGlyph("pan", "fill")).toBe("cafe");
    expect(vectorGlyph("pan", "outline")).toBe("cafe-outline");
  });

  it("devuelve null para una clave sin glifo, no un nombre inventado", () => {
    expect(vectorGlyph("no-existe", "fill")).toBeNull();
    expect(vectorGlyph("no-existe", "outline")).toBeNull();
  });

  it("dibuja las dos formas de manera distinta", () => {
    expect(vectorGlyph("pan", "fill")).not.toBe(vectorGlyph("pan", "outline"));
  });
});
```

- [ ] **Paso 2: correr el test y verlo fallar**

```bash
cd packages/contracts && npx vitest run test/icons.test.ts
```
Esperado: FAIL — no se puede resolver `../src/icons.js`.

- [ ] **Paso 3: crear `packages/contracts/src/icons.ts`**

```ts
import { z } from "zod";

import { ITEM_ICONS, ITEM_ICON_COLORS } from "./item-icons.js";

/** Los doce que ya existían, más `auto`: hereda el color de la entidad. */
export const iconColorSchema = z.enum(["auto", ...ITEM_ICON_COLORS]);
export type IconColor = z.infer<typeof iconColorSchema>;

const emojiIconSchema = z.object({
  type: z.literal("emoji"),
  /** 1-8 puntos de código, sin espacios: un emoji y no una frase. */
  value: z.string().min(1).max(12).refine((v) => [...v].length <= 8 && !/\s/.test(v), {
    message: "not an emoji glyph",
  }),
  color: iconColorSchema.default("auto"),
});

const vectorIconSchema = z.object({
  type: z.literal("vector"),
  /** La palabra que se escribe ("pan"), no el nombre del glifo. */
  value: z.string().min(1).max(48),
  library: z.literal("ionicons"),
  style: z.enum(["outline", "fill"]).default("outline"),
  color: iconColorSchema.default("auto"),
});

export const iconSchema = z.discriminatedUnion("type", [emojiIconSchema, vectorIconSchema]);
export type IconRef = z.infer<typeof iconSchema>;
export const iconRefSchema = iconSchema.nullable();
```

Luego el catálogo. `VECTOR_ICON_CATEGORIES` con siete grupos: `trabajo`, `hogar`,
`salud`, `comida`, `viajes`, `naturaleza`, `social`. Las claves son **la palabra en
español sin acentos**, y `label` es esa palabra en Title Case con el diccionario de
excepciones que ya existe en `iconLabel` (`pasta_dientes` → "Pasta de dientes"). Los
**131** de `ITEM_ICONS` entran todos; se agrupan leyendo su `ITEM_ICON_GROUP` actual,
que ya está en español y cuyos diez grupos se reparten en los siete nuevos.

**La clave NO es el nombre del glifo, y esa es la parte que un cast esconde.**
`apps/mobile/src/lib/lists/item-glyphs.ts` tiene `pan: "cafe"`, `leche: "water"`,
`refresco: "ice-cream"`: la clave es la palabra que alguien escribe y el glifo es el
dibujo de Ionicons que la representa. Por eso el catálogo lleva **las dos**, y
`vectorGlyph` devuelve `null` para una clave sin glifo en vez de inventar
`"${key}-outline"` — que produciría `pan-outline`, y eso no existe:

```ts
export function vectorGlyph(key: string, style: "outline" | "fill"): string | null {
  const glyph = VECTOR_ICON_GLYPHS[key];
  if (!glyph) return null;
  // El relleno es el nombre del glifo y el trazo el mismo con `-outline`. Es una
  // convención que el compilador no puede comprobar, y por eso la comprueba el
  // test de la tarea 9 contra el glyphmap de verdad.
  return style === "fill" ? glyph : `${glyph}-outline`;
}
```

Se conservan los 131 pares `key → glyph` que ya existen, con sus glifos de `ITEM_GLYPHS`,
más los que se añadan. Comprobado contra el glyphmap real: los 131 tienen glifo
**relleno y** `-outline`.

`sanitiseIconRef` es la función que el servidor y el cliente usan en los bordes, y devuelve `null` en vez de tirar:

```ts
export function sanitiseIconRef(value: unknown): IconRef | null {
  const parsed = iconSchema.safeParse(value);
  if (!parsed.success) return null;
  // Una clave de una build futura no es un icono: es no tener icono.
  if (parsed.data.type === "vector" && !isVectorIcon(parsed.data.value)) return null;
  return parsed.data;
}
```

- [ ] **Paso 4: el reexport en `packages/contracts/src/workspace.ts`**

Al lado del bloque de `item-icons` (línea 322-330), con el mismo `from "./icons.js"`:

```ts
export {
  iconColorSchema,
  iconRefSchema,
  iconSchema,
  sanitiseIconRef,
  isVectorIcon,
  vectorGlyph,
  VECTOR_ICON_CATALOG,
  VECTOR_ICON_CATEGORIES,
} from "./icons.js";
export type { IconRef, IconColor, VectorIconCategory } from "./icons.js";
```

`index.ts` **no** cambia: ya hace `export * from "./workspace"`, y ese reexport arrastra el módulo, igual que hoy con `item-icons`.

- [ ] **Paso 5: correr el test y verlo pasar**

```bash
cd packages/contracts && npx vitest run test/icons.test.ts
```
Esperado: PASS.

- [ ] **Paso 6: typecheck**

```bash
npm run typecheck
```
Esperado: sin errores.

- [ ] **Paso 7: commit**

```bash
git add packages/contracts/src/icons.ts packages/contracts/src/workspace.ts apps/mobile/test/icons.test.ts
git commit -m "El icono es un objeto: union discriminada de emoji o vector"
```

---

### Tarea 2: La columna `jsonb` y el backfill

Esta es la fase que puede romper producción. Va sola.

**Archivos:**
- Modificar: `apps/api/src/db/content-schema.ts`
- Modificar: `apps/api/src/db/constants.ts:109-150`
- Modificar: `apps/api/src/modules/sync/sync-service.ts` (rama nueva `icon` en `sanitisePayload`; inserts 609 y 628)
- Crear: `apps/api/drizzle/0021_icon_ref.sql`, `apps/api/drizzle/meta/0021_snapshot.json`
- Test: `apps/api/test/icons.test.ts`

**Interfaces:**
- Consume: `iconRefSchema`, `sanitiseIconRef` de `@orbit-hub/contracts` (tarea 1).
- Produce: columna `icon` jsonb nullable en las 5 tablas. Nada más lo necesita todavía.

- [ ] **Paso 1: escribir el test que falla**

`apps/api/test/icons.test.ts`:

```ts
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notes, folders, listItems, lists, workspaces } from "../src/db/content-schema.js";
import { SYNC_WRITABLE_FIELDS } from "../src/db/constants.js";
import { sanitisePayload } from "../src/modules/sync/sync-service.js";

const ENTITIES = ["workspace", "folder", "list", "list_item", "note"] as const;

describe("la columna icon", () => {
  it("es jsonb en las cinco entidades", () => {
    const tables = { workspace: workspaces, folder: folders, list: lists, list_item: listItems, note: notes };
    for (const entity of ENTITIES) {
      const column = getTableColumns(tables[entity]).icon;
      expect(column, entity).toBeDefined();
      expect(column.dataType, entity).toBe("json");
    }
  });

  it("no es writable ningún campo que ya no existe", () => {
    // Una regla que nombra un campo que se dropeó dice lo contrario que la lista
    // blanca, y las dos juntas no dicen nada. La lista manda.
    for (const entity of ENTITIES) {
      expect(SYNC_WRITABLE_FIELDS[entity], entity).toContain("icon");
      expect(SYNC_WRITABLE_FIELDS[entity], entity).not.toContain("emoji");
      expect(SYNC_WRITABLE_FIELDS[entity], entity).not.toContain("iconStyle");
      expect(SYNC_WRITABLE_FIELDS[entity], entity).not.toContain("iconColor");
    }
  });
});

describe("sanitisePayload con icon", () => {
  it("deja un icono de vector que puede dibujar", () => {
    const out = sanitisePayload("list_item", {
      icon: { type: "vector", value: "pan", library: "ionicons", style: "fill", color: "rose" },
    });
    expect(out.icon).toEqual({ type: "vector", value: "pan", library: "ionicons", style: "fill", color: "rose" });
  });

  it("deja un emoji de varios puntos de código", () => {
    expect(sanitisePayload("workspace", { icon: { type: "emoji", value: "👨‍👩‍👧‍👦" } }).icon)
      .toEqual({ type: "emoji", value: "👨‍👩‍👧‍👦", color: "auto" });
  });

  it("vuelve null en vez de tirar cuando el icono no se puede dibujar", () => {
    // Una clave de una build futura, o un payload editado a mano, no pueden ser
    // un 500 ni pueden tirar la fila entera.
    for (const icon of [
      { type: "vector", value: "no-existe", library: "ionicons" },
      { type: "vector", value: "pan" },
      { type: "emoji", value: "x".repeat(40) },
      "pan",
      42,
      [1, 2],
    ]) {
      expect(sanitisePayload("list_item", { icon }).icon, JSON.stringify(icon)).toBeNull();
    }
  });

  it("no confunde un icon con un metadata", () => {
    const out = sanitisePayload("list_item", {
      icon: { type: "emoji", value: "🍎" },
      metadata: { anyKey: "kept" },
    });
    expect(out.icon).toEqual({ type: "emoji", value: "🍎", color: "auto" });
    expect(out.metadata).toEqual({ anyKey: "kept" });
  });
});
```

- [ ] **Paso 2: correr el test y verlo fallar**

```bash
cd apps/api && npx vitest run test/icons.test.ts
```
Esperado: FAIL — `getTableColumns(...).icon` es `undefined` en `workspace`.

- [ ] **Paso 3: las columnas en `content-schema.ts`**

En cada una de las 5 tablas, sustituir las columnas viejas por:

```ts
icon: jsonb('icon').$type<IconRef>(),
```

`workspaces` y `folders`: fuera `emoji`. `listItems`: fuera `icon`, `iconStyle` e
`iconColor`. `notes`: `icon` es columna nueva. El tipo es `IconRef | null`, así que
`.$type<IconRef>()` acepta `null` porque la columna es nullable.

El import: `import type { IconRef } from '@orbit-hub/contracts';` — quitar
`ItemIconColorName` si queda sin uso, y comprobar con typecheck.

- [ ] **Paso 4: `SYNC_WRITABLE_FIELDS` en `constants.ts`**

`workspace`: `['name','description','icon','color','colorTo','wash']`
`folder`: `['parentId','name','icon','position']`
`list`: fuera `'emoji'`, dentro `'icon'`
`list_item`: fuera `'icon','iconStyle','iconColor'`, dentro `'icon'`
`note`: `['title','document','folderId','tags','position','icon']`

- [ ] **Paso 5: la rama `icon` en `sanitisePayload`**

En `sync-service.ts`, reemplazar el bloque de `icon`/`iconStyle`/`iconColor` (líneas
313-334) por uno solo, y quitar `'emoji'` del bloque de `name`/`description` (línea 181):

```ts
if (key === 'icon') {
  // Un objeto, y no una clave suelta: la forma la fija el contrato y una forma
  // que no se puede dibujar es no tener icono, no una fila que no abre.
  clean[key] = sanitiseIconRef(value);
  continue;
}
```

En `STRING_LIMITS` (mismo archivo, ~122-126) quitar la entrada `emoji`.

- [ ] **Paso 6: los inserts de `workspace` y `folder`**

`sync-service.ts:609` y `:628` nombran `emoji:` hoy. Cambiar a:

```ts
icon: (payload['icon'] as IconRef | null) ?? null,
```

`list` (653) y `list_item` (682) ya hacen `...payload`, así que `icon` llega solo una
vez que la lista blanca lo deja pasar. `note` (712) **no** spreade: hay que añadir
`icon: (payload['icon'] as IconRef | null) ?? null` a mano, porque es el mismo
`create` que tiró el icono del elemento de lista una vez.

- [ ] **Paso 7: la migración**

```bash
cd apps/api && npx drizzle-kit generate
```

Drizzle va a generar un `ADD COLUMN "icon"` y un `DROP COLUMN "icon"` para
`list_items` que **se contradicen**, porque el nombre nuevo y el viejo son el mismo y
el backfill tiene que ir en medio. Por eso la columna nueva de `list_items` se llama
`icon_ref` en el SQL y el archivo de drizzle se escribe a mano:

```sql
-- 1. La columna nueva, nullable y sin default: una fila que no la tiene es
--    "nadie eligió icono", que es un estado que el renderer ya sabe dibujar.
ALTER TABLE "workspaces" ADD COLUMN "icon" jsonb;
ALTER TABLE "folders" ADD COLUMN "icon" jsonb;
ALTER TABLE "lists" ADD COLUMN "icon" jsonb;
ALTER TABLE "list_items" ADD COLUMN "icon_ref" jsonb;
ALTER TABLE "notes" ADD COLUMN "icon" jsonb;

-- 2. El backfill. Un emoji era un icono, y por eso no se pierde nada que alguien
--    hubiera escrito a mano.
UPDATE "workspaces" SET "icon" = jsonb_build_object('type','emoji','value',"emoji",'color','auto') WHERE "emoji" IS NOT NULL AND "emoji" <> '';
UPDATE "folders"    SET "icon" = jsonb_build_object('type','emoji','value',"emoji",'color','auto') WHERE "emoji" IS NOT NULL AND "emoji" <> '';
UPDATE "lists"      SET "icon" = jsonb_build_object('type','emoji','value',"emoji",'color','auto') WHERE "emoji" IS NOT NULL AND "emoji" <> '';

-- 3. Las tres columnas sueltas de un elemento a un objeto, en la columna con
--    otro nombre. `icon_style` y `icon_color` tenían default, así que se leen tal
--    cual: una fila escrita antes de que existieran era contorno y neutral.
UPDATE "list_items" SET "icon_ref" = jsonb_build_object(
  'type','vector','library','ionicons','value',"icon",'style',"icon_style",'color',"icon_color"
) WHERE "icon" IS NOT NULL AND "icon" <> '';

-- 4. Las columnas viejas, fuera, y la nueva con el nombre bueno.
ALTER TABLE "workspaces" DROP COLUMN "emoji";
ALTER TABLE "folders" DROP COLUMN "emoji";
ALTER TABLE "lists" DROP COLUMN "emoji";
ALTER TABLE "list_items" DROP COLUMN "icon_style";
ALTER TABLE "list_items" DROP COLUMN "icon_color";
ALTER TABLE "list_items" DROP COLUMN "icon";
ALTER TABLE "list_items" RENAME COLUMN "icon_ref" TO "icon";
```

El snapshot de `meta/` lo genera drizzle: tras editar el SQL a mano, copiar
`meta/0021_snapshot.json` del generado y comprobar que el snapshot **ya** descreibe
la tabla con una columna `icon` jsonb y sin `emoji`. El snapshot es lo que drizzle usa
para el siguiente diff, así que un snapshot que todavía tiene `emoji varchar` hace que
la migración 0022 intente volver a droppear una columna que ya no existe.

**El backfill tiene que poder correrse en seco, y el número tiene que salir antes de
aplicar nada.** En la base de desarrollo, con el paso 1 ya aplicado:

```sql
-- Los iconos de un elemento que NO están en VECTOR_ICON_CATALOG. Tiene que ser 0.
SELECT count(*) FROM "list_items"
WHERE "icon_ref" IS NOT NULL
  AND "icon_ref"->>'value' NOT IN (
    SELECT value FROM vector_icon_catalog  -- o la lista pegada desde el catálogo
  );
```

Si el número **no** es cero, el catálogo de la tarea 1 está incompleto: se amplía y no
se sigue. Un icono que se cae aquí es el icono de alguien que ayer lo tenía elegido, y
se pierde sin aviso porque el push contesta `applied`.

- [ ] **Paso 8: correr el test y verlo pasar**

```bash
cd apps/api && npx vitest run test/icons.test.ts
```
Esperado: PASS.

- [ ] **Paso 9: typecheck + la suite del API**

```bash
npm run typecheck && cd apps/api && npx vitest run test/sync.test.ts test/sync-limits.test.ts test/lists.test.ts test/workspaces.test.ts test/notes-sync.test.ts
```
Esperado: PASS. Estos cinco son los que tocan las entidades que cambian; si alguno
falla por un campo que ya no existe, el campo estaba en más sitios de los cuatro que
dice el spec, y hay que encontrar el sitio antes de seguir.

- [ ] **Paso 10: commit**

```bash
git add apps/api/src/db/content-schema.ts apps/api/src/db/constants.ts apps/api/src/modules/sync/sync-service.ts apps/api/drizzle/ apps/api/test/icons.test.ts
git commit -m "La columna icon es un jsonb, y las viejas se van con su dato dentro"
```

---

### Tarea 3: El índice de emojis y el buscador que funciona en español

**Archivos:**
- Crear: `scripts/generate-emoji-catalog.mjs`
- Crear: `apps/mobile/src/lib/icons/emoji-catalog.generated.ts` (por el script)
- Crear: `apps/mobile/src/lib/icons/emoji-aliases.ts`
- Crear: `apps/mobile/src/lib/icons/search-emoji.ts`
- Test: `apps/mobile/test/emoji-search.test.ts`

**Interfaces:**
- Consume: nada del contrato. El catálogo de emojis es **solo cliente** (decisión del spec).
- Produce:
  - `EMOJI_CATALOG: ReadonlyArray<{ emoji: string; name: string; keywords: readonly string[]; group: string }>` — 1914 entradas
  - `EMOJI_GROUPS: readonly string[]`
  - `type EmojiEntry = (typeof EMOJI_CATALOG)[number]`
  - `EMOJI_ALIASES: Record<string, string>` — español→inglés
  - `normaliseQuery(q: string): string` — sin acentos, minúsculas
  - `searchEmojis(query: string, opts?: { group?: string; limit?: number }): EmojiEntry[]`

- [ ] **Paso 1: escribir el test que falla**

`apps/mobile/test/emoji-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMOJI_CATALOG, EMOJI_GROUPS } from "@/lib/icons/emoji-catalog.generated";
import { normaliseQuery, searchEmojis } from "@/lib/icons/search-emoji";

describe("el catálogo de emojis", () => {
  it("tiene los 1914 que trae la fuente", () => {
    expect(EMOJI_CATALOG.length).toBeGreaterThan(1800);
  });

  it("usa el glifo como clave, no el punto de código", () => {
    // Un catálogo indexado por 1f4d6 no se puede leer ni depurar.
    expect(EMOJI_CATALOG.some((e) => e.emoji === "📖")).toBe(true);
  });

  it("trae palabras clave, o el buscador no es un buscador", () => {
    expect(EMOJI_CATALOG.filter((e) => e.keywords.length > 0).length).toBeGreaterThan(1500);
  });

  it("pone cada emoji en un grupo que existe", () => {
    for (const entry of EMOJI_CATALOG) {
      expect(EMOJI_GROUPS, entry.emoji).toContain(entry.group);
    }
  });
});

describe("buscar un emoji en una app que esta en espanol", () => {
  it("encuentra libro, que es una palabra que se escribe", () => {
    // El fallo que no se ve en una demostracion: las palabras clave vienen en
    // ingles y "libro" no encuentra nada.
    expect(searchEmojis("libro").map((e) => e.emoji)).toContain("📖");
  });

  it("encuentra cafe sin tilde", () => {
    expect(searchEmojis("cafe").length).toBeGreaterThan(0);
  });

  it("encuentra casa y perro, que estan en la tabla de alias", () => {
    expect(searchEmojis("casa").map((e) => e.emoji)).toContain("🏠");
    expect(searchEmojis("perro").map((e) => e.emoji)).toContain("🐶");
  });

  it("encuentra en ingles tambien", () => {
    expect(searchEmojis("house").length).toBeGreaterThan(0);
    expect(searchEmojis("coffee").length).toBeGreaterThan(0);
  });

  it("normaliza la n con tilde y la ene", () => {
    expect(normaliseQuery("PAÑAL")).toBe("panal");
    expect(normaliseQuery("Camión")).toBe("camion");
    expect(normaliseQuery("  Niño  ")).toBe("nino");
  });

  it("muestra todo cuando no hay nada escrito", () => {
    expect(searchEmojis("").length).toBe(EMOJI_CATALOG.length);
    expect(searchEmojis("   ").length).toBe(EMOJI_CATALOG.length);
  });

  it("dice que no hay nada en vez de ofrecerlo todo", () => {
    expect(searchEmojis("qqqqzzzxx")).toEqual([]);
  });

  it("puebla el limite sin cortar por la mitad un grupo de resultados", () => {
    const found = searchEmojis("", { limit: 24 });
    expect(found.length).toBe(24);
  });

  it("solo ofrece lo del grupo que esta abierto", () => {
    const found = searchEmojis("a", { group: "Smileys & Emotion" });
    expect(found.length).toBeGreaterThan(0);
    for (const entry of found) expect(entry.group).toBe("Smileys & Emotion");
  });

  it("no devuelve el mismo emoji dos veces", () => {
    const found = searchEmojis("heart");
    expect(new Set(found.map((e) => e.emoji)).size).toBe(found.length);
  });
});
```

- [ ] **Paso 2: correr el test y verlo fallar**

```bash
cd apps/mobile && npx vitest run test/emoji-search.test.ts
```
Esperado: FAIL — no se puede resolver `@/lib/icons/search-emoji`.

- [ ] **Paso 3: el script generador**

`scripts/generate-emoji-catalog.mjs`. Lee `emojilib` de `node_modules`, y escribe el
archivo generado. Va en `scripts/` al lado de `generate-brand-assets.mjs`, que es el
mismo patrón: un script que produce un artefacto que se commitea.

```js
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const emojilib = require("emojilib/dist/emoji-en-US.json");

// emojilib indexa por el glifo, que es lo que hace legible el catálogo, y trae
// las palabras clave en ingles. unicode-emoji-json no trae ni una, y por eso no
// es la fuente: un buscador sobre nombre exacto no es un buscador.
const entries = Object.entries(emojilib);
const out = entries.map(([emoji, keywords]) => ({
  emoji,
  name: keywords[0]?.replace(/_/g, " ") ?? emoji,
  keywords: keywords.map((k) => k.replace(/_/g, " ").toLowerCase()),
  group: GROUP_OF[emoji] ?? "Other",
}));

// ...escribe el archivo
```

`GROUP_OF` sale de `unicode-emoji-json`, que sí tiene `group` por punto de código
aunque no tenga palabras clave: es exactamente para esto. La fuente de grupos y la de
palabras clave son dos paquetes distintos, y por eso el script declara los dos.

Añadir `emojilib` y `unicode-emoji-json` a las `devDependencies` de la **raíz**: son
herramientas de generación, no runtime, y el cliente recibe el archivo generado. El
paquete móvil **no** gana dependencia.

- [ ] **Paso 4: correr el generador y commitear su salida**

```bash
node scripts/generate-emoji-catalog.mjs
```
Esperado: escribe `apps/mobile/src/lib/icons/emoji-catalog.generated.ts` con ~1914
entradas. **Va commiteado**: es el patrón de `generate-brand-assets.mjs`, y un
catálogo que se genera en cada arranque es un catálogo que falta en algún sitio.

- [ ] **Paso 5: `emoji-aliases.ts`**

```ts
/**
 * Spanish words that are not in the data.
 *
 * `emojilib` brings 15412 keywords in English and there is no Spanish edition:
 * "book" finds a book and "libro" finds nothing. This is the short table that
 * closes the gap for the words of this app, and it is short on purpose -- it is
 * not a dictionary and it is not going to become one. The words that are missing
 * are found when somebody types them and gets nothing.
 */
export const EMOJI_ALIASES: Record<string, string> = {
  libro: "book", libros: "books", leer: "read", lectura: "read", biblioteca: "library",
  casa: "house", hogar: "home", familia: "family", personas: "people", gente: "people",
  corazon: "heart", amor: "heart", salud: "health", hospital: "hospital",
  perro: "dog", gato: "cat", mascota: "pet", pets: "pet", animal: "animal",
  comida: "food", cafe: "coffee", te: "tea", pan: "bread", cerveza: "beer", vino: "wine",
  restaurante: "restaurant", tienda: "shop", mercado: "market", compras: "shopping",
  trabajo: "work", oficina: "office", empresa: "business", reunion: "meeting", cita: "date",
  estudio: "school", escuela: "school", universidad: "university", libro_boli: "memo",
  musica: "music", musica_1: "notes", guitarra: "guitar", piano: "musical_keyboard",
  pelicula: "movie", peliculas: "movies", serie: "tv", series: "tv", television: "tv",
  musica_nota: "musical_note", cancion: "musical_note",
  viajar: "travel", viaje: "airplane", avión: "airplane", avion: "airplane", coche: "car",
  auto: "car", carro: "car", bici: "bike", tren: "train",
  musica_ojo: "art", arte: "art", pintar: "paint", camara: "camera", foto: "camera",
  electronica: "computer", ordenador: "computer", codigo: "code", telefono: "phone",
  escritorio: "computer", libreta: "memo", bombilla: "bulb", bombillas: "light_bulb",
  caja: "package", paquete: "package", herramientas: "tools", llave: "key",
  calendario: "calendar", reloj: "clock", alarma: "alarm_clock", temporizador: "alarm_clock",
  dinero: "money", pago: "money", factura: "money", banco: "bank",
  alerta: "warning", aviso: "warning", error: "warning", peligro: "warning",
  estrella: "star", favorita: "star", hecho: "white_check_mark",
};
```

La tabla tiene trece entradas por lo menos y **ninguna en inglés**: la clave es lo que
la persona escribe en un teclado español, y el valor es lo que el dato trae. Una clave
`health: "health"` es un atajo a la palabra que ya funciona sin atajo, y una clave en
otro idioma es un aviso de que la tabla se está llenando de lo que no le toca.

- [ ] **Paso 6: `search-emoji.ts`**

```ts
import { EMOJI_CATALOG } from "./emoji-catalog.generated";
import { EMOJI_ALIASES } from "./emoji-aliases";

/**
 * Without accents and in lower case.
 *
 * The keywords are written without them and the person types with them, and a
 * search that finds only one of the two spellings is broken for every Spanish
 * keyboard with the accent key.
 */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function searchEmojis(
  query: string,
  opts: { group?: string; limit?: number } = {},
): EmojiEntry[] {
  const { group, limit } = opts;
  const pool = group ? EMOJI_CATALOG.filter((e) => e.group === group) : EMOJI_CATALOG;

  const terms = normaliseQuery(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return limit ? pool.slice(0, limit) : [...pool];

  const matched = pool.filter((entry) => {
    const haystack = normaliseQuery(`${entry.name} ${entry.keywords.join(" ")}`);
    return terms.every((term) => {
      const alias = EMOJI_ALIASES[term];
      return (
        haystack.includes(normaliseQuery(alias ?? term)) ||
        haystack.includes(term)
      );
    });
  });

  return limit ? matched.slice(0, limit) : matched;
}
```

- [ ] **Paso 7: correr el test y verlo pasar**

```bash
cd apps/mobile && npx vitest run test/emoji-search.test.ts
```
Esperado: PASS. Si `libro` falla, el alias no está aplicado: es el fallo del punto 6
del Foco de revisión y hay que arreglarlo antes de seguir.

- [ ] **Paso 8: commit**

```bash
git add package.json package-lock.json scripts/generate-emoji-catalog.mjs apps/mobile/src/lib/icons/
git commit -m "El catalogo de emojis, con un buscador que funciona en espanol"
```

---

### Tarea 4: Los tokens de color en el tema

**Archivos:**
- Modificar: `apps/mobile/src/theme/tokens.ts`
- Test: `apps/mobile/test/icon-colors.test.ts`

**Interfaces:**
- Consume: `ITEM_ICON_COLORS` y `IconColor` de `@orbit-hub/contracts` (tarea 1).
- Produce:
  - `ICON_COLORS: Record<IconColor, { light: string; dark: string }>` — 13 entradas
  - `iconColorHex(key: string | null | undefined, scheme: ColorSchemeName): string`
  - El tema expone `colors.icon: Record<IconColor, string>` ya resuelto al esquema

- [ ] **Paso 1: escribir el test que falla**

`apps/mobile/test/icon-colors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ICON_COLORS, iconColorHex } from "@/theme/tokens";

describe("los colores de los iconos", () => {
  it("tiene los doce de siempre mas auto", () => {
    expect(Object.keys(ICON_COLORS)).toHaveLength(13);
    expect(ICON_COLORS.auto).toBeDefined();
  });

  it("da dos hex distintos en claro y en oscuro", () => {
    // Un hex guardado en la base no tiene modo oscuro: se dibuja igual sobre una
    // superficie oscura. Un token si, y por eso el color se guarda con su nombre.
    for (const key of Object.keys(ICON_COLORS)) {
      const light = iconColorHex(key, "light");
      const dark = iconColorHex(key, "dark");
      expect(light, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(dark, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(light, key).not.toBe(dark);
    }
  });

  it("dibuja el mismo token en dos hex distintos segun el esquema", () => {
    expect(iconColorHex("rose", "light")).not.toBe(iconColorHex("rose", "dark"));
  });

  it("cae en neutral cuando el nombre no lo conoce", () => {
    // Una fila de una build futura, o un texto editado a mano, y aun asi sale.
    expect(iconColorHex("chartreuse", "light")).toBe(iconColorHex("neutral", "light"));
    expect(iconColorHex(null, "light")).toBe(iconColorHex("neutral", "light"));
    expect(iconColorHex(undefined, "dark")).toBe(iconColorHex("neutral", "dark"));
  });

  it("no confunde un color con un nombre de propiedad", () => {
    // ICON_COLORS es un objeto literal: ICON_COLORS["toString"] es una funcion y
    // no un color. La puerta va en quien llama, como en tagColorHex.
    expect(iconColorHex("toString", "light")).toBe(iconColorHex("neutral", "light"));
    expect(iconColorHex("__proto__", "light")).toBe(iconColorHex("neutral", "light"));
  });

  it("es auto el color que hereda la entidad", () => {
    expect(iconColorHex("auto", "light")).toBeDefined();
  });
});
```

- [ ] **Paso 2: correr el test y verlo fallar**

```bash
cd apps/mobile && npx vitest run test/icon-colors.test.ts
```
Esperado: FAIL — no existe `iconColorHex`.

- [ ] **Paso 3: los tokens en `tokens.ts`**

Doce pares light/dark, con el valor del claro siendo el que ya está en `ICON_COLORS`
de `item-icons.ts:136` y el oscuro un 18 % más claro sobre superficie oscura
(`#0E1220` en claro, `#12172A` en oscuro). `auto` son dos neutros del tema:
`textSubtle` y `textMuted`.

```ts
export const ICON_COLORS: Record<IconColor, { light: string; dark: string }> = {
  auto:    { light: NEUTRALS.light.textSubtle, dark: NEUTRALS.dark.textMuted },
  neutral: { light: "#8A93A8", dark: "#9AA3B8" },
  accent:  { light: "#6366F1", dark: "#8B8DF8" },
  green:   { light: "#16A34A", dark: "#34C759" },
  olive:   { light: "#4D7C0F", dark: "#84CC16" },
  amber:   { light: "#D97706", dark: "#FBBF24" },
  orange:  { light: "#EA580C", dark: "#FB923C" },
  red:     { light: "#DC2626", dark: "#F87171" },
  rose:    { light: "#E11D48", dark: "#FB7185" },
  purple:  { light: "#9333EA", dark: "#C084FC" },
  blue:    { light: "#2563EB", dark: "#60A5FA" },
  teal:    { light: "#0D9488", dark: "#2DD4BF" },
  brown:   { light: "#92400E", dark: "#B45309" },
};

export function iconColorHex(
  key: string | null | undefined,
  scheme: ColorSchemeName,
): string {
  const entry = Object.prototype.hasOwnProperty.call(ICON_COLORS, String(key))
    ? ICON_COLORS[String(key) as IconColor]
    : undefined;
  return (entry ?? ICON_COLORS.neutral)[scheme];
}
```

El `hasOwnProperty` es el guard: `ICON_COLORS["toString"]` es una función, y un
objeto literal devuelve algo que no es un color para una clave que no existe. Es el
mismo agujero que el que ya está documentado en `item-icons.ts:125-135` y que
`tagColorHex` ya cierra antes de mirar. Aquí se cierra en el sitio que mira.

Añadir `icon: Record<IconColor, string>` al tipo `ThemeColors` y resolverlo en el
mismo sitio donde se resuelven los otros, con el esquema ya elegido.

- [ ] **Paso 4: correr el test y verlo pasar**

```bash
cd apps/mobile && npx vitest run test/icon-colors.test.ts
```
Esperado: PASS.

- [ ] **Paso 5: commit**

```bash
git add apps/mobile/src/theme/tokens.ts apps/mobile/test/icon-colors.test.ts
git commit -m "Los colores de los iconos son tokens del tema, con claro y oscuro"
```

---

### Tarea 5: `<AppIcon>`, el renderer

**Archivos:**
- Crear: `apps/mobile/src/components/ui/app-icon.tsx`
- Test: `apps/mobile/test/app-icon.test.ts`

**Interfaces:**
- Consume: `IconRef`, `vectorGlyph` (tarea 1); `iconColorHex`, `useTheme` (tarea 4).
- Produce:
  - `AppIcon(props: { icon?: IconRef | null; size?: number; inheritColor?: string; fallback?: keyof typeof Ionicons.glyphMap; testID?: string }): ReactElement | null`
  - `AppIcon` resuelve el color **dentro** y nunca antes. `auto` → `inheritColor`, y si
    no hay, el `textSubtle` del tema.

- [ ] **Paso 1: escribir el test que falla**

`apps/mobile/test/app-icon.test.ts`:

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppIcon } from "@/components/ui/app-icon";

describe("AppIcon", () => {
  it("dibuja un emoji como texto, sin ninguna libreria", () => {
    const html = renderToStaticMarkup(AppIcon({ icon: { type: "emoji", value: "🍎", color: "auto" } }));
    expect(html).toContain("🍎");
  });

  it("dibuja un vector con el glifo que toca segun el estilo", () => {
    const outline = renderToStaticMarkup(AppIcon({ icon: { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "auto" } }));
    const fill = renderToStaticMarkup(AppIcon({ icon: { type: "vector", value: "pan", library: "ionicons", style: "fill", color: "auto" } }));
    expect(outline).not.toBe(fill);
  });

  it("dibuja el respaldo cuando no hay icono", () => {
    // Un espacio sin icono propio se dibuja con folder-outline y no con el
    // emoji de carpeta. Decidido en roadmap.md:902.
    const html = renderToStaticMarkup(AppIcon({ icon: null, fallback: "folder-outline" }));
    expect(html).toBeTruthy();
    expect(renderToStaticMarkup(AppIcon({ icon: null }))).toBe("");
  });

  it("pinta el color del icono cuando tiene uno elegido", () => {
    const html = renderToStaticMarkup(AppIcon({ icon: { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "rose" } }));
    expect(html).toContain("color");
  });

  it("hereda el color que le pasan cuando el suyo es auto", () => {
    const auto = renderToStaticMarkup(AppIcon({ icon: { type: "emoji", value: "🍎", color: "auto" }, inheritColor: "#123456" }));
    const rose = renderToStaticMarkup(AppIcon({ icon: { type: "emoji", value: "🍎", color: "rose" }, inheritColor: "#123456" }));
    expect(auto).toContain("#123456");
    expect(rose).not.toContain("#123456");
  });

  it("devuelve null en vez de un glifo roto cuando no puede dibujar", () => {
    expect(AppIcon({ icon: { type: "vector", value: "no-existe", library: "ionicons", style: "outline", color: "auto" } })).toBeNull();
  });
});
```

- [ ] **Paso 2: correr el test y verlo fallar**

```bash
cd apps/mobile && npx vitest run test/app-icon.test.ts
```
Esperado: FAIL — no existe `app-icon`.

- [ ] **Paso 3: el componente**

Un solo componente, dos caminos:

```tsx
export function AppIcon({ icon, size = 20, inheritColor, fallback, testID }: Props) {
  const theme = useTheme();

  // Un icono que esta build no puede dibujar no es un icono roto: es no tener
  // icono, y la fila de alrededor abre igual.
  if (!icon) {
    return fallback ? <Ionicons name={fallback} size={size} color={theme.colors.textSubtle} testID={testID} /> : null;
  }

  const color =
    icon.color === "auto"
      ? inheritColor ?? theme.colors.textSubtle
      : theme.colors.icon[icon.color];

  if (icon.type === "emoji") {
    // Un emoji es texto. Lo dibuja el sistema operativo en las tres
    // plataformas, y por eso no hay ninguna libreria aqui.
    return <Text style={{ fontSize: size, color }} testID={testID}>{icon.value}</Text>;
  }

  const glyph = vectorGlyph(icon.value, icon.style);
  if (!(glyph in Ionicons.glyphMap)) return fallback ? <Ionicons name={fallback} size={size} color={color} testID={testID} /> : null;

  return <Ionicons name={glyph as Ionicon} size={size} color={color} testID={testID} />;
}
```

`glyph in Ionicons.glyphMap` es la comprobación que hace que el punto 2 del Foco de
revisión no llegue a `<Ionicons>` con un nombre que no existe: ese componente devuelve
un `<Text />` **vacío** y no dice nada, que es el modo de fallo que ya escribió
`icon-font-gate.test.ts`.

- [ ] **Paso 4: correr el test y verlo pasar**

```bash
cd apps/mobile && npx vitest run test/app-icon.test.ts
```
Esperado: PASS.

- [ ] **Paso 5: commit**

```bash
git add apps/mobile/src/components/ui/app-icon.tsx apps/mobile/test/app-icon.test.ts
git commit -m "Un componente dibuja cualquier icono, y decide el color ahi"
```

---

### Tarea 6: `<IconPickerSheet>`, el selector

**Archivos:**
- Crear: `apps/mobile/src/components/ui/icon-picker-sheet.tsx`
- Test: `apps/mobile/test/icon-picker-sheet.test.ts`

**Interfaces:**
- Consume: `IconRef`, `VECTOR_ICON_CATALOG`, `VECTOR_ICON_CATEGORIES` (tarea 1);
  `searchEmojis`, `EMOJI_GROUPS` (tarea 3); `theme.colors.icon` (tarea 4).
- Produce:
  - `IconPickerSheet(props: { visible: boolean; onClose(): void; onSelect(icon: IconRef): void; current?: IconRef | null }): ReactElement`
  - `iconChange(current: IconRef | null | undefined, next: IconRef): IconChange`
  - `type IconChange = { icon?: IconRef; color?: IconColor }`

- [ ] **Paso 1: escribir el test que falla**

`apps/mobile/test/icon-picker-sheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { iconChange } from "@/components/ui/icon-picker-sheet";

describe("lo que el selector devuelve", () => {
  it("el primer cambio manda el icono entero", () => {
    expect(iconChange(null, { type: "emoji", value: "🍎", color: "auto" })).toEqual({
      icon: { type: "emoji", value: "🍎", color: "auto" },
    });
  });

  it("cambiar el color NO borra el icono", () => {
    // El bug que se pago una vez: el selector mandaba el icono entero en cada
    // cambio con el valor que el creia tener, que era el de antes de elegirlo.
    const elegido = { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "auto" } as const;
    const conColor = iconChange(elegido, { ...elegido, color: "rose" });
    expect(conColor.color).toBe("rose");
    expect(conColor.icon).toBeUndefined();
  });

  it("cambiar el icono manda el icono y no toca el color", () => {
    const conColor = { type: "emoji", value: "🍎", color: "rose" } as const;
    const change = iconChange(conColor, { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "rose" });
    expect(change.icon?.value).toBe("pan");
  });

  it("quitar el icono es null y no un objeto vacio", () => {
    const change = iconChange({ type: "emoji", value: "🍎", color: "auto" }, null as never);
    expect(change.icon).toBeNull();
  });
});
```

- [ ] **Paso 2: correr el test y verlo fallar**

```bash
cd apps/mobile && npx vitest run test/icon-picker-sheet.test.ts
```
Esperado: FAIL — no existe `icon-picker-sheet`.

- [ ] **Paso 3: el componente**

Un componente, pestañas `Emoji | Iconos`. La pestaña de emojis usa `searchEmojis` de
la tarea 3 con rebote de 250 ms; la de iconos usa `VECTOR_ICON_CATALOG` con las
mismas reglas que ya tiene `searchIcons`. `FlatList` en las dos: el motor de lista de
`rn-expo-emoji-picker` es FlashList v2, que no tiene web, y este selector tiene que
funcionar en el navegador.

El punto 3 del Foco de revisión vive en `iconChange`, que es una función pura y por
eso se testea sin renderizar nada: **cada control manda solo lo que cambia**, y la
pantalla que lo abre guarda el **id** de la fila y no una copia del icono. Ese segundo
punto es el de `roadmap.md:412`: una copia se queda vieja en la primera escritura y el
panel se la devuelve al servidor.

El marcado del icono elegido es **un borde**, no el color: es el bug de
`roadmap.md:404`, donde el color era lo que se había elegido y al marcarlo se perdía.

- [ ] **Paso 4: correr el test y verlo pasar**

```bash
cd apps/mobile && npx vitest run test/icon-picker-sheet.test.ts
```
Esperado: PASS.

- [ ] **Paso 5: commit**

```bash
git add apps/mobile/src/components/ui/icon-picker-sheet.tsx apps/mobile/test/icon-picker-sheet.test.ts
git commit -m "El selector: emojis del sistema e iconos, y cada control manda lo suyo"
```

---

### Tarea 7: `list_items` de punta a punta

La entidad que ya tiene selector. Si el selector y el renderer sirven para una, sirven
para las cuatro.

**Archivos:**
- Modificar: `apps/mobile/src/lib/lists/item-record.ts:70-72, 123-125`
- Modificar: `apps/mobile/src/lib/lists/item-icons.ts:136-155` (el `ICON_COLORS` pasa a delegar)
- Modificar: `apps/api/src/modules/lists/content-query-service.ts:231-233`
- Modificar: `apps/api/src/modules/export/export-service.ts:131-133, 189`
- Modificar: `apps/mobile/src/app/(app)/list/[listId].tsx:980-993`
- Modificar: `apps/mobile/src/components/lists/item-edit-sheet.tsx:614-619, 787-796`
- Test: `apps/mobile/test/list-record.test.ts` (existe), `apps/mobile/test/item-icons.test.ts` (existe)

**Interfaces:**
- Consume: todo de las tareas 1-6.
- Produce: un elemento de lista con icono en las dos plataformas, con su emoji.

- [ ] **Paso 1: cambiar los tests que existen**

En `apps/mobile/test/item-icons.test.ts`, el bloque `describe("the icons the app can draw")`
comprueba `ITEM_ICONS` y sus glifos. Ese bloque **sigue en pie**: los 123 entran en el
catálogo nuevo (tarea 1 lo prueba). Lo que cambia es `iconColor`, que pasa a delegar en
el tema:

```ts
it("pinta cada color de icono de una manera distinta", () => {
  const painted = ICON_COLOR_KEYS.map((k) => iconColorHex(k, "light"));
  expect(new Set(painted).size).toBe(ICON_COLOR_KEYS.length);
});
```

En `apps/mobile/test/list-record.test.ts`, cambiar las aserciones de `icon` para que
leen un `IconRef`.

- [ ] **Paso 2: correrlos y verlos fallar**

```bash
cd apps/mobile && npx vitest run test/item-icons.test.ts test/list-record.test.ts
```
Esperado: FAIL.

- [ ] **Paso 3: `item-record.ts`**

Las dos normalizaciones (entrada línea 70, salida línea 123) pasan a ser una:

```ts
import { sanitiseIconRef } from "@orbit-hub/contracts";

// A key this build cannot draw is no icon, and not a broken row: a payload
// from a future build, or one somebody edited by hand, still opens the row.
icon: sanitiseIconRef(record.icon),
```

Y `iconStyle`/`iconColor` desaparecen del registro. `iconColorOf` se borra si no tiene
más usos — `grep -n "iconColorOf" apps/mobile/src` y se ve.

- [ ] **Paso 4: el mapper del API**

`content-query-service.ts:231-233`:

```ts
icon: sanitiseIconRef(row.icon),
```

`export-service.ts:131-133` igual, y `:189` (`icon: row.icon`) pasa por el mismo
saneo antes de salir, porque una exportación es lo que alguien se lleva y no puede
salir con una forma que la app no sabe dibujar.

- [ ] **Paso 5: los sitios de render**

`list/[listId].tsx:980-993` — el condicional `item.icon ? ... : ...` y los tres props
se convierten en:

```tsx
<AppIcon icon={item.icon} size={18} fallback="ellipse-outline" />
```

`item-edit-sheet.tsx:614-619` idem con `size={20}`, y `787-796` pasa a abrir el
`IconPickerSheet` con `onSelect={(icon) => onChange({ icon })}`.

- [ ] **Paso 6: correr los tests y el typecheck**

```bash
cd apps/mobile && npx vitest run test/item-icons.test.ts test/list-record.test.ts && cd ../.. && npm run typecheck
```
Esperado: PASS. El typecheck es el que dice si quedaron usos de `iconStyle` o
`iconColor` en alguna pantalla que el grep no encontró.

- [ ] **Paso 7: commit**

```bash
git add apps/mobile/src/lib/lists/ apps/mobile/src/app/\(app\)/list/ apps/mobile/src/components/lists/ apps/api/src/modules/lists/ apps/api/src/modules/export/ apps/mobile/test/
git commit -m "El elemento de lista dibuja y elige su icono como los demas"
```

---

### Tarea 8: Las otras cuatro entidades

**Archivos:**
- Modificar: los 6 sitios de render de `emoji` del cliente
- Modificar: `workspace-query-service.ts` (5 mappers), `invitation-service.ts:370`,
  `export-service.ts:66,89,316,338`, `create-plan.ts:10,30,52`
- Modificar: `sync-service.ts:609,628` (los inserts de workspace y folder)
- Modificar: los 4 sheets de edición: `workspace-menu-sheet`, `folder-menu-sheet`,
  `list-menu-sheet`, `note-menu-sheet`
- Test: extender `apps/mobile/test/create-list-plan.test.ts` y `duplicate-list.test.ts`

**Interfaces:**
- Consume: todo de las tareas 1-7.
- Produce: espacio, carpeta, lista y nota con icono, en las tres plataformas.

- [ ] **Paso 1: los mappers del API, de una vez**

Los nueve sitios que leen `emoji` y los dos inserts que lo escriben pasan a `icon`.
Los de lectura usan `sanitiseIconRef(row.icon)`; el de `invitation-service.ts:370`
también, porque una invitación es lo primero que ve alguien que no ha entrado nunca.

- [ ] **Paso 2: `create-plan.ts` y `duplicate.ts`**

`CreateListInput.emoji?: string` pasa a `icon?: IconRef`. Y `duplicate.ts`, que el
roadmap ya才发现 copiaba cinco campos y se dejaba `tagColors`, copia **todos** los
campos que el contrato declara: la copia que se queda corta es un campo que desaparece
sin error y es exactamente el modo de fallo que `roadmap.md:1961` escribió.

- [ ] **Paso 3: los tests que existen**

`apps/mobile/test/create-list-plan.test.ts` y `duplicate-list.test.ts` cambian sus
aserciones. El segundo tiene que growing: que la copia del icono va con el icono.

- [ ] **Paso 4: los seis sitios de render**

`workspaces.tsx:139-145` (con `fallback="folder-outline"` y su `SpaceWash` intacto),
`lists.tsx:142,173` (hoy el emoji va concatenado al título con un espacio: se saca la
concatenación y el `<AppIcon>` va al lado), `drawer.tsx:880` (ídem), `index.tsx:294,343`
(idem), `invite/[token].tsx:159` (el `?? "•"` se sustituye por `fallback`), y
`panel-card.tsx:540` (que **no** cambia: es el `emoji` de un widget del panel, que es
del sistema).

El `lists.tsx` y el `drawer.tsx` son los dos que cambian de forma, porque hoy
concatenan. Un icono al lado del título se ve en las dos; concatenado al texto se ve
en una sola.

- [ ] **Paso 5: los cuatro sheets**

Cada uno abre el `IconPickerSheet` con su `current` y su `onSelect`. El de workspace
va en `workspace-menu-sheet.tsx`, al lado del selector de color que ya existe.

El `note-menu-sheet.tsx` es el único donde hay que decidir: una nota sí lleva icono
(el spec lo dice), pero `where-note-sheet.tsx` mueve notas entre carpetas y **no**
copia el icono, porque no lo pide y porque mover no es duplicar.

- [ ] **Paso 6: correr todo**

```bash
cd apps/mobile && npx vitest run && cd ../.. && npm run typecheck && npm run check
```
Esperado: PASS en los tres.

- [ ] **Paso 7: commit**

```bash
git add apps/mobile/src apps/api/src
git commit -m "Espacio, carpeta, lista y nota llevan icono, y el selector lo escribe"
```

---

### Tarea 9: Limpieza

**Archivos:**
- Borrar: `packages/contracts/src/item-icons.ts` (`ITEM_ICONS`, `ITEM_ICON_CATEGORIES`, `ITEM_ICON_GROUP`, `ITEM_ICON_COLORS`, `isItemIcon`) — **solo si nadie los usa**; ver abajo
- Borrar: `apps/mobile/src/lib/lists/item-icons.ts` (el `ICON_COLORS` y `iconColor`)
- Borrar: `apps/mobile/src/lib/lists/item-glyphs.ts`
- Borrar: el `isItemIcon` duplicado de `apps/mobile/src/lib/lists/item-presentation.ts:6-9`
- Borrar: `apps/mobile/test/item-icons.test.ts` (los bloques que describen el sistema viejo)
- Modificar: `docs/roadmap.md` (el bloque "Iconos de los elementos" pasa a describir lo que hay)

- [ ] **Paso 1: el inventario de lo que queda usando el sistema viejo**

```bash
grep -rn "ITEM_ICONS\|ITEM_ICON_GROUP\|ITEM_ICON_COLORS\|ITEM_ICON_CATEGORIES\|isItemIcon\|ItemIconColor\|item-glyphs\|item-icons" apps packages --include="*.ts" --include="*.tsx" | grep -v "^packages/contracts/src/item-icons.ts"
```

Cada salida es un consumidor que hay que migrar antes de borrar. `ITEM_ICON_COLORS` lo
usa `iconColorSchema` de la tarea 1, así que **ese se queda**, y con él
`ItemIconColor`. Lo que se va es `ITEM_ICONS`, `ITEM_ICON_CATEGORIES`,
`ITEM_ICON_GROUP` e `isItemIcon`: los 123 viven ya en `VECTOR_ICON_CATALOG`, y un
segundo catálogo del mismo set es un segundo que puede quedarse viejo.

- [ ] **Paso 2: migrar los consumidores que salgan del grep, uno a uno**

Cada uno, con su typecheck. Un consumidor por commit si son muchos.

- [ ] **Paso 3: borrar**

```bash
rm packages/contracts/src/item-icons.ts apps/mobile/src/lib/lists/item-icons.ts apps/mobile/src/lib/lists/item-glyphs.ts
```

Y quitar el `isItemIcon` de `item-presentation.ts`, que es una segunda copia del que
vivía en `item-icons.ts` y que nadie miró.

- [ ] **Paso 4: el test que se queda**

`apps/mobile/test/item-icons.test.ts` no se borra entero: los bloques del buscador y
del nombreMapped se adaptan al catálogo nuevo (`VECTOR_ICON_CATALOG`), porque son
pruebas de comportamiento que sigue existiendo. Lo que se borra es el bloque que
comprueba `ITEM_GLYPHS` y `outlineOf`, que ya no tienen objeto.

Añadir a ese archivo la prueba de que **cada clave del catálogo tiene glifo outline y
fill en el `glyphMap` real de Ionicons**, que es lo que hoy hace el primer bloque:

```ts
it("has both drawings for every icon in the catalog", () => {
  const missing: string[] = [];
  for (const entry of VECTOR_ICON_CATALOG) {
    for (const glyph of [entry.key, `${entry.key}-outline`]) {
      if (!(glyph in GLYPHS)) missing.push(`${entry.key}: no "${glyph}"`);
    }
  }
  expect(missing).toEqual([]);
});
```

Esa prueba es la que impide que el catálogo tenga una clave que el selector ofrezca y
`AppIcon` no pueda dibujar.

- [ ] **Paso 5: el roadmap**

`docs/roadmap.md:402-421` describe el sistema viejo como si fuera el actual. Se
reescribe para que diga lo que hay, y el spec nuevo se referencia al lado. El
roadmap es el documento que se lee cuando algo falla, y si dice que hay 131 iconos en
`ITEM_ICONS` y ya no hay `ITEM_ICONS`, manda el roadmap sobre la realidad.

- [ ] **Paso 6: la suite entera y el gate de la fuente**

```bash
npm run check && npm run test
```
Esperado: PASS.

Y el gate que ya existe y que este trabajo puede romper sin que nadie lo note:

```bash
cd apps/mobile && npx vitest run test/icon-font-gate.test.ts && node ../../scripts/verify-icon-font.mjs
```

`icon-font-gate.test.ts` comprueba que `_layout.tsx` espera a la fuente de Ionicons. Un
catálogo más grande **no** cambia la fuente: sigue siendo un fichero. Si este test
falla, un icono nuevo se dibujó con un set que nadie carga.

- [ ] **Paso 7: commit**

```bash
git add -A
git commit -m "El sistema viejo de iconos, fuera, y su catalogo le deja de hacer falta"
```

---

### Tarea 10: Verificar en el navegador y en el emulador

Ninguna tarea anterior comprueba que un icono **se vea**. Esta es la que lo hace, y la
que el `AGENTS.md` de este repo exige: web primero, y después el emulador
`emulator-5554` (AVD `Medium_Phone_API_35`).

**Archivos:** ninguno. Esta tarea no escribe código salvo que encuentre un fallo, y
entonces vuelve a la tarea que lobergsertó.

- [ ] **Paso 1: web, claro y oscuro**

```bash
npm run start --workspace @orbit-hub/mobile
```

Recorrer, en claro **y** en oscuro: la pantalla de espacios, una carpeta, la lista de
listas, una lista de tareas con sus elementos, y una nota.

En cada una: elegir un emoji, elegir un icono de línea, cambiar el estilo
contorno/relleno, cambiar el color, y comprobar que **volver a abrir el selector y
elegir color otra vez no borra el icono**.

Comprobar que un espacio sin icono se dibuja con `folder-outline` y no con `📁`, y
que un espacio con emoji propio lo conserva.

- [ ] **Paso 2: el buscador, en las dos búsquedas que importan**

En el selector de emojis, escribir `libro`, `cafe`, `pañal`, `casa`, `perro`. Los cinco
tienen que encontrar algo. Si `libro` no encuentra el libro, el punto 6 del Foco de
revisión está vivo y la tarea 3 no está terminada.

- [ ] **Paso 3: el emulador**

```bash
npx expo start --port 8081
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell monkey -p com.jrzlabs.orbithub -c android.intent.category.LAUNCHER 1
adb -s emulator-5554 exec-out screencap -p > /tmp/icons-android.png
```

La app tiene que **lanzarse después** de que Metro responda, o dibuja "Unable to load
script" y se queda ahí. Lo mismo: un emoji en Android se ve distinto que en iOS, y
eso es lo pedido, no un fallo.

- [ ] **Paso 4: cerrar en el navegador**

En web, `npm run web` y comprobar que la fuente de los iconos ha llegado antes de que
se pinte la primera fila. Si hay iconos vacíos, el gate no está esperando y
`icon-font-gate.test.ts` hay que strengtheningarlo, no a mirar las capturas.

- [ ] **Paso 5: cerrar la tarea**

Si todo está bien, no hay commit. Si hubo un fallo y se arregló, el commit es del
arreglo, con el síntoma en el mensaje.

---

## Notas de ejecución

**Orden obligatorio.** La 1 antes que la 2 porque el schema tiene que existir antes de
que una columna lo use. La 2 antes que la 7 porque `list_items` ya tiene `icon` en
tres columnas y la migración lo tiene que resolver antes de que nada lo escriba. La 4
antes que la 5 porque `AppIcon` resuelve el color contra el tema. La 7 antes que la 8
porque los cuatro sitios de render comparten el mismo componente y probarlo en una
entidad real sale más barato que en cinco.

**La tarea 2 es la única que puede romper producción** y por eso va sola, con sus
pruebas, y con el recuento de filas sin mapear **antes** de dropear nada. Si el
recuento no es cero, el catálogo está incompleto: se amplía y no se sigue.

**Los cuatro sitios donde un campo tiene que estar nombrado**, y que son los mismos
para las cinco entidades: `SYNC_WRITABLE_FIELDS`, la rama de `sanitisePayload`, los
campos del `create`, y el `insert` cuando no spreade el payload (`workspace`, `folder`
y `note` no lo hacen; `list` y `list_item` sí). Un campo que está en tres de los cuatro
se acepta, se sanea y **no se escribe**, sin error.

**El API necesita `watch` mientras se tocan los contratos.** El proceso en pie con el
contrato viejo rechaza la clave nueva y un `pull` borra lo elegido; parece un fallo del
selector y no lo es. Es el segundo bug de `roadmap.md:418`.

**El presupuesto.** `npm run check` (typecheck + test + expo config) tiene que pasar en
verde al final de **cada** tarea. `npm run test` corre 119 archivos de pruebas en móvil y
36 en api; los que tocan las entidades que cambian son los de la tarea 2 y los de la 7.