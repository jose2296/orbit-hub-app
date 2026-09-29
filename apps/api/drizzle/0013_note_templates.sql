CREATE TABLE "note_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"name" varchar(120) NOT NULL,
	"description" varchar(300) DEFAULT '' NOT NULL,
	"icon" varchar(40) DEFAULT 'document-text-outline' NOT NULL,
	"scope" varchar(16) DEFAULT 'workspace' NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"built_in_key" varchar(60),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "note_templates" ADD CONSTRAINT "note_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_templates" ADD CONSTRAINT "note_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_templates_workspace_idx" ON "note_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "note_templates_scope_idx" ON "note_templates" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "note_templates_deleted_at_idx" ON "note_templates" USING btree ("deleted_at");
--> statement-breakpoint

-- Indice unico PARCIAL, y no unico a secas: varias plantillas de una persona
-- pueden compartir un `built_in_key` nulo, y en Postgres null no colisiona en un
-- indice unico, asi que el efecto seria el mismo. Lo que no puede pasar es que
-- haya dos plantillas de catalogo con la misma clave, porque una actualizacion
-- tiene que reemplazar la que ya esta en el movil en vez de anadir otra, y con
-- dos el selector muestra la receta dos veces sin poder decir cual es la buena.

CREATE UNIQUE INDEX note_templates_built_in_key_unique
  ON note_templates (built_in_key) where built_in_key is not null;
--> statement-breakpoint

-- Lo que drizzle-kit no sabe expresar, escrito a mano como en 0008_shares.sql.
--
-- Un CHECK por columna, no por codigo: una plantilla con 'scope' libre admite
-- 'privado' el dia que alguien se equivoca, y el error sale tres capas mas abajo,
-- en la sincronizacion.

do $$ begin
  alter table note_templates
    add constraint note_templates_scope_check
    check (scope in ('personal', 'workspace', 'public'));
exception when duplicate_object then null; end $$;
