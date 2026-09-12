import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  primaryKey,
  customType,
  jsonb,
} from "drizzle-orm/pg-core";
import type { ImportResultItem, CategorySuggestion, ShortcutCandidate } from "@bookmark-manager/shared";

// Dimension is a placeholder until an embedding provider is chosen (see ai/embeddings.ts).
// pgvector requires a fixed dimension per column, so this will need a migration once decided.
const EMBEDDING_DIMENSION = 1536;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSION})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map(Number);
  },
});

// A broad, user-only grouping (e.g. lifestyle/coding/travel). AI-assisted suggestions are a
// later "management" feature, not part of the extension's collection flow.
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

// A bundle of deep-coupled bookmarks, always user-specified — never AI-generated.
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const bookmarks = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  summary: text("summary"),
  favicon: text("favicon"),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  // "reference" (has real content worth reading/tagging) vs "shortcut" (a pure entrance/portal
  // page like a homepage — no content, just a launcher). See ai/classify.ts.
  type: text("type").notNull().default("reference"),
  // Set true only when detect-shortcuts confidently classified this as NOT a shortcut — an
  // unconfirmed shortcut candidate stays false so it keeps surfacing until the user actually
  // resolves it (confirms or the row changes). Lets re-running detection skip the (large,
  // growing) set of bookmarks it already has a confident answer for.
  shortcutChecked: boolean("shortcut_checked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const bookmarkTags = pgTable(
  "bookmark_tags",
  {
    bookmarkId: integer("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.bookmarkId, table.tagId] })]
);

export const bookmarkEmbeddings = pgTable("bookmark_embeddings", {
  bookmarkId: integer("bookmark_id")
    .primaryKey()
    .references(() => bookmarks.id, { onDelete: "cascade" }),
  embedding: vector("embedding").notNull(),
});

// Bulk browser-bookmark import: runs as a background job since it fetches + tags many URLs.
export const importJobs = pgTable("import_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"), // "running" | "completed"
  total: integer("total").notNull(),
  processed: integer("processed").notNull().default(0),
  results: jsonb("results").notNull().$type<ImportResultItem[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A single suggest-categories request against many bookmarks can take a minute or two against
// the model — persisted as a job (like importJobs above) so the result survives the caller
// closing the tab or switching away mid-request, not just living in one HTTP response.
export const categorySuggestionJobs = pgTable("category_suggestion_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"), // "running" | "completed" | "failed"
  scope: text("scope").notNull(), // "uncategorized" | "all"
  suggestions: jsonb("suggestions").$type<CategorySuggestion[]>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Same shape/reasoning as categorySuggestionJobs above — detect-shortcuts scans every
// not-yet-checked reference bookmark and classifies each root-URL candidate, which is the same
// class of "too slow for one HTTP response" problem.
export const detectShortcutJobs = pgTable("detect_shortcut_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"), // "running" | "completed" | "failed"
  candidates: jsonb("candidates").$type<ShortcutCandidate[]>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
