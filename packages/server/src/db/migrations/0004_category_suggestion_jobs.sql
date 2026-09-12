CREATE TABLE IF NOT EXISTS "category_suggestion_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"scope" text NOT NULL,
	"suggestions" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
