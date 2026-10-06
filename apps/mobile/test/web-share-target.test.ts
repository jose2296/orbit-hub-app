import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface WebManifest {
  name: string;
  start_url: string;
  display: string;
  theme_color?: string;
  icons: { src: string; sizes: string; purpose?: string }[];
  share_target?: {
    action: string;
    method: string;
    enctype: string;
    params: { title?: string; text?: string; url?: string };
  };
}

const manifest = JSON.parse(
  readFileSync(join(appRoot, 'public', 'manifest.webmanifest'), 'utf8'),
) as WebManifest;

describe('el manifest declara el share target', () => {
  it('tiene action POST a /share-target con title, text y url', () => {
    expect(manifest.share_target?.action).toBe('/share-target');
    expect(manifest.share_target?.method).toBe('POST');
    expect(manifest.share_target?.enctype).toBe('application/x-www-form-urlencoded');
    expect(manifest.share_target?.params).toEqual({ title: 'title', text: 'text', url: 'url' });
  });

  it('sigue siendo instalable: nombre, iconos, display, start_url y theme_color', () => {
    expect(manifest.name).not.toHaveLength(0);
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).not.toHaveLength(0);
  });
});
