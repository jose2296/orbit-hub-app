-- El icono pasa a ser un objeto: un `jsonb` con la forma que fija
-- `packages/contracts/src/icons.ts`, en las cinco entidades que tienen icono.
--
-- Va en dos pasos porque en `list_items` el nombre nuevo y el viejo son el mismo
-- y el backfill tiene que ir en medio: por eso la columna nueva de esa tabla se
-- llama `icon_ref` aqui y se renombra al final. Drizzle generaria un
-- `ADD COLUMN "icon"` y un `DROP COLUMN "icon"` sobre la misma tabla, que se
-- contradicen; este archivo esta escrito a mano y el snapshot de `meta/` ya
-- describe como queda la tabla.
--
-- 1. La columna nueva, nullable y sin default: una fila que no la tiene es
--    "nadie eligió icono", que es un estado que el renderer ya sabe dibujar.
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "icon" jsonb;
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "icon" jsonb;
--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "icon" jsonb;
--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "icon_ref" jsonb;
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "icon" jsonb;
--> statement-breakpoint
-- 2. El backfill. Un emoji era un icono, y por eso no se pierde nada que alguien
--    hubiera escrito a mano.
--> statement-breakpoint
UPDATE "workspaces" SET "icon" = jsonb_build_object('type','emoji','value',"emoji",'color','auto') WHERE "emoji" IS NOT NULL AND "emoji" <> '';
--> statement-breakpoint
UPDATE "folders"    SET "icon" = jsonb_build_object('type','emoji','value',"emoji",'color','auto') WHERE "emoji" IS NOT NULL AND "emoji" <> '';
--> statement-breakpoint
UPDATE "lists"      SET "icon" = jsonb_build_object('type','emoji','value',"emoji",'color','auto') WHERE "emoji" IS NOT NULL AND "emoji" <> '';
--> statement-breakpoint
-- 3. Las tres columnas sueltas de un elemento a un objeto, en la columna con
--    otro nombre. `icon_style` y `icon_color` tenían default, así que se leen tal
--    cual: una fila escrita antes de que existieran era contorno y neutral.
--> statement-breakpoint
UPDATE "list_items" SET "icon_ref" = jsonb_build_object(
  'type','vector','library','ionicons','value',"icon",'style',"icon_style",'color',"icon_color"
) WHERE "icon" IS NOT NULL AND "icon" <> '';
--> statement-breakpoint
-- 4. Las columnas viejas, fuera, y la nueva con el nombre bueno.
--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "emoji";
--> statement-breakpoint
ALTER TABLE "folders" DROP COLUMN "emoji";
--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "emoji";
--> statement-breakpoint
ALTER TABLE "list_items" DROP COLUMN "icon_style";
--> statement-breakpoint
ALTER TABLE "list_items" DROP COLUMN "icon_color";
--> statement-breakpoint
ALTER TABLE "list_items" DROP COLUMN "icon";
--> statement-breakpoint
ALTER TABLE "list_items" RENAME COLUMN "icon_ref" TO "icon";