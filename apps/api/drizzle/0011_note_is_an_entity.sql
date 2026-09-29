-- ADR 0008: una nota es una entidad y el elemento tiene una anotacion.
--
-- Las dos cosas se llamaban 'notes'. El nombre hizo que alguien leyera el
-- esquema y concluyera que la nota era esta columna, y de ahi salio el
-- comentario de que "una nota no es una tabla" en el contrato, en la tabla
-- shares y en el roadmap. Un documento ProseMirror no cabe en un varchar(2000),
-- asi que la conclusion era falsa y la Fase 4 la desmiente.
--
-- Se renombra en vez de borrar y crear: la columna ya tiene filas escritas y
-- perderlas al corregir un nombre seria un fallo mucho peor que el que
-- corrige este fichero.

ALTER TABLE "list_items" RENAME COLUMN "notes" TO "annotation";
--> statement-breakpoint

-- El CHECK de 'node_type' sigue a mano, por la misma razon que en 0008_shares.sql:
-- una tabla con 'node_type' libre admite 'carpeta' el dia que alguien se equivoca, y
-- el error sale tres capas mas abajo, en la sincronizacion. Se suelta y se vuelve a
-- poner porque un CHECK no se puede alterar, solo recrear.
--
-- 'note' y 'note_template' anaden dos tipos. La nota es compartible por derecho
-- propio, y una plantilla tambien, que es lo que hace posible recibir una plantilla
-- de otra persona sin ser miembro de su espacio.

do $$ begin
  alter table shares drop constraint if exists shares_node_type_check;
exception when undefined_object then null; end $$;
--> statement-breakpoint
do $$ begin
  alter table shares
    add constraint shares_node_type_check
    check (node_type in ('workspace', 'folder', 'list', 'list_item', 'note', 'note_template'));
exception when duplicate_object then null; end $$;
--> statement-breakpoint
