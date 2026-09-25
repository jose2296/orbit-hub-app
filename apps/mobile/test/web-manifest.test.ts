import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(appRoot, 'public');

interface WebManifest {
  name: string;
  start_url: string;
  display: string;
  icons: { src: string; sizes: string; purpose?: string }[];
}

/**
 * The web manifest is hand written, so nothing checks that the files it points
 * at exist. A missing icon makes the PWA uninstallable and logs a 404 on every
 * load, and the type checker cannot see it. This closes that gap.
 */
describe('public/manifest.webmanifest', () => {
  const manifest = JSON.parse(
    readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8'),
  ) as WebManifest;

  it('is a standalone PWA rooted at /', () => {
    expect(manifest.name).not.toHaveLength(0);
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('has at least one icon', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('points every icon at a file that exists', () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/'), `${icon.src} should be a root path`).toBe(true);
      const file = join(publicDir, icon.src.replace(/^\//, ''));
      expect(existsSync(file), `${icon.src} is missing from public/`).toBe(true);
    }
  });

  it('offers a maskable icon, which Android requires to install', () => {
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('declares a square icon large enough for a home screen', () => {
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(width).toBe(height);
      expect(width).toBeGreaterThanOrEqual(192);
    }
  });
});
