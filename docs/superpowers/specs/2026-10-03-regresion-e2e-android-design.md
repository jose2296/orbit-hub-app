# Un recorrido por toda la app en Android, y la obligacion de que cada pantalla nueva traiga su prueba

Estado: implementado, y en su fase 1: el arnes, el stack, el guardian y **tres pantallas de
veintinueve** -`welcome`, `privacy` y `terms`-. Las veintiseis restantes y las cuarenta hojas son
fase 2, y las trae de una en una la obligacion de `AGENTS.md`. De las cuatro senales del guardian,
tres vigilan; la cuarta esta cableada y no se puede ejecutar, y eso esta escrito mas abajo y no se
cuenta como cuatro.

Hoy hay diecisiete scripts `verify-*.mjs` que se escribieron uno detras de otro para
mirar pantallas concretas, y `scripts/verify-android-screens.mjs` recorre **siete**
destinos del cajon. La app tiene veintinueve pantallas. Este documento dice que la
regresion se hace con **Maestro**, que recorre **todas** las pantallas con sus
opciones, que vive en `apps/mobile/e2e/`, y que **anade testIDs a las pantallas por
las que pasa** —porque un recorrido que no puede encontrar un boton no encuentra
nada—.

Y dice la segunda mitad, que es la que de verdad importa: que un cambio de UI que
no trae su prueba **no esta terminado**, y eso se escribe en `AGENTS.md`.

## Que se pide, exactamente

Una persona escribe `npm run e2e:android`. El comando levanta lo que falta, siembra
datos, entra en la cuenta y recorre las veintinueve pantallas una por una. En cada
una abre **cada** menu, hoja, selector y cajon que esa pantalla tenga, comprueba que
aparecio, lo cierra, y comprueba que volvio. Al final imprime una tabla, guarda
capturas y sale con codigo distinto de cero si algo fallo.

Un boton que no hace nada **falla**. Una app que se cierra **falla**. Una pantalla
que se queda en blanco **falla**. Un menu que no abre **falla**.

Lo que **no** se pide: comprobar que al guardar una nota se guardo el texto
correcto. Eso es un nivel distinto y mas caro, y este documento lo deja fuera a
proposito —ver "Lo que esta regresion no es", mas abajo.

## Por que Maestro y no Detox ni mas scripts de adb

Las tres opciones se consideraron. Las tres pierden algo.

**Detox** hace pruebas en TypeScript de verdad y deja tocar la app por dentro, que
comparte codigo con el `vitest` que ya existe. Se descarta por su coste de
arranque: `detox build` compila un APK nativo, y para un recorrido que se ejecuta
a demanda eso son minutos de build antes de cada carrera. Encima hay que mantenerlo
compatible con React Native 0.86 sobre la Nueva Arquitectura, que es donde se
gasta el tiempo. Nada de eso se compra con un recorrido de humo.

**Seguir con los scripts de `adb`** no cuesta instalar nada, y los que hay ya
traen una leccion buena: `verify-android-screens.mjs` documenta, en su propio
encabezado, por que mirar solo el proceso no basta —un boton que no hace nada y una
app que se cierra se ven igual desde fuera—. El problema es el coste de mantenerlo.
Un recorrido de veintinueve pantallas con cuarenta hojas encima necesita una capa
de selectores, una de aserciones, reintentos, informe y paralelismo, y todo eso
es software que hay que escribir y mantener sin nadie mas. Ademas ya hay diecisiete
scripts de un solo uso que alguien tiene que consolidar igualmente.

**Maestro** encaja con la pregunta que hace este documento. `testID` es su selector
nativo, asi que los 54 que ya existen sirven tal cual y los que se anaden no
necesitan pegamento. Su vocabulario de aserciones —`assertVisible`,
`assertNotVisible`, `extendedWaitUntil`— *es* la pregunta de humo: se llego, y se
ve. Los flujos son YAML legible, que se puede revisar igual que el resto del cambio.

**Y aqui esta el matiz, que es el punto de este documento.** Maestro no dice *por
que* fallo. No lee `logcat` y no ve un relanzamiento en silencio. Eso no es un
detalle: este repo ya ha pagado dos veces por ese fallo exacto —`8b75b37` dejo al
usuario en la pantalla del callback del login, y `513bbbb` cerro la app al volver
del login de Google—. Un proceso nativo que muere muchas veces relanza la activity
sin decir nada, y desde fuera la app parece Sana.

