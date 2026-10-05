CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"collection_id" uuid,
	"url" text NOT NULL,
	"title" varchar(300) DEFAULT '' NOT NULL,
	"site_name" varchar(120),
	"description" text,
	"image_url" text,
	"document" text DEFAULT '' NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"extraction_state" varchar(16) DEFAULT 'pending' NOT NULL,
	"extraction_error" varchar(200),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmarks_workspace_updated_at_idx" ON "bookmarks" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "bookmarks_folder_idx" ON "bookmarks" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "bookmarks_collection_idx" ON "bookmarks" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "bookmarks_deleted_at_idx" ON "bookmarks" USING btree ("deleted_at");--> statement-breakpoint

-- Lo que drizzle-kit no sabe expresar, escrito a mano como en 0012_notes_and_attachments.sql.
--
-- Buscar dentro de un articulo guardado. Un btree sobre una columna de frases no
-- contesta "un bookmark que hable de algo", asi que hacen falta los dos: GIN para
-- las etiquetas, que son un array, y trigram para el texto, que es prosa.
--
-- pg_trgm ya se activo en 0012 con CREATE EXTENSION IF NOT EXISTS, asi que aqui
-- no se repite.

CREATE INDEX bookmarks_tags_gin_idx ON bookmarks USING gin (tags jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX bookmarks_plain_text_trgm_idx ON bookmarks USING gin (plain_text gin_trgm_ops);