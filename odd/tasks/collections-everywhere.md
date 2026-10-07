# Colecciones de bookmarks en todos los sitios

## Objetivo

Que una colección de bookmarks sea un elemento más de un espacio o carpeta, como una lista, una carpeta o una nota: se crea desde el mismo `+`, aparece en el mismo listado, se abre y se gestiona con su menú. Y que los bookmarks funcionen de punta a punta (extracción sin 404, enlaces visibles en el lector).

## Problema (lo que ve la persona en el móvil)

1. Una colección solo se puede crear al compartir un enlace.
2. Las colecciones no aparecen dentro de un espacio ni de una carpeta (sí en el selector de destino), ni los bookmarks de cada una.
3. Compartir un enlace da un 404 al extraer; al reentrar sí se extrae.
4. En el contenido extraído los enlaces no se distinguen: solo se puede ir al enlace original.
5. No se entiende para qué sirve "Bookmarks" en el drawer.

## Causas halladas

- (3) `createBookmarkFromShare` llama a `triggerExtract` al instante, antes de que la operación `create` se haya sincronizado: el servidor aún no tiene el bookmark → 404, y el `catch` vacío lo esconde (`apps/mobile/src/lib/api/bookmarks.ts`).
- (4) `InlineView` (`components/bookmarks/document-view.tsx`) pinta cada texto con `AppText variant="body"`, que fija color y tipografía y pisa los del padre: el enlace pierde el acento y los títulos pierden su tamaño.
- (1, 2) `ContentRow.kind` ya admite `"collection"` pero no existe `toRow.collection`, ni la lista pinta colecciones, ni `CreateSheet` ofrece crearlas.
- Faltan `deleteCollectionAction` y un menú de colección. Borrar una colección debe dejar sus bookmarks como "sin clasificar", no huérfanos.

## Alcance autorizado

`apps/mobile/src/**` y tests de `apps/mobile/test/**`. Sin cambios de API ni de contratos.

## Tareas

- [ ] **T1** Lector: los hijos de `InlineView` heredan color y tipografía; enlace con acento y subrayado. Test.
- [ ] **T2** `triggerExtract` reintenta ante 404 (el create aún no llegó al servidor). Test.
- [ ] **T3** `deleteCollectionAction` (deja los bookmarks sin clasificar) + `CollectionMenuSheet` (renombrar, borrar). Test de la acción.
- [ ] **T4** Colecciones en `ContentList`: `toRow.collection`, fila con recuento de bookmarks, abre la lista de bookmarks filtrada, menú. Workspace y carpeta. Test de ordenación/filtro.
- [ ] **T5** Crear colección desde el `+` (`CreateSheet`, kind `collection`) en espacio y carpeta, y desde "crear dentro" del menú de carpeta.
- [ ] **T6** Pantalla de bookmarks: título de la colección y estado vacío con su contexto.
- [ ] **T7** Verificación en el emulador (claro/oscuro) y `npm run check`.

## Respuesta (sin código) sobre "Bookmarks" del drawer

Es la vista global de todos los enlaces guardados, y su contador es la bandeja de "sin clasificar". Con las colecciones dentro de espacios y carpetas, sirve para (a) encontrar un enlace sin saber dónde lo guardaste y (b) vaciar la bandeja de los que no clasificaste. No sustituye a las colecciones.

## Criterios de aceptación

- Crear una colección vacía en un espacio y en una carpeta desde `+`.
- La colección aparece en su espacio/carpeta con el nº de bookmarks; al abrirla se ven sus bookmarks.
- Compartir un enlace no deja 404; la extracción termina sola.
- En un artículo extraído los enlaces se ven con acento y subrayado y se pueden abrir.
- `npm run check` en verde; claro y oscuro revisados en el emulador.

## Rutas por tarea y evidencia

Todas inline: ninguna toca 2+ archivos no triviales a la vez sin ser acotada; la exploración ya está hecha. (AGENTS.md exige el modelo `Space Bunny Free` para subagentes y no es seleccionable aquí, así que no se delega.)

## Progreso

Rama `jose2296/collections-everywhere`. Nada hecho todavía.

## Siguiente paso

T1.
