import { describe, expect, it } from 'vitest';

import { API_PREFIX } from '@orbit-hub/config';

import {
  bundleContainsUrl,
  checkExportApiUrl,
  checkPublicEnvironment,
} from '../../../scripts/assert-export-env.mjs';

const GOOD_ENV = {
  EXPO_PUBLIC_API_URL: 'https://orbithub-api.jrz-labs.com/api/v1',
  EXPO_PUBLIC_WEB_ORIGIN: 'https://orbithub-app.jrz-labs.com',
  EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID: '959281134147-android.apps.googleusercontent.com',
};

/**
 * The API router mounts everything under `API_PREFIX`, so the base URL the app is
 * given has to carry it. These tests exist because the copy of the prefix inside the
 * script is a literal — it cannot import the package, it runs before the
 * dependencies are installed — and a literal is exactly the thing that drifts.
 */
describe('checkExportApiUrl', () => {
  it('accepts a deployed API behind the prefix', () => {
    expect(checkExportApiUrl(GOOD_ENV.EXPO_PUBLIC_API_URL)).toBe(GOOD_ENV.EXPO_PUBLIC_API_URL);
  });

  it('tolerates a trailing slash on the prefix', () => {
    expect(checkExportApiUrl(`${GOOD_ENV.EXPO_PUBLIC_API_URL}/`)).toBeTruthy();
  });

  it('rejects an empty value', () => {
    expect(() => checkExportApiUrl('')).toThrow(/empty/);
    expect(() => checkExportApiUrl(undefined)).toThrow(/empty/);
  });

  it('rejects a base without the prefix, which asks for a path that 404s', () => {
    expect(() => checkExportApiUrl('https://api.example.com')).toThrow(new RegExp(API_PREFIX));
  });

  it('rejects the build machine by every name it goes by', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '10.0.2.2']) {
      expect(() => checkExportApiUrl(`http://${host}:4000${API_PREFIX}`)).toThrow(
        /machine doing the build/,
      );
    }
  });

  it('rejects plain http on a deployed origin', () => {
    expect(() => checkExportApiUrl('http://api.example.com/api/v1')).toThrow(/mixed content/);
  });

  it('rejects something that is not a URL', () => {
    expect(() => checkExportApiUrl('temp-api')).toThrow(/absolute URL/);
  });

  it('the prefix it enforces is the one the router uses', () => {
    // The whole point of the literal above: if this fails, the script is checking
    // for a prefix the server stopped mounting.
    expect(API_PREFIX).toBe('/api/v1');
  });
});

