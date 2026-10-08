# Bookmarks sin clasificar: poder verlos y poder moverlos

Pedido del usuario (2026-10-08), despues de cerrar T8 del registro de menus.
Son tres cosas y ninguna es un crash.

## 1. "Sin clasificar" no se puede entrar a verlos

Hoy `app/(app)/unclassified.tsx` es una **lista** de filas: cada una es un
`LinkRow` que navega al detalle. Pero para **clasificar** un enlace hace falta
saber que es, y desde la fila no se ve nada — ni el `siteName` con decision, ni
la descripcion, ni el texto extraido.

Lo que se pide: poder **entrar** en "sin clasificar" como se entra en una
coleccion, y desde ahi clasificar.

**Opciones a mirar antes de proponer nada** (no estan decididas):

- una pantalla propia de "sin clasificar", con su header igual que la de
  coleccion (`app/(app)/collection/[collectionId].tsx`, que T5 acaba de hacer);
- o reusar la pantalla de coleccion con el `collectionId` en `null`, que es
  semanticamente lo mismo.

La segunda es tentadora y probablemente este mal: una cosa es un bucket vacio y
otra una coleccion con nombre, icono y acciones propias.

## 2. El sheet de clasificar solo deja dentro del workspace que ya tiene

Al asignar un enlace, si ya esta en un workspace, `AssignSheet` solo ofrece
destinos de ese workspace. Lo que se pide: **poder moverlo a otro sitio**.

Y relacionado, la parte de fondo:

- **crear un bookmark sin workspace asociado.** Hoy `BookmarkAClasificar` viaja
  con `workspaceId`, y un enlace recien compartido cae en "sin clasificar" de un
  espacio concreto. Se pide poder crear uno **sin asociarlo a ninguno**.
- **mover uno sin clasificar a otro sitio despues.** Es la misma operacion que el
  punto 2, vista desde el bucket.

## Donde queda registrado

Este documento no es una spec: es la lista. Antes de tocar codigo hay que mirar
`AssignSheet`, `BookmarkAClasificar` y `bookmarkSchema` (que tiene `workspaceId` y
`collectionId` como `nullable`? verificar) y despues escribir la spec de verdad.

## Lo que ya se sabe del mapeo (T6 y T7)

- `components/bookmarks/assign-sheet.tsx:203` tiene la regla del titulo de un
  enlace **sin el `host`**, o sea ya divergente de `tituloDeBookmark`. Queda
  pendiente unificarla.
- `assign-sheet.tsx:15-21` recibe `BookmarkAClasificar`, un subconjunto
  estructural de `Bookmark`. Por eso T4 no pudo unificar la funcion del nombre:
  la firma no le sirve sin ensanchar.

## No confundir con

Esto **no** es T10 del registro de menus. T10 es compartir una coleccion o un
enlace, que es cambio de contrato (`shareNodeTypeSchema`). Esto es otra cosa.
