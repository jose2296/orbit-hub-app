import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Service worker bootstrap.
 *
 * The worker itself is Phase 7 work: the static export does not ship one yet,
 * so registering it unconditionally only produced a 404 in development and a
 * silent failure in production. The flag keeps the wiring honest — when the
 * worker lands, the build already looks for it in the right place.
 *
 * This script is injected into the document verbatim, so it cannot read
 * `process.env` at runtime. The flag is resolved here, where the bundler does
 * substitute it, and written into the script as a literal.
 */
const registerServiceWorker = process.env.NODE_ENV === 'production';

const SERVICE_WORKER_BOOTSTRAP = `
if ('serviceWorker' in navigator && ${registerServiceWorker}) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/service-worker.js').catch(function () {
      // Offline support is progressive enhancement: ignore registration errors.
    });
  });
}
`;

const RESET = `
html, body { height: 100%; }
body {
  margin: 0;
  overscroll-behavior-y: none;
  background-color: #0B1020;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: light) {
  body { background-color: #F6F7FB; }
}
* { box-sizing: border-box; }
`;

/**
 * Web only document shell. Expo Router renders this for every statically
 * exported page, so it is where the PWA meta tags and the service worker
 * bootstrap belong.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        {/*
          **El título va aquí, y no se pone solo.**

          Sin este `<title>` el HTML exportado lleva `<title data-rh="true"></title>`
          — vacío, que es lo que sale en `orbithub-app.jrz-labs.com` — y eso no es
          un detalle cosmético: la verificación de OAuth de Google compara el
          nombre de la app en la pantalla de consentimiento con el nombre que la
          página principal dice, y una página sin título no tiene con qué
          comparar. Google rechaza la verificación con *"El nombre de la app no
          coincide con el nombre de la app de tu página principal"*, y el motivo
          real es que el segundo no existe.

          `apple-mobile-web-app-title` de abajo no cuenta: eso es lo que sale bajo
          el icono cuando alguien añade la web a su pantalla de inicio, no lo que
          Google lee para verificar.

          Y tiene que ser el mismo nombre que en la ficha y que en la consola de
          OAuth, o el mismo rechazo vuelve por el otro lado.
        */}
        <title>OrbitHub</title>
        {/*
          La verificación de Google de que el dominio es tuyo.

          Google no deduce que `jrz-labs.com` es tuyo porque lo pongas en un
          formulario: lo comprueba. Y la única forma de comprobarlo sin
          configurarlo a mano es este `meta`, con el token que Google da en su
          pantalla. Por eso está **vacío y commented**: el token es de una sola
          aplicación y de un solo intento, y un token de verificación commiteado
          es un token caducado en cuanto Google lo consume.

          Mientras esté vacío, este `<meta>` no se renderiza — una etiqueta con
          `content` vacío es ruido, no una verificación — así que la web sigue
          funcionando igual. Ponerlo es un commit con la línea de abajo
          descomentada y el valor que Google dé, y se borra en cuanto la
          verificación pase.

          La alternativa es un registro TXT en DNS, que no necesita tocar el
          código y aguanta más: es lo que se usa cuando la web se despliega sin
          poder tocar su HTML.
        */}
        {/* <meta name="google-site-verification" content="TOKEN_DE_GOOGLE" /> */}
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F6F7FB" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B1020" />
        <meta name="description" content="OrbitHub — tus listas, tus notas y tus tareas en un solo sitio." />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="OrbitHub" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER_BOOTSTRAP }} />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: RESET }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
