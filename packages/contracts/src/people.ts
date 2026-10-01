import { z } from 'zod';

import { isoDateTimeSchema } from './common';
import { userSchema } from './auth';

/**
 * Por que una persona esta en tu directorio.
 *
 * La direccion importa y es la unica parte de este contrato que no es obvia:
 * todo se lee desde el punto de vista de quien pregunta. `shared_with` es "yo le
 * he dado algo a esta persona", no "esta persona me lo ha dado a mi".
 *
 * `followed` es distinto de los otros tres porque **no viene de una operacion**: los
 * otros son la huella de algo que ya paso entre las dos personas, y este es una
 * decision de una de las dos. Por eso `relations` lleva `min(1)` y no mas: a quien
 * has seguido esta en tu directorio aunque no hayais hablado nunca, y con un solo
 * motivo, que es el suyo.
 *
 * Una persona puede estar por varias razones a la vez, y por eso es un array y
 * no un enum: Marta puede tenerle una lista compartida a uno, haberle compartido
 * un espacio a otro y ser del mismo equipo que un tercero, y un enum obliga a
 * elegir y pierde dos de las tres.
 */
export const personRelationSchema = z.enum(['shared_with', 'shared_by', 'space', 'followed']);
export type PersonRelation = z.infer<typeof personRelationSchema>;

/**
 * Alguien con quien ya has tratado, o a quien has seguido.
 *
 * `id` y no el correo como identificador, porque es lo que va en
 * `createShareRequestSchema.granteeUserId` y porque un correo se puede cambiar
 * mientras que un id no. El correo se envia igualmente: el sharing por id no
 * existe todavia en la interfaz, asi que la lista tiene que llevar la direccion
 * para que el picker pueda compartir sin escribirla.
 */
export const personSchema = z.object({
  /** The same four fields a workspace member row carries, and picked from
   * `userSchema` so the two cannot drift apart. */
  user: userSchema.pick({
    id: true,
    email: true,
    displayName: true,
    avatarUrl: true,
  }),
  /** Por que esta aqui, y no es una cosa: puede estar por varias a la vez. */
  relations: z.array(personRelationSchema).min(1),
  /** Cuando fue la ultima vez, para ordenar por quien se usa y no por nombre. */
  lastInteractionAt: isoDateTimeSchema,
});
export type Person = z.infer<typeof personSchema>;

/**
 * La gente con la que ya has tratado, mas a quien sigues.
 *
 * No hay `nextCursor` y no hay `limit`, y es a proposito: el conjunto esta acotado
 * por tus propias relaciones y no por la tabla de usuarios, asi que son unas pocas
 * decenas de filas como mucho. Un cursor sobre un conjunto que cabe en una pagina
 * es machinery para un problema que no existe.
 */
export const listPeopleResponseSchema = z.object({
  items: z.array(personSchema),
});
export type ListPeopleResponse = z.infer<typeof listPeopleResponseSchema>;

/* ------------------------------------------------------------- searching --- */

/**
 * Lo que has escrito para encontrar a alguien.
 *
 * El minimo son tres caracteres y no por capricho: esto **es una busqueda sobre la
 * tabla de cuentas**, y con dos letras cualquier coincide devuelve medio mundo.
 * Devolverle a alguien las primeras coincidencias de "an" es darle un trozo de la
 * lista de todas las personas con cuenta aqui, que es justo lo que un directorio
 * no debe ser.
 *
 * Y el limite de diez es por la misma razon: ver mas gente de la que buscabas es
 * listar, con un paginado de convenience por delante.
 */
export const searchPeopleQuerySchema = z.object({
  q: z.string().trim().min(3).max(120),
  /** Diez y no "todos". */
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
export type SearchPeopleQuery = z.infer<typeof searchPeopleQuerySchema>;

/**
 * Alguien que coincide con lo que escribiste y **aun no esta en tu directorio**.
 *
 * Solo gente que no tengas ya. Buscar a Marta para seguirla no tiene que devolverte
 * ademas a la Carla que ya tienes, y si las devolviera el boton de "añadir" no
 * sabria a quien pertenece cada fila.
 */
export const personMatchSchema = z.object({
  user: userSchema.pick({
    id: true,
    email: true,
    displayName: true,
    avatarUrl: true,
  }),
});
export type PersonMatch = z.infer<typeof personMatchSchema>;

export const searchPeopleResponseSchema = z.object({
  items: z.array(personMatchSchema),
});
export type SearchPeopleResponse = z.infer<typeof searchPeopleResponseSchema>;

/** Anadida o quitada. Las dos son un acierto cuando ya estaba asi. */
export const followPersonResponseSchema = z.object({
  following: z.boolean(),
});
export type FollowPersonResponse = z.infer<typeof followPersonResponseSchema>;