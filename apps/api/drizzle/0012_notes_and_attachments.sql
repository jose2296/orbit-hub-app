CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" varchar(200) NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_workspace_updated_at_idx" ON "notes" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_folder_idx" ON "notes" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "notes_deleted_at_idx" ON "notes" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "attachments_note_idx" ON "attachments" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_unique" ON "attachments" USING btree ("storage_key");
--> statement-breakpoint

-- Lo que drizzle-kit no sabe expresar, escrito a mano como en 0008_shares.sql.
--
-- Buscar dentro de una nota. Un btree sobre una columna de frases no contesta
-- "una nota que hable de algo", asi que hacen falta los dos: GIN para las
-- etiquetas, que son un array, y trigram para el texto, que es prosa.
--
-- pg_trgm se activa aqui y no al principio del fichero porque es la unica
-- extension que hace falta y las demas migraciones no la usan. CREATE EXTENSION
-- va en su propia sentencia porque dentro de un bloque no se puede.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX notes_tags_gin_idx ON notes USING gin (tags jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX notes_plain_text_trgm_idx ON notes USING gin (plain_text gin_trgm_ops);
--> statement-breakpoint

-- Un contador que alguien pueda volver a poner en negativo no es un contador.
-- Y un archivo de tamano cero o negativo tampoco es un archivo.

do $$ begin
  alter table notes
    add constraint notes_attachment_count_check
    check (attachment_count >= 0);
exception when duplicate_object then null; end $$;
--> statement-breakpoint
do $$ begin
  alter table attachments
    add constraint attachments_size_bytes_check
    check (size_bytes > 0);
exception when duplicate_object then null; end $$;
--> statement-breakpoint
