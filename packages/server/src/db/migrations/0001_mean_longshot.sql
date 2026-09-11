CREATE TABLE IF NOT EXISTS "import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
