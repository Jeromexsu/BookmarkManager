CREATE TABLE IF NOT EXISTS "bookmark_embeddings" (
	"bookmark_id" integer PRIMARY KEY NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookmark_tags" (
	"bookmark_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "bookmark_tags_bookmark_id_tag_id_pk" PRIMARY KEY("bookmark_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"summary" text,
	"category" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookmark_embeddings" ADD CONSTRAINT "bookmark_embeddings_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookmark_tags" ADD CONSTRAINT "bookmark_tags_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookmark_tags" ADD CONSTRAINT "bookmark_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
