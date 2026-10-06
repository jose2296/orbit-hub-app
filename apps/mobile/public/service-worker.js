// Service worker del share target de la PWA.
//
// Sin imports ni TypeScript: nginx lo sirve tal cual, no pasa por Metro.
// Solo intercepta POST a /share-target exacto; lo demas pasa al servidor.

// Techo para prosa (title/text). 4 KB es prosa de sobra y mantiene la URL
// resultante lejos del limite practico del navegador (decenas de KB).
var TECHO_TEXTO = 4096;

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  // Solo el POST exacto. Un GET aqui es la pagina (la dibuja la Task 3) y
  // un POST a otra ruta no es un share: ambos pasan sin tocarse.
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith(
    (async function () {
      var title = '';
      var text = '';
      var link = '';
      try {
        var form = await event.request.formData();
        title = String(form.get('title') || '').slice(0, TECHO_TEXTO);
        text = String(form.get('text') || '').slice(0, TECHO_TEXTO);
        // Sin techo en url: las URLs largas legitimas existen y truncar
        // el link romperia el guardado.
        link = String(form.get('url') || '');
      } catch (e) {
        // Form ilegible: se redirige igual y la pagina dice "nada que
        // guardar". Un cuerpo roto no es un crash del share.
      }
      // Por que query y no IndexedDB: el SW no tiene localStorage e
      // IndexedDB a mano son ~20 lineas de promesas para tres strings.
      // La redireccion es interna (no toca servidor), asi que no hay 414:
      // el limite lo pone el navegador y con el techo no se acerca.
      var destino = new URL('/share-target', self.location.origin);
      if (title) destino.searchParams.set('title', title);
      if (text) destino.searchParams.set('text', text);
      if (link) destino.searchParams.set('url', link);
      // 303 y no 302: 303 convierte el POST en GET por definicion,
      // 302 lo hace "casi siempre". La pagina resultante es un GET limpio.
      return Response.redirect(destino.toString(), 303);
    })(),
  );
});

self.addEventListener('install', function () {
  // Sin skipWaiting, un SW viejo seguiria interceptando con la logica
  // vieja hasta cerrar todas las pestanas. Con no-store en nginx + esto,
  // el despliegue llega.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
