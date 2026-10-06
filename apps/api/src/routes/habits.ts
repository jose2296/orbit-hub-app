import {
  HABIT_DESCRIPTION_MAX,
  HABIT_ENTRY_NOTE_MAX,
  HABIT_NAME_MAX,
  habitEntryStatusSchema,
  habitScheduleSchema,
  habitSchema,
  listHabitEntriesQuerySchema,
  listHabitEntriesResponseSchema,
  listHabitsResponseSchema,
  localDateSchema,
  uuidSchema,
} from '@orbit-hub/contracts';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { habitsService } from '../modules/habits/habits-service.js';
import { HttpError } from '../lib/http-error.js';

import { sendData } from './respond.js';

/**
 * Los habitos, por HTTP.
 *
 * Personales y del que llama, como en `PeopleService`: el servicio solo ve
 * filas del `userId` y lo demas es 404. Las acciones (archivar, registrar)
 * devuelven 200 y no 201: una segunda pulsacion del mismo boton no puede
 * parecer que algo salio mal.
 */
export const habitsRouter = Router();

habitsRouter.use(requireAuth);

function caller(req: { auth?: { userId: string } }): string {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();
  return userId;
}

const habitParams = z.object({ habitId: uuidSchema });
const entryParams = z.object({ habitId: uuidSchema, date: localDateSchema });

const includeQuery = z.object({ include: z.literal('archived').optional() });

/**
 * Todo el habito menos lo que pone el servidor.
 *
 * Los limites salen del contrato (`HABIT_NAME_MAX` y compania) para que el
 * `.max()` de aqui y el `varchar` de la migracion digan lo mismo sin que
 * nadie los mantenga a mano en dos sitios.
 */
const createHabitBody = z.object({
  name: z.string().trim().min(1).max(HABIT_NAME_MAX),
  description: z.string().max(HABIT_DESCRIPTION_MAX).nullable().default(null),
  schedule: habitScheduleSchema,
  timezone: z.string().min(1).max(64),
  weekStart: z.union([z.literal(0), z.literal(1)]).default(0),
  startDate: localDateSchema,
  endDate: localDateSchema.nullable().default(null),
  targetValue: z.int().min(1).nullable().default(null),
  position: z.number().int().min(0).default(0),
});

/**
 * Sin `timezone` a proposito: la zona se congela al crear y el historico no
 * se reinterpreta, asi que no hay parche que la cambie.
 */
const updateHabitBody = createHabitBody.omit({ timezone: true }).partial();

const checkInBody = z.object({
  date: localDateSchema,
  status: habitEntryStatusSchema.default('done'),
  amount: z.int().min(0).nullable().default(null),
  note: z.string().max(HABIT_ENTRY_NOTE_MAX).nullable().default(null),
});

const patchEntryBody = z.object({
  status: habitEntryStatusSchema.optional(),
  amount: z.int().min(0).nullable().optional(),
  note: z.string().max(HABIT_ENTRY_NOTE_MAX).nullable().optional(),
});

/** La lista con su proyeccion de resumen: el habito mas sus entradas. */
habitsRouter.get('/', async (req, res) => {
  const { include } = includeQuery.parse(req.query);
  const items = await habitsService.list(caller(req), include === 'archived');
  sendData(res, 200, listHabitsResponseSchema.parse({ items }));
});

habitsRouter.post('/', async (req, res) => {
  const body = createHabitBody.parse(req.body ?? {});
  sendData(res, 201, habitSchema.parse(await habitsService.create(caller(req), body)));
});

habitsRouter.patch('/:habitId', async (req, res) => {
  const { habitId } = habitParams.parse(req.params);
  const body = updateHabitBody.parse(req.body ?? {});
  sendData(res, 200, habitSchema.parse(await habitsService.update(caller(req), habitId, body)));
});

habitsRouter.post('/:habitId/archive', async (req, res) => {
  const { habitId } = habitParams.parse(req.params);
  sendData(
    res,
    200,
    habitSchema.parse(await habitsService.setArchived(caller(req), habitId, true)),
  );
});

habitsRouter.post('/:habitId/unarchive', async (req, res) => {
  const { habitId } = habitParams.parse(req.params);
  sendData(
    res,
    200,
    habitSchema.parse(await habitsService.setArchived(caller(req), habitId, false)),
  );
});

habitsRouter.delete('/:habitId', async (req, res) => {
  const { habitId } = habitParams.parse(req.params);
  await habitsService.remove(caller(req), habitId);
  res.status(204).end();
});

/** Las entradas vivas de la ventana `[from, to]`, que es obligatoria. */
habitsRouter.get('/:habitId/entries', async (req, res) => {
  const { habitId } = habitParams.parse(req.params);
  const query = listHabitEntriesQuerySchema.parse(req.query);
  if (!query.from || !query.to) {
    // Sin ventana no hay consulta: abrirla sobre un habito diario es pedir
    // miles de filas para pintar una semana.
    throw HttpError.validation('Pide las entradas por ventana, con from y to');
  }
  const items = await habitsService.entries(caller(req), habitId, query.from, query.to, query.limit);
  sendData(res, 200, listHabitEntriesResponseSchema.parse({ items }));
});

/**
 * Registrar un dia.
 *
 * 200 y no 201: remarcar reescribe en vez de sumar, asi que una segunda
 * pulsacion no crea nada nuevo. Y devuelve solo la entrada: el resumen lo
 * recalcula el movil con `progressForPeriod`.
 */
habitsRouter.post('/:habitId/entries', async (req, res) => {
  const { habitId } = habitParams.parse(req.params);
  const body = checkInBody.parse(req.body ?? {});
  sendData(res, 200, await habitsService.checkIn(caller(req), habitId, body));
});

habitsRouter.patch('/:habitId/entries/:date', async (req, res) => {
  const { habitId, date } = entryParams.parse(req.params);
  const body = patchEntryBody.parse(req.body ?? {});
  sendData(res, 200, await habitsService.patchEntry(caller(req), habitId, date, body));
});

/** Desmarcar: borrado logico para que otros dispositivos se enteren. */
habitsRouter.delete('/:habitId/entries/:date', async (req, res) => {
  const { habitId, date } = entryParams.parse(req.params);
  await habitsService.clearEntry(caller(req), habitId, date);
  res.status(204).end();
});