Por eso el diseno es **Maestro para navegar y afirmar, y un guardian de crasheo
alrededor que mira el proceso y el buffer de crash**. No es que Maestro no sirva: es
que cada uno ve una cosa que el otro no ve.

## El guardian de crasheo

El envoltorio corre Maestro **una vez por directorio de area** —una ejecucion por area, no una
por flujo—, limpiando `logcat` y anotando el pid antes y despues de cada una. Asi el arranque de
Maestro se amortiza y aun asi cada fallo dice *que area* fallo; luego se re-ejecutan los flujos de
esa area uno a uno y sale el flujo exacto.

El guardian da el run por fallado ante cualquiera de estas cuatro cosas:

| Senal | Corre hoy | Por que |
| --- | --- | --- |
| No hay pid | si | La app se cerro |
| El pid **cambio** | **no: cableada y sin ejecutar** | Relanzo en silencio: en nativo casi siempre es un crash |
| `FATAL EXCEPTION` en `-b crash` | si | Crash nativo |
| `JavascriptException` en `-b crash` | si | Excepcion de JS, que es como muere una app Expo |

**Tres de las cuatro vigilan; la cuarta no puede llegar a correr.** El envoltorio para la app antes
de cada area, asi que la linea de base siempre es "no hay proceso" y el pid que cambio no se
compara nunca. Se deja implementada y probada, y escrita como lo que es en `lib/guard.ts`, en el
ADR 0033 y en la pagina de arquitectura, en vez de presentarla como una comprobacion que vigila.
Quitar el `forceStop` de ahi la alcanzaria y traeria un problema peor: el pid del area siguiente
seria el de un estado que nadie ha comprobado. El arreglo de verdad es que Maestro devuelva el pid
que levanto la app, y no cabe en esta fase.

La leccion mas cara del repositorio -en `verify-android-screens.mjs` seis pasos dieron verde con la
app sin moverse de sitio, porque mirar el proceso solo no dice si un toque ha dado en algo- es la
que trae el guardian entero, y de ella sale tambien que los flujos affirmen `testID`: que se llegara
a una pantalla. **No es la comparacion de pid**, que es justo la parte que hoy no se ejecuta, y
atribuirsela seria hacerle un merito a la rama muerta y quitarselo a las tres que vigilan.

## Que hay que sembrar para que el recorrido signifique algo

Una app con la base de datos vacia muestra pantallas vacias, y una pantalla vacia
renderiza. Un recorrido que solo mira pantallas vacias no encuentra la mitad de los
fallos, porque el codigo que dibuja datos es justo el que se rompe.

Asi que hay que sembrar. La API ya corre con **PGlite embebido**, sin base de datos
externa, y con `EMAIL_TRANSPORT=console` el correo de verificacion sale por el log
del servidor. `scripts/seed-people.mjs` ya usa exactamente ese truco. No hay que
inventar nada: es lo que hay.

`apps/mobile/e2e/seed/e2e-account.ts` siembra una cuenta **verificada** con:

- un espacio de trabajo, una carpeta dentro, y una lista con tareas —la cadena
  entera, porque los ids se referencian entre si—
- una nota con contenido
- **una segunda persona**, porque compartir e invitar necesitan a alguien a quien
  compartarle; sin ella, `people`, `shared` e `invitations` se recorren vacios y no
  demuestran nada

Y devuelve sus ids para que los flujos nichen en algo real en vez de en coordenadas: el
volante se los pasa a Maestro por el entorno, que es donde Maestro lee `${...}`, y escribe
ademas un `seed.env` por carrera con las credenciales, para que las de una carrera no
puedan sobrevivir a la siguiente.

## Donde vive

