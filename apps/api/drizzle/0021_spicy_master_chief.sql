ALTER TABLE "lists" ADD COLUMN "states" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "state_id" varchar(36);