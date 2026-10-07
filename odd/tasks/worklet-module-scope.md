# Worklets que referencian constantes de modulo exportadas

## Objetivo

Que el resize de una tarjeta del panel y el swipe entre estados del tablero kanban
dejen de cerrar la app en una build nativa, y que la clase de bug no vuelva a
entrar sin que nada la note.

## Problema

Dos gestos cierran la aplicacion en Android, con el mismo error:

```
Uncaught Error
Property 'PANEL_COLUMNS' doesn't exist
  lib/dashboard/panel.ts:155  snapSize  <-  panel-card.tsx:446
```

```
Uncaught Error
Property 'BOARD_SWIPE_DISTANCE' doesn't exist
  lib/lists/board-paging.ts:135  nextPageFor  <-  board/[listId].tsx:1369
```

La causa es la misma en los dos: un **parametro por defecto que referencia una
constante de modulo `export`ada**, dentro de una funcion con la directiva
`'worklet'`. Un parametro por defecto se evalua antes de entrar al cuerpo, y por
eso el error sale en la linea de la firma y no en la primera sentencia.

El plugin de Babel de Reanimated compila un binding de modulo `export`ado como
acceso al namespace del modulo. En el hilo de interfaz ese namespace viaja
serializado como `{}`, y `PANEL_COLUMNS` deja de existir ahi. En el hilo de
JavaScript todo resuelve bien, y por eso **la web no lo ve**.

### Lo que ya se sabia y no alcanza

`board-paging.ts:139-145` ya escribe que la directiva `'worklet'` es obligatoria
"because on the web the two threads are the same and the missing directive is
invisible, which is exactly why it has to be written down here rather than found
out on a phone". La nota es correcta y esta incompleta: los parametros por
defecto que leen una constante exportada tienen el mismo problema que la
directiva ausente, y no por la misma razon.

### Por que 119 tests no lo encontraron

`test/panel-grid.test.ts:144` llama `snapSize(w, h)` con los defaults y pasa. En
Node el scope de modulo resuelve normal; el fallo solo existe en el hilo de
interfaz de una build nativa. **Esta clase de bug es estructuralmente invisible
al test suite de comportamiento**, y eso es un hecho sobre la suite, no sobre el
bug.

## Alcance

Seis worklets de dos archivos, medidos con un recorrido del AST sobre todo
`apps/mobile/src`:

| Worklet | Archivo | Referencias exportadas |
| --- | --- | --- |
| `snapSize` | `panel.ts:152` | `PANEL_COLUMNS`, `PANEL_ROWS` (firma) + `MIN_CARD_COLUMNS`, `MIN_CARD_ROWS`, `CARD_SIZES` (cuerpo, 159-165) |
| `placeCards` | `panel.ts:387` | `PANEL_COLUMNS`, `PANEL_ROWS` (firma) |
| `oneStepTowards` | `panel.ts:956` | `MAX_CARD_COLUMNS`, `MAX_CARD_ROWS` (cuerpo) |
| `heldSpot` | `panel.ts:1031` | `PANEL_COLUMNS`, `PANEL_ROWS` (firma) |
| `dropSpot` | `panel.ts:1061` | `PANEL_COLUMNS`, `PANEL_ROWS` (firma) |
| `nextPageFor` | `board-paging.ts:130` | `BOARD_SWIPE_DISTANCE`, `BOARD_SWIPE_VELOCITY` (firma) |

Fuera de alcance: el paso de items entre paginas del panel. No es un crash, es
un comportamiento que no funciona y una interaccion nueva (mantener el item en el
borde para avanzar de pagina sin cortar el arrastre). Va en su propio bloque.

## Tareas

- [x] T1 `snapSize`: que no lea nada del scope de modulo. Ocho referencias, y
      tres estan en el cuerpo contra `CARD_SIZES`, que es un array.
- [x] T2 `placeCards`, `heldSpot`, `dropSpot`, `oneStepTowards`: el mismo
      tratamiento en `panel.ts`.
- [x] T3 `nextPageFor`: `BOARD_SWIPE_DISTANCE` y `BOARD_SWIPE_VELOCITY`.
- [x] T4 Guard estatico: `test/worklet-module-scope.test.ts`, escrito antes del
      arreglo y con el RED a la vista: **18 referencias en los 6 worklets de la
      tabla, todas con archivo, linea y si eran de la firma o del cuerpo.** Ademas
      compara, con comportamiento, lo que los defaults responden contra lo que
      responden con los exports, que es el unico riesgo real que deja la
      duplicacion. Limites anotados en el archivo: referencias cruzadas a otro
      modulo, y callbacks que el plugin workletiza sin directiva.
- [ ] T5 Verificacion en emulador: resize y swipe tienen que funcionar en el
      dispositivo. El test unitario no puede dar por bueno este arreglo.

## Criterios de aceptacion

- Ningun worklet de `apps/mobile/src` referencia una constante de modulo
  exportada, y el guard estatico lo dice.
- Las seis funciones mantienen su comportamiento: los tests de `panel-worklets`,
  `panel-grid` y `board-paging` siguen en verde sin cambiar expectations.
- Las firmas publicas no cambian. Los ~20 llamados de test que dependen de los
  defaults siguen funcionando.
- En el emulador, redimensionar una tarjeta pineada y arrastrar entre estados del
  kanban no cierran la app.

## Checks

```
npm run typecheck
npm run test   (apps/mobile)
```

## Ruta y evidencia de disparo

Delegado, un escritor. Disparo por la regla de escritura: toca tres archivos no
triviales (`panel.ts`, `board-paging.ts` y el test nuevo del guard) y ninguno
es mecanico.

## Riesgo asumido

Se duplican valores: los locales del worklet y los `export` del modulo. Es el
costo de no depender de la captura de closures, y es correcto bajo cualquier
mecanismo de Reanimated. La duplicacion no esta suelta: T4 es el guard que
falla si alguien reintroduce una referencia, y el unico riesgo real — que un
local se despegue de su export — es exactamente lo que ese test caza.

## Progreso

T1 a T4 hechas. El guard se escribio primero y fallo con las 18 referencias de la
tabla antes de tocar `panel.ts` ni `board-paging.ts`; despues del arreglo el mismo
guard pasa y la suite entera queda en verde (118 archivos, 1556 tests).

**Lo que quedo escrito y no estaba en el brief:** los defaults de los cinco worklets
de `panel.ts` y de `nextPageFor` son literales, y el catalogo de `CARD_SIZES` es un
local de `snapSize`. Los `export` siguen intactos. **Que el `rows` de la firma de
`snapSize` no se pueda verificar con un test de comportamiento** — la tarjeta mas
alta del catalogo es de cuatro filas, asi que 5 y 6 contestan lo mismo — quedo
anotado como limite en el guard y no como algo que el guard resuelva.

Falta T5: nada de esto se ejecuto en el emulador.