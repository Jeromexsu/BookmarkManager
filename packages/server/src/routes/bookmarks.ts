import type { FastifyInstance } from "fastify";
import { eq, desc, inArray } from "drizzle-orm";
import {
  createBookmarkRequestSchema,
  previewBookmarkRequestSchema,
  type Bookmark,
} from "@bookmark-manager/shared";
import { db } from "../db/client.js";
import { bookmarks, tags, bookmarkTags, categories, projects } from "../db/schema.js";
import { generateTags } from "../ai/tagging.js";

async function hydrateBookmarks(rows: (typeof bookmarks.$inferSelect)[]): Promise<Bookmark[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const tagRows = await db
    .select({ bookmarkId: bookmarkTags.bookmarkId, name: tags.name })
    .from(bookmarkTags)
    .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
    .where(inArray(bookmarkTags.bookmarkId, ids));

  const tagsByBookmark = new Map<number, string[]>();
  for (const { bookmarkId, name } of tagRows) {
    const list = tagsByBookmark.get(bookmarkId) ?? [];
    list.push(name);
    tagsByBookmark.set(bookmarkId, list);
  }

  const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter((id): id is number => id !== null))];
  const categoryRows = categoryIds.length
    ? await db.select().from(categories).where(inArray(categories.id, categoryIds))
    : [];
  const categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]));

  const projectIds = [...new Set(rows.map((r) => r.projectId).filter((id): id is number => id !== null))];
  const projectRows = projectIds.length
    ? await db.select().from(projects).where(inArray(projects.id, projectIds))
    : [];
  const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]));

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    content: row.content,
    summary: row.summary,
    favicon: row.favicon,
    category: row.categoryId !== null ? (categoryNameById.get(row.categoryId) ?? null) : null,
    project: row.projectId !== null ? (projectNameById.get(row.projectId) ?? null) : null,
    status: row.status as Bookmark["status"],
    tags: tagsByBookmark.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
  }));
}

async function linkTags(bookmarkId: number, tagNames: string[]) {
  if (tagNames.length === 0) return;

  const tagIds: number[] = [];
  for (const name of tagNames) {
    const [tag] = await db
      .insert(tags)
      .values({ name })
      .onConflictDoUpdate({ target: tags.name, set: { name } })
      .returning();
    tagIds.push(tag.id);
  }

  await db
    .insert(bookmarkTags)
    .values(tagIds.map((tagId) => ({ bookmarkId, tagId })))
    .onConflictDoNothing();
}

async function resolveCategoryId(name: string): Promise<number> {
  const [row] = await db
    .insert(categories)
    .values({ name })
    .onConflictDoUpdate({ target: categories.name, set: { name } })
    .returning();
  return row.id;
}

async function resolveProjectId(name: string): Promise<number> {
  const [row] = await db
    .insert(projects)
    .values({ name })
    .onConflictDoUpdate({ target: projects.name, set: { name } })
    .returning();
  return row.id;
}

async function tagBookmarkAsync(bookmarkId: number, content: string) {
  try {
    const result = await generateTags(content);
    await linkTags(bookmarkId, result.tags);
    await db
      .update(bookmarks)
      .set({ summary: result.summary, status: "tagged" })
      .where(eq(bookmarks.id, bookmarkId));
  } catch (err) {
    await db.update(bookmarks).set({ status: "failed" }).where(eq(bookmarks.id, bookmarkId));
    throw err;
  }
}

export async function bookmarkRoutes(app: FastifyInstance) {
  app.get("/bookmarks", async () => {
    const rows = await db.select().from(bookmarks).orderBy(desc(bookmarks.createdAt));
    return { bookmarks: await hydrateBookmarks(rows) };
  });

  // Stateless: generates tags/summary for the caller to show a user for review, without
  // saving anything. Used by the extension's collect-then-confirm flow. Category/project are
  // never AI-generated, so they're not part of this response — the user sets them directly.
  app.post("/bookmarks/preview", async (request, reply) => {
    const parsed = previewBookmarkRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      return await generateTags(parsed.data.content);
    } catch (err) {
      app.log.error(err, "Preview tagging failed");
      return reply.code(502).send({ error: "Failed to generate tags" });
    }
  });

  app.post("/bookmarks", async (request, reply) => {
    const parsed = createBookmarkRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { url, title, content, favicon, category, project, tags: confirmedTags, summary } = parsed.data;

    const categoryId = category ? await resolveCategoryId(category) : null;
    const projectId = project ? await resolveProjectId(project) : null;

    if (confirmedTags !== undefined) {
      // Caller already ran /bookmarks/preview and got user confirmation — save as final.
      const [row] = await db
        .insert(bookmarks)
        .values({
          url,
          title,
          content: content ?? null,
          favicon: favicon ?? null,
          summary: summary || null,
          categoryId,
          projectId,
          status: "tagged",
        })
        .returning();

      await linkTags(row.id, confirmedTags);

      const [bookmark] = await hydrateBookmarks([row]);
      return reply.code(201).send(bookmark);
    }

    const [row] = await db
      .insert(bookmarks)
      .values({
        url,
        title,
        content: content ?? null,
        favicon: favicon ?? null,
        categoryId,
        projectId,
        status: "pending",
      })
      .returning();

    if (content) {
      // Fire-and-forget: the save responds immediately, tags fill in shortly after.
      tagBookmarkAsync(row.id, content).catch((err) => {
        app.log.error(err, `Tagging failed for bookmark ${row.id}`);
      });
    }

    const [bookmark] = await hydrateBookmarks([row]);
    return reply.code(201).send(bookmark);
  });
}
