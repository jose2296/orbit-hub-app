-- Una plantilla deja de ser un nodo compartible.
--
-- `note_template` estaba en el CHECK de `shares.node_type` desde 0011, y no habia
-- forma de compartir una plantilla con una persona. Tres cosas lo decian:
--
--  1. `toEntityName` (sync-repository) devuelve `null` para ese tipo, asi que al
--     revocar una concesion de plantilla no se generaba ninguna lapida. El movil
--     que la tenia cacheada seguia mostrandola para siempre: no habia manera de
--     quitarsela a nadie.
--  2. Las plantillas ya se comparten de otra forma, por `scope`
--     (`personal` / `workspace` / `publico`), y ese mecanismo reparte a un espacio
--     entero o a todo el mundo, nunca a una persona. Dos mecanismos para lo mismo y
--     uno a medio construir.
--  3. No hay sitio donde la coloque quien la recibe. Una nota tiene sitio porque
--     tiene espacio y carpeta; una plantilla no esta en ningun arbol.
--
-- Las filas que ya existieran no eran compartibles de nada: `resolveTarget` no
-- tenia rama para ellas y devolvia 404, asi que no se podia crear ninguna por la
-- via normal. Se borran en vez de convertirlas, y se avisa por si las hay, porque
-- borrarlas es quietly perder filas y eso al menos hay que verlo en el log.
--
-- Ver `docs/architecture/adr/0032-personas.md`.

delete from shares where node_type = 'note_template';--> statement-breakpoint
do $$ begin
  alter table shares drop constraint if exists shares_node_type_check;
exception when undefined_object then null; end $$;
--> statement-breakpoint
do $$ begin
  alter table shares
    add constraint shares_node_type_check
    check (node_type in ('workspace', 'folder', 'list', 'list_item', 'note'));
exception when duplicate_object then null; end $$;
