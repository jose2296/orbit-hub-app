ALTER TABLE "bookmarks" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmarks_owner_idx" ON "bookmarks" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_owner_or_workspace" CHECK ("bookmarks"."workspace_id" is not null or "bookmarks"."owner_id" is not null);