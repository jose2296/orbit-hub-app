import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase, runMigrations } from '../src/db/client.js';
import { users } from '../src/db/auth-schema.js';
import { habitEntries, habits } from '../src/db/habit-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '..', 'drizzle');

async function crearUsuario() {
  const { db } = await getDatabase();
  const id = randomUUID();
  await db.insert(users).values({
    id,
    email: `habito-${id}@example.com`,
    displayName: 'Habito Test',
  });
  return id;
}

async function crearHabito(userId: string) {
  const { db } = await getDatabase();
  const id = randomUUID();
  await db.insert(habits).values({
    id,
    userId,
    name: 'Salir a correr',
    schedule: { kind: 'rrule', rule: 'FREQ=DAILY' },
    timezone: 'Europe/Madrid',
    startDate: '2026-03-01',
  });
  return id;
}

async function insertar(habitId: string, date: string) {
  const { db } = await getDatabase();
  await db.insert(habitEntries).values({
    id: randomUUID(),
    habitId,
    date,
    status: 'done',
  });
}

describe('tablas de habitos', () => {
  beforeAll(async () => {
    await runMigrations(migrationsFolder);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('no se pueden meter dos entradas para el mismo habito y el mismo dia', async () => {
    const userId = await crearUsuario();
    const habitId = await crearHabito(userId);
    await insertar(habitId, '2026-03-04');
    // El UNIQUE (habit_id, date) es la regla "un dia cuenta una sola vez".
    await expect(insertar(habitId, '2026-03-04')).rejects.toThrow();
  });

  it('borrar el usuario se lleva sus habitos', async () => {
    const { db } = await getDatabase();
    const userId = await crearUsuario();
    const habitId = await crearHabito(userId);
    const { eq } = await import('drizzle-orm');
    await db.delete(users).where(eq(users.id, userId));
    const filas = await db.select().from(habits).where(eq(habits.id, habitId));
    expect(filas).toHaveLength(0);
  });

  it('borrar el habito se lleva sus entradas', async () => {
    const { db } = await getDatabase();
    const userId = await crearUsuario();
    const habitId = await crearHabito(userId);
    await insertar(habitId, '2026-03-05');
    const { eq } = await import('drizzle-orm');
    await db.delete(habits).where(eq(habits.id, habitId));
    const filas = await db.select().from(habitEntries).where(eq(habitEntries.habitId, habitId));
    expect(filas).toHaveLength(0);
  });
});
