ALTER TABLE "bookmarks" ADD COLUMN "invalid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_bookmarks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS bookmarks_set_updated_at ON "bookmarks";--> statement-breakpoint
CREATE TRIGGER bookmarks_set_updated_at
BEFORE UPDATE ON "bookmarks"
FOR EACH ROW
EXECUTE FUNCTION set_bookmarks_updated_at();