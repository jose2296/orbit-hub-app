import { inArray } from 'drizzle-orm';

import { folders } from '../../db/schema.js';
import type { Database } from '../../db/client.js';

/**
 * Every folder under the ones given, and the folders given themselves.
 *
 * Two things need exactly this and had it written twice, which is how they stopped
 * agreeing: the share service, to move the clocks of what a folder share makes
 * reachable, and the pull, to admit what is inside it. When only the folder itself was
 * handled, a shared folder arrived with nothing in it — and it looked like the share had
 * failed rather than like half of it worked.
 *
 * **Descending, level by level, with a bound.** A cycle in the folder tree would
 * otherwise walk here forever, and a cycle in a folder tree is not supposed to be
 * impossible — it just has not happened to anybody yet.
 *
 * Level by level rather than a recursive CTE because the tables differ by dialect and
 * this runs against an in-memory Postgres in the tests as well as a real one; a plain
 * loop is the same code on both.
 */
export async function descendientesDeCarpetas(
  db: Database,
  carpetaIds: readonly string[],
): Promise<string[]> {
  if (carpetaIds.length === 0) return [];

  const vistos = new Set<string>(carpetaIds);
  let nivel = [...carpetaIds];

  for (let profundidad = 0; profundidad < 32 && nivel.length > 0; profundidad += 1) {
    const hijos = await db
      .select({ id: folders.id })
      .from(folders)
      .where(inArray(folders.parentId, nivel));

    const siguientes: string[] = [];
    for (const hijo of hijos) {
      if (vistos.has(hijo.id)) continue; // the cycle guard, and it is the `vistos` set
      vistos.add(hijo.id);
      siguientes.push(hijo.id);
    }
    nivel = siguientes;
  }

  return [...vistos];
}