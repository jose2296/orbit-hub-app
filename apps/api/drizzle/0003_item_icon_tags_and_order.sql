ALTER TABLE "list_items" ADD COLUMN "icon" varchar(24);--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "order_mode" varchar(24) DEFAULT 'manual' NOT NULL;