describe('checkPublicEnvironment', () => {
  it('accepts a complete public environment', () => {
    expect(checkPublicEnvironment(GOOD_ENV)).toBe(GOOD_ENV.EXPO_PUBLIC_API_URL);
  });

  it('rejects a missing Google client id, which renders a dead button', () => {
    const { EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID: _omitted, ...rest } = GOOD_ENV;
    expect(() => checkPublicEnvironment(rest)).toThrow(/EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID/);
  });

  /**
   * The guard was asking for a variable that **nothing defines**.
   *
   * `google-auth.ts` reads a client id per platform — `_WEB`, `_ANDROID`, `_IOS` —
   * because Google refuses a web client id inside an installed app. The script
   * still asked for the bare `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, so no `.env.release`
   * could satisfy it and the release could not pass.
   *
   * The test that pins this reads the real script rather than a copy, because a
   * copy is exactly the thing that drifts: it passed happily with the old name
   * while the release was stuck, which is the failure this is about.
   */
  it('exige el client id que la app lee de verdad, y no uno que nadie define', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const script = readFileSync(
      join(import.meta.dirname, '../../../scripts/assert-export-env.mjs'),
      'utf8',
    );

    // Y que no vuelva el nombre viejo: ese es el que hacia la release
    // imposible de satisfacer.
    expect(
      script,
      'el client id de Android es el que se exige',
    ).toContain('EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID');
    expect(
      script,
      'el nombre sin plataforma no puede volver a aparecer en REQUIRED',
    ).not.toMatch(/REQUIRED\s*=\s*\[[^\]]*EXPO_PUBLIC_GOOGLE_CLIENT_ID'/);
  });

  it('el Dockerfile de la web declara las MISMAS variables que el script exige', () => {
    /*
     * El fallo que hizo esto necesario.
     *
     * El `ARG` de `Dockerfile.web` se llamaba `EXPO_PUBLIC_GOOGLE_CLIENT_ID` y el
     * `RUN` que invoca el assert se quedaba sin la variable: el build de Railway
     * fallo con "GOOGLE_CLIENT_ID_ANDROID is empty" en un repo donde el assert
     * estaba **bien**.
     *
     * El assert es correcto y aun asi el build se rompio, porque hay un segundo
     * sitio donde el nombre aparece y nadie lo Miro: el `ARG`. Dos lugares con el
     * mismo nombre en dos ficheros, y el unico que habia verificado algo era el que
     * no hacia falta cambiar.
     *
     * Docker no entrega a un `RUN` una variable de build que el stage no nombre, de
     * ahi el `ARG`: es el unico mecanismo. Por eso el chequeo tiene que leer el
     * `Dockerfile` y no basta con que el assert este bien.
     */
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const raiz = join(import.meta.dirname, '../../..');
    const dockerfile = readFileSync(join(raiz, 'Dockerfile.web'), 'utf8');

    for (const name of [
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_WEB_ORIGIN',
      'EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID',
    ]) {
      // El `ARG` es lo que hace el trabajo: sin el, el `RUN` no ve la variable.
      expect(
        new RegExp(`^ARG ${name}$`, 'm').test(dockerfile),
        `${name} necesita un ARG en Dockerfile.web, o el RUN del assert no lo ve`,
      ).toBe(true);
      expect(
        new RegExp(`^ENV ${name}=`, 'm').test(dockerfile),
        `${name} necesita un ENV en Dockerfile.web, o no llega al RUN`,
      ).toBe(true);
    }

    // Y el nombre viejo no puede volver a colarse, que es el que rompio el build.
    expect(
      dockerfile,
      'el client id sin plataforma no puede volver al Dockerfile',
    ).not.toMatch(/^(ARG|ENV) EXPO_PUBLIC_GOOGLE_CLIENT_ID=/m);
  });

  it('lo que el script exige existe en el fichero de release de ejemplo', () => {
    // El otro sentido del drift: que las variables que el guard exige esten
    // **de verdad** en el `.env.release.example` que el script de release copia.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const ejemplo = readFileSync(
      join(import.meta.dirname, '../../mobile/.env.release.example'),
      'utf8',
    );

    for (const name of [
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_WEB_ORIGIN',
      'EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID',
    ]) {
      expect(
        new RegExp(`^${name}=`, 'm').test(ejemplo),
        `${name} tiene que existir en .env.release.example, o el guard exige algo que el release no puede dar`,
      ).toBe(true);
    }
  });

  it('rejects a missing web origin', () => {
    const { EXPO_PUBLIC_WEB_ORIGIN: _omitted, ...rest } = GOOD_ENV;
    expect(() => checkPublicEnvironment(rest)).toThrow(/EXPO_PUBLIC_WEB_ORIGIN/);
  });

  it('rejects a web origin pointing at the build machine', () => {
    expect(() =>
      checkPublicEnvironment({ ...GOOD_ENV, EXPO_PUBLIC_WEB_ORIGIN: 'http://localhost:8081' }),
    ).toThrow(/build machine/);
  });
});

describe('bundleContainsUrl', () => {
  it('finds nothing in a directory that does not hold the bundle', () => {
    expect(bundleContainsUrl('apps/mobile/src', GOOD_ENV.EXPO_PUBLIC_API_URL)).toBe(false);
  });
});