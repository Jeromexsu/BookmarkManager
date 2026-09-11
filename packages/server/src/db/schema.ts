import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";

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
