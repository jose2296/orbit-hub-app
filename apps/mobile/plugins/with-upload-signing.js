/**
 * Añade la configuración de firma de subida a Google Play al `build.gradle`.
 *
 * Sin esto, `build.gradle` firma los builds `release` con `debug.keystore`, y
 * Play Console rechaza el AAB. La clave de subida es tuya y vive fuera del
 * repo, así que se lee del entorno en vez de escribirla en un fichero.
 *
 * El parche se aplica en cada `expo prebuild` y es idempotente: lo que hay
 * entre los dos marcadores se borra antes de volver a insertarse, así que
 * correr prebuild dos veces no deja el bloque duplicado.
 */

const { withAppBuildGradle } = require('expo/config-plugins');

const BEGIN = '// orbit-hub: upload signing (generado, no editar a mano)';
const END = '// orbit-hub: fin upload signing';

/**
 * `storeFile` se evalúa en la fase de configuración, no en la de build, así que
 * `file(System.getenv(...))` con la variable ausente es `file(null)` y revienta
 * **antes de compilar nada**, también cuando solo se pide un build de debug. De
 * ahí el ternario: sin la variable, el almacén queda en null y el build de debug
 * sigue igual. El `release` es el que decide si usa esta firma o la de debug.
 */
const UPLOAD_SIGNING_CONFIG = [
  '',
  '        upload {',
  "            storeFile System.getenv('ORBIT_HUB_UPLOAD_KEYSTORE') ? file(System.getenv('ORBIT_HUB_UPLOAD_KEYSTORE')) : null",
  "            storePassword System.getenv('ORBIT_HUB_UPLOAD_STORE_PASSWORD')",
  "            keyAlias System.getenv('ORBIT_HUB_UPLOAD_KEY_ALIAS')",
  "            keyPassword System.getenv('ORBIT_HUB_UPLOAD_KEY_PASSWORD')",
  '        }',
].join('\n');

const RELEASE_SIGNING_CHOICE = [
  '            if (System.getenv(\'ORBIT_HUB_UPLOAD_KEYSTORE\')) {',
  '                signingConfig signingConfigs.upload',
  '            } else {',
  '                signingConfig signingConfigs.debug',
  '            }',
].join('\n');

function stripPreviousPatch(contents) {
  const start = contents.indexOf(BEGIN);
  const end = contents.indexOf(END);
  if (start === -1 || end === -1) return contents;
  return contents.slice(0, start) + contents.slice(end + END.length).replace(/^\n/, '');
}

module.exports = function withUploadSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        `with-upload-signing: se esperaba un build.gradle de Groovy y llegó ${cfg.modResults.language}.`,
      );
    }

    let contents = stripPreviousPatch(cfg.modResults.contents);

    const signingConfigsMatch = contents.match(/keyPassword 'android'\n {8}\}/);
    if (!signingConfigsMatch) {
      throw new Error(
        'with-upload-signing: no se encontró el bloque debug de signingConfigs en ' +
          'apps/mobile/android/app/build.gradle. Probably cambió la plantilla de Expo; ' +
          'revisa este plugin para seguirla.',
      );
    }

    const anchor = signingConfigsMatch[0];
    contents = contents.replace(
      anchor,
      `${anchor}\n${UPLOAD_SIGNING_CONFIG}`,
    );

    const releaseBlock = /(release\s*\{\s*(?:\/\/[^\n]*\s*)*)signingConfig signingConfigs\.debug/;
    if (!releaseBlock.test(contents)) {
      throw new Error(
        'with-upload-signing: no se encontró el buildType release con la firma de debug en ' +
          'apps/mobile/android/app/build.gradle. Revisa este plugin para seguirla.',
      );
    }

    contents = contents.replace(
      releaseBlock,
      (_match, head) => `${head}\n${BEGIN}\n${RELEASE_SIGNING_CHOICE}\n${END}`,
    );

    cfg.modResults.contents = contents;
    return cfg;
  });
};