```
apps/mobile/e2e/
  maestro/
    config.yaml                 # appId, tags, executionOrder
    subflows/                   # signed-out, signed-in, open-drawer, seeded-data
    flows/
      01-onboarding/            # welcome, privacy, terms
      02-auth/                  # sign-in, sign-up, forgot, reset, verify-email
      03-dashboard/             # panel grid, add-menu, pin-picker, panel-arrange
      04-lists/                 # lista, detalle, tarea, menus, icon-picker, done-tray
      05-notes/                 # notas, nota, note-menu, save-template, where-note
      06-content/               # catalogo, filtros de media, reordenar, acciones
      07-workspaces/            # espacios, detalle, carpeta, crear, color, compartir
      08-people-shares/         # personas, selector, invitaciones, compartido
      09-system/                # ajustes, dispositivos, sincronizacion, busqueda
  seed/e2e-account.ts
  run-android.ts
```

**Es el arbol entero, no el de hoy.** De el existen `flows/01-onboarding/` con sus tres
flujos, y nada mas: las otras ocho areas son fase 2, y `maestro/config.yaml` y
`maestro/subflows/` no llegaron a hacer falta -cada flujo trae su `appId` y sus `tags`, y
el `config.yaml` que fija el orden es **uno por area**, dentro de ella-. Lo que hay esta en
`apps/mobile/e2e/`.

**Por area, y no por pantalla.** Una hoja nueva que se anada a `[listId].tsx` tiene
que caer en `04-lists/`, que es donde alguien la va a buscar. Organizado por
pantalla, los cuarenta overlays se reparten por las pantallas que los usan y nadie los ve.

Las fases siguen el peso real, que no es alfabetico: `[workspaceId].tsx` usa 21
`Sheet`, `[folderId].tsx` 16, `[itemId].tsx` 11 y `[listId].tsx` 10. Los overlays
se concentran en cuatro pantallas de detalle.

| Fase | Alcance | Objetivos |
| --- | --- | --- |
| 1 | Arnes, stack, guardian, y las 3 pantallas de onboarding (**hecha**) | 3 |
| 2 | Las pantallas simples que faltan | ~26 |
| 3 | Pantallas de detalle y sus hojas (los 102 usos) | ~30 |
| 4 | Overlays, selectores, cajon, compartir | ~40 |
| 5 | Retirar los 17 `verify-*.mjs` de un solo uso | — |

## Los selectores: por que hay que tocar el codigo de la app

Un recorrido necesita poder encontrar las cosas, y la app es **bilingue**—
`dictionaries.ts` deriva `TranslationKey` del diccionario espanol, asi que cada
etiqueta visible existe en dos idiomas—. Un selector de texto queda atado a una
redaccion y se rompe en cuanto se retoca una palabra.

Las cifras de hoy: de las 29 pantallas, **18 no tienen ni un `testID`**, y las 11 que
si los tienen los llevan casi todos en un boton o un filtro, no en la raiz de la
pantalla. Es decir, que hoy no hay forma de preguntar "estoy en la lista".

La buena noticia es que anadirlos sale barato. `components/ui/screen.tsx` ya acepta
`testID` y lo pasa a la raiz, y **26 de las 29 pantallas renderizan `<Screen>`**. Poner
`testID="screen-lists"` es una linea por pantalla. Las tres que no usan `<Screen>`
—`terms`, `privacy` y `[noteId]`— llevan un marcador explicito.

La convencion que ya se sigue en el codigo es kebab-case con prefijo de area
(`notes-create`, `item-create`, `people-search`, `content-filter-*`), y se sigue.

**Los flujos no afirman sobre texto traducido.** Afirman sobre `testID` y sobre
cadenas que el propio seed define —`"Lista de peliculas"`—, que son deterministas
porque las escribio el seed. Por eso cambiar una palabra del diccionario no rompe
la regresion.

## Que afirma cada flujo, y porque no mas

El contrato es estrecho a proposito:

- **Llegar** — `screen-<nombre>` visible. Si no se llego, fallo.
- **Renderizar** — los marcadores propios de la pantalla visibles, para que una
  cascara vacia que no cargo sus datos no pase por "renderizada".
- **Overlays** — abrir cada disparador, afirmar el marcador de la hoja, cerrarla,
  afirmar que se volvio. Aqui es donde se cubre "todas las opciones de cada
  pantalla".
- **Salir** — cada flujo termina volviendo a un marcador conocido, para que uno
  fallo no envenene en silencio el siguiente.

