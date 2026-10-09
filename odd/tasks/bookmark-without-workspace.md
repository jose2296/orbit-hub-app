# Crear un bookmark sin espacio

Fecha: 2026-10-09. Es el punto 3 del pedido de "sin clasificar". Los puntos 1 y 2 ya
estan commiteados en `feat/entity-menu-registry` (`f41b0d9`, `33a5294`).

## El pedido

> "A parte de que el sin clasificar deberia poder ponerlo al crear uno nuevo sin estar
> asociado a un workspace"

Hoy un bookmark **siempre** vive en un espacio. El inbox de "sin clasificar" es una
vista que cruza espacios (`WHERE collection_id IS NULL`, agrupado por workspace), no un
bucket global. Lo que se pide es que exista un bucket **de verdad**, sin espacio.

## Lo que hay hoy, verificado

| Pieza | Estado |
| --- | --- |
| `bookmarkSchema.workspaceId` (`packages/contracts/src/bookmarks.ts:78,91`) | `uuidSchema`, **obligatorio** |
| El create en el sync (`sync-service.ts:990-996`) | `if (workspaceId.length === 0) throw HttpError.validation('A bookmark needs a workspaceId')` |
| El create desde el cliente (`lib/bookmarks/actions.ts:93`) | manda `workspaceId` en el payload |
| El bucket (`hooks/use-bookmarks.ts:104-116`) | el centinela `"unclassified"` filtra por `collectionId != null` — **en cliente, sobre los bookmarks ya bajados** |
| `agruparHuerfanos` (`unclassified.tsx:35-46`) | agrupa por `bookmark.workspaceId` — **asume que existe** |
| El badge del drawer (`useUnclassifiedCount`, sin `workspaceId`) | ya cruza espacios |

O sea: **el bucket ya cruza espacios**. Lo que no existe es un bookmark *sin* espacio.

## Lo que se rompe si `workspaceId` pasa a nullable

No es un campo. Es un invariante del que cuelgan seis cosas:

1. **El create** (`sync-service.ts:990`). Dejaria de rechazar, pero el `folderId` y la
   `collectionId` se resuelven contra el espacio (`:1008-1035`) y sin espacio no hay de
   donde resolverlos.
2. **`assertCanWrite`** (`:578`). Hoy `if (!workspaceId) return;` deja pasar porque
   "workspaces y dashboards son del usuario". Un bookmark sin espacio entraria por ahi
   **sin ningun chequeo**, que es justo lo que no se quiere.
3. **La pertenencia.** ¿De quien es un bookmark sin espacio? Del que lo creo, y de
   nadie mas. Eso es un modelo nuevo: hoy la pertenencia sale del espacio.
4. **La inbox de compartidos.** `shares/inbox` y `incoming` resuelven por espacio. Un
   bookmark sin espacio no aparece en ninguna de las dos.
5. **`agruparHuerfanos`** agrupa por `workspaceId`. Sin el, el grupo es "sin espacio" y
   hay que dibujarlo — que es el punto, pero es codigo nuevo.
6. **Los grants de T10.** `share-service.ts:220` y `:235` acumulan ancestros por
   espacio. Compartir un bookmark sin espacio necesita decidir si se puede.

## Los tres caminos

### A. `workspaceId` nullable de verdad

Lo que pediria la lectura literal. Rienga el contrato, el create, los permisos, la
pertenencia, la inbox y los grants.

**Es la unica opcion que entrega lo que se pidio, y es un corte de spec propio.**

### B. Un espacio "sin clasificar" implicito

Un workspace especial, creado por el sistema, que hace de bucket global. `workspaceId`
deja de ser nullable y **no se toca el modelo**: solo se anade un espacio que la app
sabe que es el bucket.

- **A favor**: no riega permisos ni pertenencia; la inbox y los grants siguen
  funcionando porque todo sigue teniendo espacio.
- **En contra**: es un espacio fantasma. Aparece en `useSpacesTree`, en el picker de
  espacios, en los listados... salvo que se filtre en todos los sitios, y filtrarlo en
  todos los sitios es lo mismo que haberlo hecho nullable pero con pasos extra.

### C. No hacerlo, y documentar por que

El bucket actual cruza espacios y funciona. Lo que no se puede es crear un bookmark
*sin* espacio desde la app.

## Mi recommendation

**A, y como su propia feature.** No por la lectura literal, sino porque B es una mucosa:
un espacio fantasma que hay que esconder en cada pantalla es el invariante roto
repartido en diez sitios, y eso se paga tres veces.

Pero A **no** se hace hasta que el registro de menus este mergeado y verificado, porque
toca el mismo modelo que T10 acaba de ensanchar y mezclarlos haria que ninguno de los
dos se pueda revisar solo.

## Lo que esta fuera de esta spec

- Los puntos 1 y 2 del pedido: hechos (`f41b0d9`, `33a5294`).
- Compartir un bookmark sin espacio: es una decision que sale de A, no un requisito.
