import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, desc, inArray, isNull, and } from "drizzle-orm";
import {
  createBookmarkRequestSchema,
  previewBookmarkRequestSchema,
  updateBookmarkRequestSchema,
  confirmShortcutsRequestSchema,
  suggestCategoriesRequestSchema,
  applyCategoriesRequestSchema,
  suggestTitleRequestSchema,
  type Bookmark,
  type BookmarkConflict,
  type ShortcutCandidate,
  type CategorySuggestion,
  type CategorySuggestionJob,
  type SuggestCategoriesScope,
  type DetectShortcutsJob,
} from "@bookmark-manager/shared";
import { db } from "../db/client.js";
import {
  bookmarks,
  tags,
  bookmarkTags,
  categories,
  projects,
  categorySuggestionJobs,
  detectShortcutJobs,
} from "../db/schema.js";
import { generateTags } from "../ai/tagging.js";
import { classifyShortcut } from "../ai/classify.js";
import { suggestTitle } from "../ai/title.js";
import { pickCategoryTaxonomy, classifyChunk } from "../ai/categorize.js";

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
      .set({ summary: result.summary, status: "resolved" })
      .where(eq(bookmarks.id, bookmarkId));
  } catch (err) {
    await db.update(bookmarks).set({ status: "failed" }).where(eq(bookmarks.id, bookmarkId));
    throw err;
  }
}

const CATEGORY_SUGGESTION_CHUNK_SIZE = 60;
const CATEGORY_SUGGESTION_CONCURRENCY = 4;

// Runs in the background after the POST /bookmarks/suggest-categories request already
// responded with a jobId — the model call can take a minute or two, and writing the result to
// this row (rather than only ever returning it in one HTTP response) is what lets the caller
// leave the page and come back to find it.
//
// Two passes, not one call for the whole set: first decide the taxonomy (small output — just
// category names), then classify chunks of bookmarks against that fixed list concurrently (each
// chunk's output is only its own ids, not everyone's). Keeps any one call's output small and
// bounds a slow/failed chunk's damage to just that chunk instead of the whole run.
async function runCategorySuggestionJob(jobId: number, scope: SuggestCategoriesScope) {
  try {
    const baseCondition = and(eq(bookmarks.type, "reference"), eq(bookmarks.status, "resolved"));
    const condition = scope === "all" ? baseCondition : and(baseCondition, isNull(bookmarks.categoryId));
    const rows = await db.select().from(bookmarks).where(condition);

    if (rows.length === 0) {
      await db
        .update(categorySuggestionJobs)
        .set({ status: "completed", suggestions: [] })
        .where(eq(categorySuggestionJobs.id, jobId));
      return;
    }

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

    const existingCategories = (await db.select().from(categories)).map((c) => c.name);
    const items = rows.map((r) => ({ id: r.id, title: r.title, tags: tagsByBookmark.get(r.id) ?? [] }));

    const categoryNames = await pickCategoryTaxonomy(items, existingCategories);

    const chunks: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += CATEGORY_SUGGESTION_CHUNK_SIZE) {
      chunks.push(items.slice(i, i + CATEGORY_SUGGESTION_CHUNK_SIZE));
    }

    const merged = new Map<string, number[]>();
    let succeededChunks = 0;

    const queue = [...chunks];
    async function worker() {
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        try {
          const result = await classifyChunk(chunk, categoryNames);
          succeededChunks++;
          for (const [category, bookmarkIds] of result) {
            const list = merged.get(category) ?? [];
            list.push(...bookmarkIds);
            merged.set(category, list);
          }
        } catch {
          // One chunk timing out or erroring shouldn't lose the whole run — its bookmarks just
          // stay unsuggested this time, same as if the job had never run for them.
        }
      }
    }
    await Promise.all(Array.from({ length: CATEGORY_SUGGESTION_CONCURRENCY }, worker));

    if (succeededChunks === 0) {
      throw new Error("Every classification chunk failed");
    }

    const suggestions: CategorySuggestion[] = [...merged.entries()]
      .filter(([, bookmarkIds]) => bookmarkIds.length > 0)
      .map(([category, bookmarkIds]) => ({ category, bookmarkIds }));

    await db
      .update(categorySuggestionJobs)
      .set({ status: "completed", suggestions })
      .where(eq(categorySuggestionJobs.id, jobId));
  } catch (err) {
    await db
      .update(categorySuggestionJobs)
      .set({ status: "failed", error: err instanceof Error ? err.message : "Unknown error" })
      .where(eq(categorySuggestionJobs.id, jobId));
  }
}

const DETECT_SHORTCUTS_CONCURRENCY = 4;

