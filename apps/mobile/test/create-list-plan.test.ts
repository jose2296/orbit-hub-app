import { describe, expect, it } from 'vitest';

import { createListPlan } from '../src/lib/lists/create-plan';

/**
 * Creating a list has to tell the server two things that used to disagree: the
 * folder it lives in, for the cache and for the operation. The planning is pure
 * so the rules can be checked without a database, following `duplicate.ts`.
 */

const BASE = {
  id: 'list-1',
  workspaceId: 'ws-1',
  kind: 'tasks' as const,
  title: 'Compra',
};

const FOLDER = 'folder-1';

describe('createListPlan', () => {
  it('le dice al servidor en qué carpeta está la lista', () => {
    const plan = createListPlan({ ...BASE, folderId: FOLDER });

    expect(plan.payload.folderId).toBe(FOLDER);
  });

  it('saca la carpeta de un único sitio, así que caché y payload no pueden discrepar', () => {
    // Esto es lo que estaba roto: la caché llevaba la carpeta y el payload no,
    // así que una lista creada dentro de una carpeta caía en la raíz del
    // workspace tras el siguiente pull, sin quejarse nadie a ningún lado.
    const plan = createListPlan({ ...BASE, folderId: FOLDER });

    expect(plan.folderId).toBe(plan.payload.folderId);
  });

  it('una lista creada en la raíz lo dice, en vez de no decir nada', () => {
    const plan = createListPlan(BASE);

    expect(plan.folderId).toBeNull();
    // Omitir la carpeta no es lo mismo que decir que es la raíz, y el
    // sanitizador acepta el `null` explícito.
    expect(plan.payload.folderId).toBeNull();
  });

  it('una lista creada en una carpeta la conserva aunque no lleve emoji', () => {
    const plan = createListPlan({ ...BASE, folderId: FOLDER });

    expect(plan.payload.folderId).toBe(FOLDER);
    expect('emoji' in plan.payload).toBe(false);
  });

  it('el emoji viaja cuando hay uno', () => {
    const plan = createListPlan({ ...BASE, emoji: '🛒' });

    expect(plan.payload.emoji).toBe('🛒');
  });
});
