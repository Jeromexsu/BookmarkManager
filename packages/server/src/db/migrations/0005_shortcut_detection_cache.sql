CREATE TABLE IF NOT EXISTS "detect_shortcut_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"candidates" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "shortcut_checked" boolean DEFAULT false NOT NULL;