// Same job-persistence reasoning as runCategorySuggestionJob above. Only scans bookmarks that
// haven't been confidently ruled out before (shortcutChecked = false) — the set that's actually
// expensive to (re-)classify shrinks over time instead of re-doing the same work every run.
async function runDetectShortcutsJob(jobId: number) {
  try {
    const rows = await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.type, "reference"), eq(bookmarks.shortcutChecked, false)));

    const candidates: ShortcutCandidate[] = [];
    const queue = rows.filter((row) => isRootUrl(row.url));

    async function worker() {
      while (queue.length > 0) {
        const row = queue.shift()!;

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
          } else {
            // A confident "no" — cache it so future runs don't pay for this bookmark again.
            // An unconfirmed "yes" stays uncached: it keeps surfacing as a candidate until the
            // user actually resolves it (confirms it, or the row changes some other way).
            await db.update(bookmarks).set({ shortcutChecked: true }).where(eq(bookmarks.id, row.id));
          }
        } catch {
          candidates.push({
            id: row.id,
            url: row.url,
            title: row.title,
            favicon: row.favicon,
            reason: "Bare domain root URL (classification failed, heuristic only)",
          });
        }
      }
    }
    await Promise.all(Array.from({ length: DETECT_SHORTCUTS_CONCURRENCY }, worker));

    await db.update(detectShortcutJobs).set({ status: "completed", candidates }).where(eq(detectShortcutJobs.id, jobId));
  } catch (err) {
    await db
      .update(detectShortcutJobs)
      .set({ status: "failed", error: err instanceof Error ? err.message : "Unknown error" })
      .where(eq(detectShortcutJobs.id, jobId));
  }
}

interface IncomingBookmarkSave {
  title: string;
  content?: string;
  favicon?: string;
  category?: string;
  project?: string;
  tags?: string[];
  summary?: string;
}

// Saving a URL that's already in the table must not create a second row for it — that just
// leaves the original (often still-pending) row stranded forever. What "already exists" means
// splits into two very different cases:
//  - The existing row isn't resolved yet (pending/failed) — nothing on it is trustworthy or
//    finished, so this save IS the resolution: whatever fields it provides simply take over,
//    and reaching this row at all resolves it, whether or not tags/a summary came along.
//  - The existing row is already resolved — that's someone's finished, deliberate data, so a
//    field both sides disagree on is a real conflict, reported for the caller to resolve via
//    PATCH rather than silently overwritten. Fields the existing row doesn't have yet still
//    fill in automatically either way.
async function handleExistingBookmark(existingRow: typeof bookmarks.$inferSelect, incoming: IncomingBookmarkSave, reply: FastifyReply) {
  const [existing] = await hydrateBookmarks([existingRow]);

  if (existing.status !== "resolved") {
    return resolveBookmarkSave(existingRow, existing, incoming, reply);
  }
  return mergeBookmarkSave(existingRow, existing, incoming, reply);
}

async function resolveBookmarkSave(
  existingRow: typeof bookmarks.$inferSelect,
  existing: Bookmark,
  incoming: IncomingBookmarkSave,
  reply: FastifyReply
) {
  const patch: Partial<typeof bookmarks.$inferInsert> = { status: "resolved" };

  if (incoming.title && incoming.title !== existing.title) patch.title = incoming.title;
  if (incoming.content) patch.content = incoming.content;
  if (incoming.favicon) patch.favicon = incoming.favicon;

  const category = incoming.category?.trim();
  if (category) patch.categoryId = await resolveCategoryId(category);

  const project = incoming.project?.trim();
  if (project) patch.projectId = await resolveProjectId(project);

  const summary = incoming.summary?.trim();
  if (summary) patch.summary = summary;

  const tags = incoming.tags && incoming.tags.length > 0 ? incoming.tags : undefined;

  const [row] = await db.update(bookmarks).set(patch).where(eq(bookmarks.id, existingRow.id)).returning();
  if (tags) {
    // Matches PATCH's convention: presence of tags means "replace the full set," not merge.
    await setTags(row.id, tags);
  }

  const [bookmark] = await hydrateBookmarks([row]);
  return reply.code(200).send(bookmark);
}

