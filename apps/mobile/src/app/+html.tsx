import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const SERVICE_WORKER_BOOTSTRAP = `
if ('serviceWorker' in navigator) {
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
