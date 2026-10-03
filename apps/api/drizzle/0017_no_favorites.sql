-- Favoritos fuera. `notes.favorite` ya se habia ido en 0016; esta quita las dos que
-- quedaban, de `lists` y de `list_items`.
--
-- Se borra la columna y no se marca: un favorito es un estado que la persona puso y
-- que nadie mas necesita. Los datos de la tabla siguen intactos, y las filas que no
-- tenian el campo se leen bien como `false`; lo que se pierde es poder preguntar por
-- ellas, y no habia ninguna pregunta que respondiera.
--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "favorite";
--> statement-breakpoint
ALTER TABLE "list_items" DROP COLUMN "favorite";