async function mergeBookmarkSave(
  existingRow: typeof bookmarks.$inferSelect,
  existing: Bookmark,
  incoming: IncomingBookmarkSave,
  reply: FastifyReply
) {
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

  // Also stateless — the caller already has the content on the Bookmark it loaded, no DB
  // lookup needed. Never saved automatically; the client decides whether to use it.
  app.post("/bookmarks/suggest-title", async (request, reply) => {
    const parsed = suggestTitleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const title = await suggestTitle(parsed.data.title, parsed.data.content);
      return { title };
    } catch (err) {
      app.log.error(err, "Title suggestion failed");
      return reply.code(502).send({ error: "Failed to suggest a title" });
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
      return handleExistingBookmark(existingRow, { title, content, favicon, category, project, tags: confirmedTags, summary }, reply);
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
          status: "resolved",
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

    const { title, summary, category, project, type, tags: newTags, resolved } = parsed.data;
    const patch: Partial<typeof bookmarks.$inferInsert> = {};

    if (title !== undefined) patch.title = title;
    if (summary !== undefined) patch.summary = summary || null;
    if (category !== undefined) patch.categoryId = category ? await resolveCategoryId(category) : null;
    if (project !== undefined) patch.projectId = project ? await resolveProjectId(project) : null;
    if (type !== undefined) patch.type = type;

    // Tags/a summary/marking as a shortcut are convenience triggers for "resolved" — none of
    // them define it. `resolved: true` is the actual, explicit way to resolve a bookmark that
    // needs none of those (the user just decided it's done as-is).
    if (
      resolved === true ||
      (newTags !== undefined && newTags.length > 0) ||
      (summary !== undefined && summary) ||
      type === "shortcut"
    ) {
      patch.status = "resolved";
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

  // Proposes shortcut candidates for review — never reclassifies anything outright. Runs as a
  // background job (like /suggest-categories above): responds immediately with a jobId, the
  // caller polls GET /bookmarks/detect-shortcuts/:id for status/result.
  app.post("/bookmarks/detect-shortcuts", async (request, reply) => {
    const [job] = await db.insert(detectShortcutJobs).values({ status: "running" }).returning();

    runDetectShortcutsJob(job.id).catch((err) => {
      app.log.error(err, `Detect-shortcuts job ${job.id} failed`);
    });

    return reply.code(201).send({ jobId: job.id });
  });

  app.get("/bookmarks/detect-shortcuts/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const [job] = await db.select().from(detectShortcutJobs).where(eq(detectShortcutJobs.id, id));
    if (!job) {
      return reply.code(404).send({ error: "Detect-shortcuts job not found" });
    }
    return {
      id: job.id,
      status: job.status as DetectShortcutsJob["status"],
      candidates: job.candidates ?? null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
    } satisfies DetectShortcutsJob;
  });

  // Resets the "confidently not a shortcut" cache so the next detect-shortcuts run reconsiders
  // everything again — for after a prompt/classifier change, or just distrust in a past result.
  app.post("/bookmarks/clear-shortcut-cache", async (request, reply) => {
    const result = await db
      .update(bookmarks)
      .set({ shortcutChecked: false })
      .where(eq(bookmarks.shortcutChecked, true))
      .returning({ id: bookmarks.id });
    return { cleared: result.length };
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
      .set({ type: "shortcut", status: "resolved" })
      .where(inArray(bookmarks.id, parsed.data.ids));
    return { updated: parsed.data.ids.length };
  });

  // Suggest-then-apply, same convention as detect/confirm-shortcuts above — never assigns a
  // category outright. Scope defaults to just-uncategorized (matching the web app's
  // "Uncategorized" bucket); "all" re-buckets every resolved reference, a deliberate
  // reorganization the caller opts into rather than something that happens by default.
  //
  // Runs as a background job (like /import above), not a single blocking response — the model
  // call can take a minute or two, and this responds immediately with a jobId so the caller can
  // navigate away and poll GET /bookmarks/suggest-categories/:id for the result later.
  app.post("/bookmarks/suggest-categories", async (request, reply) => {
    const parsed = suggestCategoriesRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const [job] = await db
      .insert(categorySuggestionJobs)
      .values({ status: "running", scope: parsed.data.scope })
      .returning();

    runCategorySuggestionJob(job.id, parsed.data.scope).catch((err) => {
      app.log.error(err, `Category suggestion job ${job.id} failed`);
    });

    return reply.code(201).send({ jobId: job.id });
  });

  app.get("/bookmarks/suggest-categories/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const [job] = await db.select().from(categorySuggestionJobs).where(eq(categorySuggestionJobs.id, id));
    if (!job) {
      return reply.code(404).send({ error: "Suggestion job not found" });
    }
    return {
      id: job.id,
      status: job.status as CategorySuggestionJob["status"],
      scope: job.scope as CategorySuggestionJob["scope"],
      suggestions: job.suggestions ?? null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
    } satisfies CategorySuggestionJob;
  });

  app.post("/bookmarks/apply-categories", async (request, reply) => {
    const parsed = applyCategoriesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const idsByCategory = new Map<string, number[]>();
    for (const { id, category } of parsed.data.assignments) {
      const list = idsByCategory.get(category) ?? [];
      list.push(id);
      idsByCategory.set(category, list);
    }

    for (const [categoryName, categoryIds] of idsByCategory) {
      const categoryId = await resolveCategoryId(categoryName);
      await db.update(bookmarks).set({ categoryId }).where(inArray(bookmarks.id, categoryIds));
    }

    return { updated: parsed.data.assignments.length };
  });
}
