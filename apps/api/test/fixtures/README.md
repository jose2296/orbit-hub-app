# Fixtures de la extraccion

Cinco HTML **guardados en el arbol**, no bajados por los tests. Un test que baja
una pagina es un test que se rompe cuando el sitio cambia de diseno, cuando sale
de linea, y un test que no se puede correr en un pipeline de CI sin red. Estos
archivos son la unica forma de que la reduccion se pueda probar de verdad.

Los cuatro grandes se capturaron **una vez, a mano, de paginas reales**, con la
pagina entera tal cual la sirvio el servidor: `<html>`, `<head>`, scripts,
estilos y todo. Que sean la pagina cruda y no la salida de Readability es lo
correcto porque **la pagina cruda es lo que recibe el endpoint**: Readability es
una de las etapas que se prueban, no una precondicion del fixture. La comparacion
de supervivencia de palabras se hace contra el texto de Readability, que el test
recalcula con la misma version fijada (`@mozilla/readability` 0.6.0, `jsdom`
30.1.2), asi que el numero es el del spike y no una foto.

> **Como seCapturaron.** No hay comando: se abrieron en el navegador y se guardo
> "ver codigo fuente de la pagina" desde el servidor, con el User-Agent del
> navegador. **No es reproducible con un `curl`**, y esa es una limitacion
> aceptada: las tres paginas son publicas, estan fijadas en el arbol para siempre,
> y volver a capturarlas es trabajo de fase 3 (el script que captura la cola
> larga), no de esta tarea. Si alguien necesita reproducirlas hoy, tiene que
> pegarle a la pagina desde un navegador.

| fixture | de donde | bytes | que cubre |
| --- | --- | --- | --- |
| `article-long.html` | `https://en.wikipedia.org/wiki/Quicksort` | 524.978 | articulo largo: `div`, `span`, `figure`, `sup`, `table`, `pre`, `dd`, `cite`, `bdi`, 73 imagenes |
| `article-wiki-topic.html` | `https://en.wikipedia.org/wiki/Readability` | 353.142 | el **segundo** articulo de Wikipedia, y el unico que sirve para contar `<sup>` |
| `article-guardian.html` | `https://www.theguardian.com/world/2026/oct/05/flydubai-co-pilot-originally-planned-attack-for-july-investigators-believe` | 490.620 | los tags que el spec **no** preveia: `gu-island`, `svg`, `path`, `source`, `picture`, `figcaption` |
| `video-youtube.html` | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | 1.404.161 | una watch: 53 scripts y 1,4 MB. Es el caso del piso de palabras |
| `too-short.html` | escrito para esto | 584 | cinco palabras, en espanol y con tildes |

Capturados el **2026-10-06**. Las tres paginas son las mismas del spike, y por eso
los numeros se comparan con los de
`.superpowers/sdd/2026-10-05-bookmarks-share-target-design/spike-report.md`.

## Por que dos articulos de Wikipedia

El de `Quicksort` trae el navbox y las formulas, y el de "Readability" es el que
tiene los `<sup>` de referencia en cantidad —el spike los conto: 121— que es el
caso que separa "desarrollar" de "descartar".

## Lo que estos fixtures no cubren

1. **Son tres paginas** (mas una escrita a mano). La cola larga de la web —SPAs,
   articulos en otros idiomas, RTL, muros de pago de verdad— no esta. El spike ya
   lo dijo y sigue valiendo.
2. **`article-guardian.html`, `article-long.html` y
   `article-wiki-topic.html` no los revisa nadie.** Se pudren: si el sitio
   cambia, el archivo no cambia. Es lo que se quiere, y tambien es lo que hace
   que no sirvan para enterarse de que un sitio rompio el extractor. Para eso
   hacen falta mas paginas y un script que las capture, que es fase 3.
3. **`too-short.html` es el unico escrito a mano**, y por construccion Readability
   lo acepta: trae `nav`, `article`, `h1` y un `footer` de relleno para que la
   pagina tenga la forma de una pagina y no la de un fragmento.
4. **Ningun test alimenta la reduccion con una salida literal de Readability.**
   La reduccion recibe `articulo.content`, markup ya limpio, y la referencia de
   supervivencia tambien se calcula sobre salida de Readability: el porcentaje
   si mide cuanta prosa sobrevive de lo que Readability entrego, que es justo
   lo que hay que probar. Lo que falta es el caso intermedio, un fixture con la
   forma exacta que produce Readability: hoy la entrada de la reduccion siempre
   viene de correr Readability dentro del propio test, asi que si su salida
   cambia de version, los tests la absorben en silencio en vez de romperse.