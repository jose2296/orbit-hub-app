CREATE TABLE "share_mounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"placed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"node_type" varchar(16) NOT NULL,
	"node_id" uuid NOT NULL,
	"grantee_user_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_mounts" ADD CONSTRAINT "share_mounts_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_mounts" ADD CONSTRAINT "share_mounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_mounts" ADD CONSTRAINT "share_mounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_mounts" ADD CONSTRAINT "share_mounts_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "share_mounts_share_user_unique" ON "share_mounts" USING btree ("share_id","user_id");--> statement-breakpoint
CREATE INDEX "share_mounts_user_idx" ON "share_mounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "share_mounts_workspace_idx" ON "share_mounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shares_node_grantee_unique" ON "shares" USING btree ("node_type","node_id","grantee_user_id");--> statement-breakpoint
CREATE INDEX "shares_grantee_idx" ON "shares" USING btree ("grantee_user_id");--> statement-breakpoint
CREATE INDEX "shares_node_idx" ON "shares" USING btree ("node_type","node_id");
--> statement-breakpoint

-- Lo que drizzle-kit no sabe expresar y que se ha escrito a mano.
--
-- Un CHECK por columna, no por codigo: una tabla con 'node_type' libre admite
-- 'carpeta' o 'lista_item' el dia que alguien se equivoca, y el error sale tres
-- capas mas abajo, en la sincronizacion, como una lista que no aparece.

do $$ begin
  alter table shares
    add constraint shares_node_type_check
    check (node_type in ('workspace', 'folder', 'list', 'list_item'));
exception when duplicate_object then null; end $$;
--> statement-breakpoint
do $$ begin
  alter table shares
    add constraint shares_role_check
    check (role in ('editor', 'viewer'));
exception when duplicate_object then null; end $$;
--> statement-breakpoint

-- Indice parcial, y no un filtro en el WHERE de la consulta: "quien tiene esto
-- ahora mismo" se pregunta en cada borrado, y sobre una tabla de concesiones eso
-- es una tabla pequena que va a crecer.
create index if not exists shares_live_node_idx
  on shares (node_type, node_id) where revoked_at is null;
--> statement-breakpoint
-- "Compartido conmigo" son las filas sin colocar, y se pregunta cada vez que se
-- abre. Con indice propio es una lectura de un indice; sin el, un recorrido por
-- todo lo que ha colocado esa persona.
create index if not exists share_mounts_unplaced_idx
  on share_mounts (user_id) where placed_at is null;
--> statement-breakpoint
