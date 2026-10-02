/**
 * Declara en el manifest el deep link con el que vuelve Google.
 *
 * ## Por qué hace falta
 *
 * `app.json` dice `"scheme": "orbithub"`, y Expo genera con eso un intent-filter
 * que es solo esto:
 *
 * ```xml
 * <data android:scheme="orbithub" />
 * ```
 *
 * **Un `<data>` con scheme y sin host no captura una URL que trae host.** El
 * deep link de Google en nativo es `orbithub://auth/google`: `orbithub` es el
 * scheme, `auth` es el host y `google` el path. Con el filtro tal cual está,
 * Android no encuentra ninguna actividad que lo atienda, el navegador custom
 * abre, y Google responde
 * `Error 400: invalid_request — redirect_uri=orbithub://auth/google`.
 *
 * El síntoma es desconcertante porque todo lo demás está bien: el scheme
 * coincide con el que se registró en el client de Google, el código canjea
 * bien, y el error blames a Google por un filtro que escribe Expo.
 *
 * **El host no es un detalle, es la mitad del otro lado de la URL.** Sin él el
 * filtro describe URLs como `orbithub:cualquiera`, que no son las que Google
 * devuelve.
 *
 * ## Por qué no basta con arreglarlo aquí a mano
 *
 * `apps/mobile/android` no se versiona: lo regenera `expo prebuild` en cada
 * build. Editar el manifest a mano se pierde en el siguiente prebuild, y el
 * fallo vuelve sin que nadie haya tocado nada.
 */

const { withAndroidManifest } = require('expo/config-plugins');

/** El host del deep link de Google. Sin host, sin captura. */
const GOOGLE_HOST = 'auth';
const GOOGLE_PATH = '/google';

module.exports = function withGoogleDeepLink(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    const activity = manifest.manifest.application[0].activity?.[0];
    if (!activity) {
      throw new Error(
        'with-google-deep-link: no se encontró la actividad principal en ' +
          'apps/mobile/android/app/src/main/AndroidManifest.xml. Probablemente ' +
          'cambió la plantilla de Expo; revisa este plugin.',
      );
    }

    const filters = activity['intent-filter'] ?? [];

    // El que ya trae Expo por el scheme, sin host: es el que no funciona.
    const sinHost = filters.find(
      (filter) =>
        Array.isArray(filter.data) &&
        filter.data.some((d) => d.$?.['android:scheme'] === 'orbithub') &&
        !filter.data.some((d) => d.$?.['android:host']),
    );

    if (!sinHost) {
      // Ya aplicado por un prebuild anterior. No se toca, y no se duplica.
      return cfg;
    }

    sinHost.data.push({
      $: { 'android:host': GOOGLE_HOST, 'android:path': GOOGLE_PATH },
    });

    return cfg;
  });
};