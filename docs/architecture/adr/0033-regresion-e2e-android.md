# Regresion E2E en Android con Maestro, y el guardian de crasheo alrededor

Estado: decidido. Implementado en `apps/mobile/e2e/`, en su fase 1.

## Contexto

Hay diecisiete scripts `verify-*.mjs`, escritos uno detras de otro para mirar pantallas
concretas, y el mas ancho de ellos recorre **siete** destinos del cajon. La app tiene veintinueve
pantallas y cuarenta hojas encima. Cada uno de esos scripts sabe una cosa que los otros no, y
ninguno sabe las demas; el total que cubren entre todos es un misterio que nadie ha escrito.

La app es **bilingue**: `dictionaries.ts` deriva `TranslationKey` del diccionario espanol, asi que
cada etiqueta visible existe en dos idiomas. Y Android tiene una clase de fallo que no se ve desde
fuente: un proceso nativo que muere relanza la activity sin decir nada. Este repositorio la ha
pagado dos veces, `8b75b37` y `513bbbb`, y en las dos la app parecio sana.

Las tres candidatas eran **Maestro**, **Detox** y **seguir con scripts de `adb`**.

- **Detox** hace pruebas de verdad en TypeScript y comparte codigo con el `vitest` que ya existe. Se
  descarta por su coste de arranque: `detox build` compila un APK nativo, y para un recorrido que se
  corre a demanda son minutos de build antes de cada carrera. Encima hay que mantenerlo compatible
  con React Native 0.86 sobre la Nueva Arquitectura, que es donde se va el tiempo. Nada de eso se
  compra con un recorrido de humo.
- **Seguir con scripts de `adb`** no cuesta instalar nada y los que hay traen una leccion buena:
  `verify-android-screens.mjs` documenta en su propio encabezado por que mirar solo el proceso no
  basta. Se descarta por mantenimiento: un recorrido de veintinueve pantallas con cuarenta hojas
  encima necesita una capa de selectores, otra de aserciones, reintentos, informe y paralelismo, y
  todo eso es software que hay que escribir y mantener sin nadie mas. Ademas ya hay diecisiete
  scripts de un solo uso que alguien tiene que consolidar igualmente.
- **Maestro** usa `testID` como selector nativo -los 54 que ya existen sirven tal cual-, su
  vocabulario de afirmaciones *es* la pregunta de humo, y los flujos son YAML que se revisa igual
  que el resto del cambio.

## Decision

**Maestro, a demanda y en local, y un guardian de crasheo alrededor.**

1. **Maestro recorre y afirma; el guardian vigila.** Un envoltorio corre Maestro **una vez por area**
   -nueve ejecuciones, no cien-, limpia `logcat` y toma el pid de linea de base, y despues decide.
   Los dos son necesarias porque **cada una ve una cosa que la otra no**: Maestro no lee `logcat` ni
   ve un relanzamiento en silencio, y el guardian no sabe si se llego a una pantalla. El veredicto
   se comprueba en orden y para en el primero, para no meter dos fallos en el informe por uno solo.

   Tres senales estan vivas hoy: **no hay proceso**, hay un `FATAL EXCEPTION` en el buffer de crash,
   y hay un `JavascriptException` -que es como muere una app Expo-. La cuarta -el pid que
   **cambio**- esta implementada y probada, y **no se puede ejecutar**: el runner para la app antes
   de cada area, asi que la linea base siempre es `null`. Se deja cableada y documentada en los dos
   sitios donde se decide, en vez de presentarla como una comprobacion que vigila.

2. **Las afirmaciones van sobre `testID`, nunca sobre texto.** Un selector de texto queda atado a
   una redaccion y se rompe en cuanto se retoca una palabra de un idioma. Por eso los flujos
   afirman sobre `testID` y sobre cadenas que ha escrito la siembra, que son deterministas por
   construccion. La consecuencia es que la app gana `testID` en las pantallas por las que pasa: es
   un cambio real en el producto y aparece en el diff de la funcionalidad que se toque.

3. **Por areas, con el orden declarado en un `config.yaml` por area.** Un area es un subdirectorio
   de `flows/`, y cada uno lleva su `flowsOrder`, porque Maestro descubre solo el `config.yaml` del
   directorio que se le pasa. Sin orden, Maestro corre en el que devuelve el sistema de ficheros. Y
   `resolveAreas` **lanza** si el `config.yaml` y los `.yaml` del area no dicen lo mismo, porque un
   flujo sin declarar se corre igualmente, en un hueco sin decidir, y el area seguiria en verde.

4. **A demanda y fuera de CI.** `npm run check` es typecheck + test + config de Expo y se corre en
   cada push; meter un emulador ahi cuesta minutos de CI y hace que un PR se ponga rojo por un
   temporizador. La responsabilidad se pone donde puede sostenerse: en `AGENTS.md`, que obliga a que
   una pantalla, hoja u opcion nueva traiga su flujo y a que el trabajo de UI corra
   `npm run e2e:android` antes de darse por terminado.

5. **El informe cuenta areas, no flujos**, y sale de la carrera con codigo distinto de cero si
   alguna falla. Una carrera con cuarenta flujos y un area rota es un fallo, no un 39/40.

## Consecuencias

- **La app gana `testID` en las pantallas por las que pasa.** Se acepta a cambio de no tener un
  recorrido atado a la redaccion de un idioma. La convencion -kebab-case con prefijo de area,
  `screen-<nombre>` para la raiz- esta escrita en el README del arnes, que es donde se la encuentra
  uno cuando va a anadir un selector.
- **La fase 1 cubre tres pantallas de veintinueve**, no veintinueve. Las otras veintiseis y las
  cuarenta hojas son fase 2, y la obligacion de `AGENTS.md` es lo que las trae de una en una.
- **Los diecisiete `verify-*.mjs` se conservan** hasta que la suite cubra lo que cubren, y se
  borran en la ultima fase. Borrarlos antes dejaria un hueco justo donde mas duele.
- **Un area puede estar en rojo por un defecto de la app, y eso se dice en el informe.** Hoy
  `01-onboarding` lo esta: la tecla de atras de Android sale de la aplicacion en vez de desapilar, y
  los flujos estan escritos como deben. No se ha tapado, porque taparlo habria sido cambiar el
  flujo para que la suite no lo encontrara.
- **Detecta pantallas rotas y rutas cerradas. No detecta logica incorrecta**, y no debe presentarse
  como si lo hiciera. Que al guardar se guarde el texto correcto es otro nivel, mas caro, y queda
  fuera a proposito.
- **El guardian es una promesa a medias y se dice.** Tres senales vivas y una cableada para mas
  adelante. El dia que se ejecute hara falta que Maestro devuelva el pid que levanto la app, o que
  el propio flujo lo deje escrito.
- **No es iOS.** No hay simulador en esta maquina, y `AGENTS.md` lo dice. El dia que lo haya, el
  arnes tendra que ser otro para iOS: los flujos son legibles, pero el guardian y el `adb reverse`
  no.