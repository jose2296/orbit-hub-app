-- Una coleccion y un enlace dejan de ser los dos nodos que no se comparten.
--
-- `shares` es una tabla generica: `node_type` + `node_id` y nada mas. El CHECK de
-- la columna es lo unico que los excluia, y por eso "no hace falta migracion" era
-- media verdad: el `varchar(16)` entra de sobra —`collection` son 10 caracteres y
-- `bookmark` son 8—, pero el CHECK se escribe a mano desde `0011` y enumera los
-- valores uno por uno. Sin tocarlo, el POST pasa la validacion de Zod, el servicio
-- resuelve el nodo, y la fila muere en Postgres con un `check violation` que a la
-- persona le llega como un 500.
--
-- No hay mas que cambiar. Todo lo demas ya estaba construido para estos dos:
--
--  - `toEntityName` (sync-repository) devuelve `'collection'` y `'bookmark'`.
--  - `espacioDe` (mounts) tiene sus dos ramas, y la de `collection` esta **antes**
--    de la de `notes` a proposito, porque la de notas es el final de la cadena y no
--    lleva `else`.
--  - `montajesDe` los proyecta como nodos de primera clase, con su `folderId`.
--
-- Y por que los dos son compartibles y la plantilla no: una plantilla no esta en
-- ningun arbol y no hay donde colocarla. Una coleccion y un enlace estan en un
-- espacio y en una carpeta como cualquier otro, asi que el sitio donde los recibe
-- quien los recibe ya existe. Ver `0008_shares.sql`, `0011_note_is_an_entity.sql`
-- y `0018_note_template_not_shareable.sql`, y el enum en
-- `packages/contracts/src/workspace.ts`.
--
-- El CHECK sigue escribiendose a mano y no deriva del enum de Zod porque no hay
-- forma de que un `z.enum` genere SQL: las dos mitades se sostienen con el guard
-- de `apps/api/test/shares.test.ts`, que compara lo que el enum admite con lo que
-- la columna acepta.

do $$ begin
  alter table shares drop constraint if exists shares_node_type_check;
exception when undefined_object then null; end $$;
--> statement-breakpoint
do $$ begin
  alter table shares
    add constraint shares_node_type_check
    check (node_type in ('workspace', 'folder', 'list', 'list_item', 'note', 'collection', 'bookmark'));
exception when duplicate_object then null; end $$;