Y lo que no afirma: que guardar una nota guarde el texto correcto. Preferimos que la
suite sea honesta y sea un detector de roturas amplio, a que "humo" signifique en
silencio la mitad del nivel funcional.

## La segunda mitad: que cada cambio futuro traiga su prueba

Una regresion que nadie ejecuta no protege de nada, y una regresion que hay que
recordar ejecutar se olvida. Por eso el mecanismo son tres cosas y las tres hacen
falta:

1. **La convencion de `testID` escrita** donde se la encuentra uno, para que anadir
   un selector no sea una decision de cada uno.
2. **Una obligacion en `AGENTS.md`**: una pantalla, hoja u opcion nueva trae su
   flujo, y el trabajo de UI corre `npm run e2e:android` antes de darse por
   terminado. `AGENTS.md` ya es el acuerdo de trabajo de este repo y ya dice que la
   web se verifica a mano; ahi cabe esta regla al lado.
3. **Los flujos archivados por area**, para que salgan en la revision al lado de la
   funcionalidad que cubren.

No se anade a `npm run check`. `check` es typecheck + test + config de Expo, y se
corre en CI en cada push; meter un emulador ahi cuesta minutos de CI y hace que un
PR se ponga rojo por un temporizador. Este documento lo deja **a demanda y en
local**, y pone la responsabilidad donde puede sostenerse: en el acuerdo de trabajo.

## Lo que esta regresion no es

- **No es iOS.** No hay simulador en esta maquina, y `AGENTS.md` ya lo dice.
- **No es Google OAuth.** `/auth/google` abre un navegador real a una cuenta real de
  Google. No hay forma honesta de automatizarlo aqui, y queda escrito como hueco
  conocido y no como agujero silencioso.
- **No es regresion visual.** No hay comparacion de capturas entre carreras.
- **No es el nivel funcional.** Ya esta dicho dos veces porque es el limite que mas
  invite a estirar.

Los gestos —deslizar, pulsacion larga, reordenar— llevan su propia etiqueta y se
ejecutan y se informan **aparte, sin bloquear la carrera**. Hay diez scripts de
gestos en `scripts/` (`verify-panel-swipe`, `verify-panel-carry`, `verify-longpress`),
lo cual ya dice que fueron fiddly. El `swipe` de Maestro no es determinista, y
un suite que se pone rojo por un temporizador es un suite que la gente deja de
mirar.

## Como se ejecuta

```bash
npm run e2e:android                          # el recorrido entero
npm run e2e:android -- --area 04-lists       # solo un area
npm run e2e:android -- --area=04-lists       # lo mismo: valen las dos formas
npm run e2e:android -- --area 04-lists --flow item-menu.yaml
```

El envoltorio exige **exactamente un** dispositivo conectado —fallo claro con cero o
con varios—, levanta la API y Metro si no estan, siembra, corre, vigila, imprime la
tabla, guarda capturas en `capturas/android/` y sale con codigo distinto de cero si
alguna area sale en `FALLA`. Un area sin flujos lleva `NADA` y no pone la carrera en
rojo: montar un area nueva no es un fallo. El informe es una tabla de texto, como el
`pantallas.txt` que ya genera `verify-android-screens.mjs`, porque una foto sola no dice
donde fallo.

Y una bandera mal escrita **falla**: un `--area` que no existe lista los nombres validos, y
un `--...` que no sea `--area` o `--flow` dice que no lo entiende. Las dos formas -
`--area x` y `--area=x`- valen igual, porque un flag que solo entiende una se calla en
la otra, y un flag callado convierte una carrera entera en una carrera que no ha
corrido lo que se le pidio.

## Consecuencias

- La app gana `testID` en 26 pantallas. Es un cambio real en el producto, y aparece
  en el diff de la funcionalidad que se este tocando. Se acepta a cambio de no
  tener un recorrido atado a la redaccion de un idioma.
- Se conservan los diecisiete `verify-*.mjs` hasta la fase 5, y luego se borran. La
  leccion del pid y del hash de pantalla vive ahora en el guardian, no en diecisiete
  sitios.
- La regresion detecta pantallas rotas y rutas cerradas. **No** detecta logica
  incorrecta, y no debe presentarse como si lo hiciera.
- Se anade un ADR: esto es una decision de arquitectura, no un detalle de tooling.