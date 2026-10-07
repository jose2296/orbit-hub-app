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
guard pasa y la suite entera queda en verde (118 archivos, 1557 tests).

**Lo que quedo escrito y no estaba en el brief:** los defaults de los cinco worklets
de `panel.ts` y de `nextPageFor` son literales, y el catalogo de `CARD_SIZES` es un
local de `snapSize`. Los `export` siguen intactos. **Que el `rows` de la firma de
`snapSize` no se pueda verificar con un test de comportamiento** — la tarjeta mas
alta del catalogo es de cuatro filas, asi que 5 y 6 contestan lo mismo — quedo
anotado como limite en el guard y no como algo que el guard resuelva.

Falta T5: nada de esto se ejecuto en el emulador.

## Revision del commit d92fd55

La revision aprobo el arreglo y quemo la autoridad, pero salio con dos warnings que
son agujeros reales del archivo de test. Van juntos porque uno causa al otro.

- [x] **R3-002** El fixture de `heldSpot`/`dropSpot` era vacio. Celda de 60 y 60,
      centro en (40, 40) y tarjeta de 2 x 2: el indice crudo cae en **0** en los dos
      ejes y la respuesta es `{ x: 0, y: 0 }` para todo grid de `2 x 2` a `12 x 20`
      — **una sola respuesta para seis grids distintos, medida**. El clamp de
      `clampCell` recorta a `[0, columns - limit.w]` y a `[0, rows - limit.h]`, y un
      indice dentro del rango no llega al clamp: el default no deja ningun rastro.
      Ahora el fixture es celda de 60 x 40 con gap de 8 y centro en **(400, 500)**:
      crudo 5 en X contra un tope de 2, crudo 9 en Y contra un tope de 4. Los dos
      clamps se enganchan, y hay una asercion por eje que demuestra que mover
      cualquiera de los dos numeros mueve la respuesta.
- [x] **R3-001** `rows = 6` sin anclaje comportamental. **Se cierra por consecuencia
      de R3-002**, no con un test aparte: en `heldSpot` y `dropSpot` el tope es
      `rows - limit.h`, que si cambia con `rows` para cualquier valor, asi que apenas
      el fixture engancha el clamp el `rows` queda anclado en los dos call sites que
      antes no lo tenian. Medido: con el dedo en (400, 500) el `rows` responde 3, 4
      y 5 para `rows` de 5, 6 y 7. **Lo que sigue sin ancla es `rows` en
      `snapSize`**, y no tiene arreglo con un test de comportamiento; queda anotado
      como limite en el guard.

### Abiertos, y no son parte de este encargo

- [ ] **R3-004** El escaneo de la firma incluye el nombre del propio parametro, asi
      que un `function f(f: number = f)` se contaria como referencia. No se ha
      observado; es SUGGESTION.
- [ ] **R3-005** El escaneo corre a nivel de modulo y por lo tanto tambien revisa
      los callbacks que el plugin workletiza sin directiva (`useDerivedValue`,
      `useAnimatedStyle`, `on*` de un gesture builder). No se ha observado; es
      SUGGESTION.

### Lo que la revision no vio, y quedo medido

`dropSpot` con una tarjeta tapando justo la celda del dedo **no puede discriminar
`rows`**: con la celda `(2, 4)` tapada, `rows = 5` y `rows = 6` responden las dos
`(2, 2)`. Con seis filas el dedo cae en `(2, 4)` y la libre mas cercana esta a
distancia 4; con cinco filas el dedo ya cae en `(2, 3)`, que el rectangulo tapado
cubre igual, y la libre mas cercana es la misma a distancia 1. **Dos indices crudos
distintos y la misma respuesta**, y no es un fallo del fixture: es la geometria de
`nearestFreeSpot`, que busca por distancia y no por valor.

Por eso el ancla del `rows` para `dropSpot` vive en un fixture donde nada esta
tapado — ahi los dos clamps mandan — y el barrido de `columns` esta en los dos
fixtures, con los numeros distintos que salen de cada uno. Esta escrito en el test,
con los numeros, y no escondido.