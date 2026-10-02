import { exportFilename } from '@orbit-hub/contracts';
import { describe, expect, it } from 'vitest';

describe('exportFilename', () => {
  it('deja un nombre sin espacios ni acentos', () => {
    expect(
      exportFilename({ title: 'Películas para ver', fallbackId: 'x', extension: 'csv', date: '2026-10-02' }),
    ).toBe('orbit-hub-peliculas-para-ver-2026-10-02.csv');
  });

  it('quita los emojis y los simbolos, no los tira todos', () => {
    expect(
      exportFilename({ title: 'Café ☕ & cosas', fallbackId: 'x', extension: 'json', date: '2026-10-02' }),
    ).toBe('orbit-hub-cafe-cosas-2026-10-02.json');
  });

  it('cae al id cuando el titulo no deja nada', () => {
    expect(
      exportFilename({ title: '🎬🎬', fallbackId: 'a1b2c3d4', extension: 'csv', date: '2026-10-02' }),
    ).toBe('orbit-hub-a1b2c3d4-2026-10-02.csv');
  });

  it('corta el slug a 40 caracteres sin comerse el guion', () => {
    const slug = exportFilename({
      title: 'a'.repeat(80), fallbackId: 'x', extension: 'csv', date: '2026-10-02',
    });
    expect(slug).toBe(`orbit-hub-${'a'.repeat(40)}-2026-10-02.csv`);
  });

  it('produce el nombre de la cuenta sin titulo', () => {
    expect(
      exportFilename({ title: 'export', fallbackId: 'export', extension: 'json', date: '2026-10-02' }),
    ).toBe('orbit-hub-export-2026-10-02.json');
  });
});
