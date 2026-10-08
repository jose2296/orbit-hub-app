# ADR 0033 — Diario: una nota por día, de la cuenta y no de un espacio

**Estado:** Propuesta

## Contexto

La persona quiere un diario: una nota por día, a la que se llega por defecto desde hoy, que se
puede recorrer deslizando hacia los días anteriores y los siguientes, y que se puede abrir en un
día concreto desde un calendario. Escribe en él lo que quiera, también planes para días futuros, y
puede enlazar elementos de la app (listas, tableros, notas, carpetas, espacios, marcadores) con
[ADR 0034](0034-mencion-en-notas.md).

El diario **no pertenece a ningún espacio**. Las notas viven en `notes` con `workspace_id`
obligatorio, y una nota de diario en un espacio desaparecería al salir de él. Ya existe un
precedente para algo que es de la persona y no de un espacio: las plantillas `scope: personal`
(`note_templates.workspace_id` nulo) y `dashboard_layouts`, una fila por usuario sincronizada.

## Decisión

Una entidad nueva, `journal_entry`, propiedad de un usuario.

- **Tabla** `journal_entries`: `id` uuid, `user_id` (cascada al borrar la cuenta), `day` tipo
  `date` en formato `YYYY-MM-DD` y **fecha local de la persona**, `document` y `plain_text` con el
  mismo formato que las notas (ADR 0009), `version`, `created_at`, `updated_at`, `deleted_at`.
  Índice único `(user_id, day)`: un día, una entrada.
- **Identificador determinista.** El `id` es un UUID v5 calculado a partir de `userId` y `day`.
  Así, dos dispositivos que crean el mismo día sin conexión producen el mismo `id`, y el segundo
  `create` llega como `duplicate` en vez de como una segunda fila. El servidor **recalcula** el
  `id` y rechaza un `create` cuyo `id` no coincide: el cliente no puede escribir un día ajeno ni
  crear dos entradas para el mismo día. El cálculo vive en `packages/contracts` porque cliente y
  servidor deben obtener exactamente el mismo valor; como Hermes no tiene `crypto.subtle` en
  síncrono, se usa un SHA-1 puro en TypeScript, verificado contra vectores de prueba.
- **Autorización** solo por dueño. No hay compartir, ni roles, ni `workspace_id`. La comprobación
  vive en la API (AGENTS.md, regla 8).
- **Sincronización** como entidad nueva `journal_entry` en `syncEntitySchema`. El `apply` la trata
  como `dashboard` (por usuario, sin `assertCanWrite` de espacio) pero con `create`, `update` y
  `delete` reales y control de versiones, porque una entrada se edita en dos dispositivos y ese
  conflicto debe verse, no perderse.
- **Creación perezosa.** Abrir o deslizar a un día sin entrada **no escribe nada**. La entrada se
  crea con el primer carácter. Recorrer 30 días no genera 30 filas vacías.
- **Fecha de hoy** la decide el dispositivo. Un viaje de husos horarios puede mover "hoy"; es el
  comportamiento esperado de un diario de papel.
- **Sin adjuntos en la primera versión.** Una imagen necesitaría un `attachments.note_id`; el
  diario no tiene nota padre de espacio. La barra de formato del diario no ofrece imágenes.
- **Sin recordatorios.** No existe el módulo y queda fuera de este ADR.

## Navegación

- Ruta `apps/mobile/src/app/(app)/journal/index.tsx`. Al entrar muestra **hoy**.
- Deslizar horizontal cambia de día. Se renderizan tres páginas (día anterior, actual, siguiente)
  en un `FlatList` paginado; al terminar el gesto se recentra. Funciona igual en web.
- El gesto de deslizar vive en la **cabecera de fecha**, no en el cuerpo del editor. Un swipe
  sobre el texto compite con la selección nativa y con el teclado, y eso se ha visto ya en el
  editor de notas.
- Un botón de fecha abre un sheet con un calendario mensual. Los días con entrada llevan un punto.
  Se permiten días futuros.
- Entrada en el drawer, junto a Notas y Marcadores, porque el diario tampoco pertenece a un espacio.

## Consecuencias

- Un módulo nuevo en la API (`apps/api/src/modules/journal`), una tabla, una migración y una rama
  en `sync-service`. El resto del sync no cambia.
- La exportación y el borrado de cuenta deben incluir la tabla nueva. Se añade a la lista de
  pendientes de `docs/architecture/data-model.md`.
- Un usuario con sincronización atrasada puede ver un conflicto en su diario. Es el comportamiento
  correcto y se acepta.
- El diario no se puede compartir. Si se pide más adelante, es una decisión nueva.

## Plan de ejecución

Cada fase es un commit, con sus pruebas, y se verifica antes de pasar a la siguiente.

1. **Plan** (este ADR y 0034).
2. **Contratos**: `journal.ts` con esquema, día y rango de fechas, UUID v5 con SHA-1 puro, y la
   mención en el validador de `note-document.ts` (ADR 0034). Pruebas de vectores y del validador.
3. **API**: tabla y migración, rama `journal_entry` en `sync-service` (creación, actualización,
   conflicto, borrado y pull), exportación y borrado de cuenta. Pruebas del `apply`, de la
   propiedad y del `id` determinista.
4. **Datos en el cliente**: entidad local, pull, y hooks `useJournalEntry(day)` y
   `useJournalDays(mes)` para el calendario.
5. **Pantalla**: pager de tres páginas, cabecera de fecha, calendario, entrada en el drawer, textos
   en los diccionarios de i18n.
6. **Enlaces**: botón `@` en la barra del editor, selector sobre el buscador global y chip con
   nombre en vivo (ADR 0034).
7. **Verificación**: `npm run check`; web en claro y oscuro; emulador Android para el gesto del
   pager y el selector.
