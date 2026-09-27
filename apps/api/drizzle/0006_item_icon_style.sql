ALTER TABLE "list_items" ALTER COLUMN "icon" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "icon_style" varchar(8) DEFAULT 'outline' NOT NULL;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "icon_color" varchar(16) DEFAULT 'neutral' NOT NULL;