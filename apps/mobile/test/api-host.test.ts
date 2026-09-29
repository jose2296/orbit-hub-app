import { describe, expect, it } from 'vitest';

import { ANDROID_EMULATOR_HOST, retargetLoopbackHost } from '../src/lib/api/host';

/**
 * The address the app talks to, on each of the three targets.
 *
 * This is the rule that decides whether the app works at all, and it is checked
 * nowhere else: a wrong host produces no error, no empty state and no warning.
 * The app starts, reads the cache, and every request fails somewhere the person
 * driving it cannot see. It is also the rule most likely to be broken by an edit
 * to an environment file, because that is where somebody goes to make the
 * emulator work and cannot tell that web now points at `10.0.2.2`.
 */
describe('retargetLoopbackHost on the Android emulator', () => {
  it('sends a loopback address to the machine hosting the emulator', () => {
    // The whole point. Inside the emulator `localhost` is the emulator, and the
    // API is on the other side of the virtual router.
    expect(retargetLoopbackHost('http://localhost:4000/api/v1', 'android')).toBe(
      `http://${ANDROID_EMULATOR_HOST}:4000/api/v1`,
    );
  });

  it('covers every spelling of loopback', () => {
    // `localhost` is what a person types; `127.0.0.1` is what a tool writes when
    // it resolves one. Missing either leaves a target that looks configured and
    // is not.
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(retargetLoopbackHost(`http://${host}:4000/api/v1`, 'android')).toBe(
        `http://${ANDROID_EMULATOR_HOST}:4000/api/v1`,
      );
    }
  });

  it('keeps the port, the path and the scheme', () => {
    // Only the host is in question. Losing the port moves the app to another
    // service, and losing the version prefix makes the API answer 404 on
    // something that was working.
    expect(retargetLoopbackHost('https://localhost:8443/api/v1/health', 'android')).toBe(
      `https://${ANDROID_EMULATOR_HOST}:8443/api/v1/health`,
    );
  });

  it('does not add a trailing slash to an origin', () => {
    // Callers join paths onto the base, so a bare origin comes back bare.
    // `URL` would put a slash on it and `//health` would be the request.
    expect(retargetLoopbackHost('http://localhost:8081', 'android')).toBe(
      `http://${ANDROID_EMULATOR_HOST}:8081`,
    );
  });

  it('leaves a trailing slash alone when the value came with one', () => {
    expect(retargetLoopbackHost('http://localhost:8081/', 'android')).toBe(
      `http://${ANDROID_EMULATOR_HOST}:8081/`,
    );
  });

  it('does not touch an address that is already right', () => {
    // A deployed API, a tunnel and the LAN address `make device` injects all
    // name the host on purpose. Rewriting any of them would break the case that
    // works today to serve the one that does not.
    for (const url of [
      'https://api.orbithub.com/api/v1',
      'http://192.168.1.20:4000/api/v1',
      'http://10.0.2.2:4000/api/v1',
    ]) {
      expect(retargetLoopbackHost(url, 'android')).toBe(url);
    }
  });

  it('returns a value that is not an address unchanged', () => {
    // A bare path is nonsense to configure, and this is not the place to decide
    // what it means. The caller reports a bad configuration better than a
    // rewritten one would.
    expect(retargetLoopbackHost('/api/v1', 'android')).toBe('/api/v1');
    expect(retargetLoopbackHost('not a url', 'android')).toBe('not a url');
  });
});

describe('retargetLoopbackHost off the Android emulator', () => {
  it('leaves the browser pointing at the machine serving it', () => {
    // Web and the iOS simulator are on the same machine as the API, so this is
    // the value they want untouched.
    expect(retargetLoopbackHost('http://localhost:4000/api/v1', 'web')).toBe(
      'http://localhost:4000/api/v1',
    );
    expect(retargetLoopbackHost('http://localhost:4000/api/v1', 'ios')).toBe(
      'http://localhost:4000/api/v1',
    );
  });
});
