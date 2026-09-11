import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, desc, inArray } from "drizzle-orm";
import {
  createBookmarkRequestSchema,
  previewBookmarkRequestSchema,
  updateBookmarkRequestSchema,
  confirmShortcutsRequestSchema,
  type Bookmark,
  type BookmarkConflict,
  type ShortcutCandidate,
} from "@bookmark-manager/shared";
import { db } from "../db/client.js";
import { bookmarks, tags, bookmarkTags, categories, projects } from "../db/schema.js";
import { generateTags } from "../ai/tagging.js";
import { classifyShortcut } from "../ai/classify.js";

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
    type: row.type as Bookmark["type"],
    tags: tagsByBookmark.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function linkTags(bookmarkId: number, tagNames: string[]) {
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

async function setTags(bookmarkId: number, tagNames: string[]) {
  await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, bookmarkId));
  await linkTags(bookmarkId, tagNames);
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

// A bare domain root (no path/query/fragment) is a strong "this is an entrance page, not a
// specific piece of content" signal on its own — used to pre-filter candidates before the
// (costlier) LLM content check in the detect-shortcuts route below.
function isRootUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
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

// Saving a URL that's already in the table must not create a second row for it — that just
// leaves the original (often still-pending) row stranded forever. Instead: fields the existing
// row doesn't have yet get filled in from the new save; a field both sides already disagree on
// is reported as a conflict for the caller to resolve (via PATCH) rather than silently picked.
async function handleExistingBookmark(
  existingRow: typeof bookmarks.$inferSelect,
  incoming: { content?: string; favicon?: string; category?: string; project?: string; tags?: string[]; summary?: string },
  reply: FastifyReply
) {
  const [existing] = await hydrateBookmarks([existingRow]);
  const patch: Partial<typeof bookmarks.$inferInsert> = {};
  const conflicts: BookmarkConflict[] = [];

  if (incoming.content && !existing.content) patch.content = incoming.content;
  if (incoming.favicon && !existing.favicon) patch.favicon = incoming.favicon;

  const incomingCategory = incoming.category?.trim() || undefined;
  if (incomingCategory !== undefined) {
    if (!existing.category) patch.categoryId = await resolveCategoryId(incomingCategory);
    else if (existing.category !== incomingCategory) {
      conflicts.push({ field: "category", existingValue: existing.category, newValue: incomingCategory });
    }
  }

  const incomingProject = incoming.project?.trim() || undefined;
  if (incomingProject !== undefined) {
    if (!existing.project) patch.projectId = await resolveProjectId(incomingProject);
    else if (existing.project !== incomingProject) {
      conflicts.push({ field: "project", existingValue: existing.project, newValue: incomingProject });
    }
  }

  const incomingSummary = incoming.summary?.trim() || undefined;
  if (incomingSummary !== undefined) {
    if (!existing.summary) patch.summary = incomingSummary;
    else if (existing.summary !== incomingSummary) {
      conflicts.push({ field: "summary", existingValue: existing.summary, newValue: incomingSummary });
    }
  }

  const incomingTags = incoming.tags && incoming.tags.length > 0 ? incoming.tags : undefined;
  let tagsToLink: string[] | undefined;
  if (incomingTags !== undefined) {
    if (existing.tags.length === 0) {
      tagsToLink = incomingTags;
    } else {
      const sameSet =
        existing.tags.length === incomingTags.length && existing.tags.every((t) => incomingTags.includes(t));
      if (!sameSet) conflicts.push({ field: "tags", existingValue: existing.tags, newValue: incomingTags });
    }
  }

  // Enough real data now exists to stop calling this "unresolved" — even if some other field
  // is still stuck in conflicts, since that's an independent, later decision.
  const finalTagCount = tagsToLink ? tagsToLink.length : existing.tags.length;
  const finalSummary = patch.summary ?? existing.summary;
  if (existing.status !== "tagged" && (finalTagCount > 0 || finalSummary)) {
    patch.status = "tagged";
  }

  let row = existingRow;
  if (Object.keys(patch).length > 0) {
    [row] = await db.update(bookmarks).set(patch).where(eq(bookmarks.id, existingRow.id)).returning();
  }
  if (tagsToLink) {
    await linkTags(row.id, tagsToLink);
  }

  if (conflicts.length > 0) {
    return reply.code(409).send({ error: "conflict" as const, bookmarkId: row.id, conflicts });
  }

  const [bookmark] = await hydrateBookmarks([row]);
  return reply.code(200).send(bookmark);
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

    const [existingRow] = await db.select().from(bookmarks).where(eq(bookmarks.url, url));
    if (existingRow) {
      return handleExistingBookmark(existingRow, { content, favicon, category, project, tags: confirmedTags, summary }, reply);
    }

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

  app.patch("/bookmarks/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateBookmarkRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { title, summary, category, project, type, tags: newTags } = parsed.data;
    const patch: Partial<typeof bookmarks.$inferInsert> = {};

    if (title !== undefined) patch.title = title;
    if (summary !== undefined) patch.summary = summary || null;
    if (category !== undefined) patch.categoryId = category ? await resolveCategoryId(category) : null;
    if (project !== undefined) patch.projectId = project ? await resolveProjectId(project) : null;
    if (type !== undefined) patch.type = type;

    // Manually adding tags/a summary — or resolving a pending item as a shortcut, which by
    // definition needs neither — means this is no longer "unresolved." Keep status in sync so
    // the UI doesn't keep showing a stale pending/failed badge over data the user has since
    // filled in (or a decision they've since made) by hand.
    if ((newTags !== undefined && newTags.length > 0) || (summary !== undefined && summary) || type === "shortcut") {
      patch.status = "tagged";
    }

    // Drizzle/Postgres reject an UPDATE with an empty SET clause — a patch that only touches
    // tags (handled separately below) would otherwise leave `patch` empty.
    const [row] =
      Object.keys(patch).length > 0
        ? await db.update(bookmarks).set(patch).where(eq(bookmarks.id, id)).returning()
        : await db.select().from(bookmarks).where(eq(bookmarks.id, id));
    if (!row) {
      return reply.code(404).send({ error: "Bookmark not found" });
    }

    if (newTags !== undefined) {
      await setTags(id, newTags);
    }

    const [bookmark] = await hydrateBookmarks([row]);
    return bookmark;
  });

  app.delete("/bookmarks/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const [row] = await db.delete(bookmarks).where(eq(bookmarks.id, id)).returning();
    if (!row) {
      return reply.code(404).send({ error: "Bookmark not found" });
    }
    return reply.code(204).send();
  });

  // Proposes shortcut candidates for review — never reclassifies anything outright. Cheap: no
  // network fetching (reuses already-scraped content), and the LLM call only runs for bookmarks
  // that already pass the bare-root-URL heuristic, not the whole table.
  app.post("/bookmarks/detect-shortcuts", async (request, reply) => {
    const rows = await db.select().from(bookmarks).where(eq(bookmarks.type, "reference"));
    const candidates: ShortcutCandidate[] = [];

    for (const row of rows) {
      if (!isRootUrl(row.url)) continue;

      if (!row.content) {
        candidates.push({
          id: row.id,
          url: row.url,
          title: row.title,
          favicon: row.favicon,
          reason: "Bare domain root URL (no content scraped)",
        });
        continue;
      }

      try {
        const result = await classifyShortcut(row.title, row.content);
        if (result.isShortcut) {
          candidates.push({ id: row.id, url: row.url, title: row.title, favicon: row.favicon, reason: result.reason });
        }
      } catch (err) {
        app.log.error(err, `Shortcut classification failed for bookmark ${row.id}`);
        candidates.push({
          id: row.id,
          url: row.url,
          title: row.title,
          favicon: row.favicon,
          reason: "Bare domain root URL (classification failed, heuristic only)",
        });
      }
    }

    return reply.send({ candidates } satisfies { candidates: ShortcutCandidate[] });
  });

  app.post("/bookmarks/confirm-shortcuts", async (request, reply) => {
    const parsed = confirmShortcutsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    // A confirmed shortcut is resolved, not "pending" — many arrive here specifically because
    // import couldn't scrape them, and without this they'd wrongly linger in a pending/review queue.
    await db
      .update(bookmarks)
      .set({ type: "shortcut", status: "tagged" })
      .where(inArray(bookmarks.id, parsed.data.ids));
    return { updated: parsed.data.ids.length };
  });
}
