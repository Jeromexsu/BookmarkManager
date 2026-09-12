import type { FastifyInstance } from "fastify";
import { asc, eq, and, inArray } from "drizzle-orm";
import {
  renameCategoryRequestSchema,
  deleteCategoryRequestSchema,
  createCategoryRequestSchema,
  setCategoryDescriptionRequestSchema,
  type CategoryPlanJob,
} from "@bookmark-manager/shared";
import { db } from "../db/client.js";
import { bookmarks, categories, tags, bookmarkTags, categoryPlanJobs } from "../db/schema.js";
import { planCategoryList, type CategorySample } from "../ai/planCategories.js";

const UNCATEGORIZED = "Uncategorized";
const SAMPLE_TITLES_PER_CATEGORY = 15;
const TOP_TAGS_PER_CATEGORY = 8;

// Builds the per-category *samples* the model reasons over — full titles/tags for every
// resolved bookmark would make the prompt grow without bound as the corpus grows. Mirrors the
// "fetch everything, group in JS" approach runCategorySuggestionJob already uses, since the
// corpus is small enough (hundreds, not millions) that this stays cheap.
async function buildCategorySamples(): Promise<CategorySample[]> {
  const categoryRows = await db.select().from(categories).orderBy(asc(categories.name));

  const resolvedRows = await db
    .select({ id: bookmarks.id, title: bookmarks.title, categoryId: bookmarks.categoryId })
    .from(bookmarks)
    .where(and(inArray(bookmarks.type, ["reference", "shortcut"]), eq(bookmarks.status, "resolved"), eq(bookmarks.invalid, false)));

  const ids = resolvedRows.map((r) => r.id);
  const tagRows = ids.length
    ? await db
        .select({ bookmarkId: bookmarkTags.bookmarkId, name: tags.name })
        .from(bookmarkTags)
        .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
        .where(inArray(bookmarkTags.bookmarkId, ids))
    : [];
  const tagsByBookmark = new Map<number, string[]>();
  for (const { bookmarkId, name } of tagRows) {
    const list = tagsByBookmark.get(bookmarkId) ?? [];
    list.push(name);
    tagsByBookmark.set(bookmarkId, list);
  }

  type Group = { titles: string[]; tagCounts: Map<string, number> };
  const grouped = new Map<number | null, Group>();
  for (const row of resolvedRows) {
    const group: Group = grouped.get(row.categoryId) ?? { titles: [], tagCounts: new Map() };
    if (group.titles.length < SAMPLE_TITLES_PER_CATEGORY) group.titles.push(row.title);
    for (const tag of tagsByBookmark.get(row.id) ?? []) {
      group.tagCounts.set(tag, (group.tagCounts.get(tag) ?? 0) + 1);
    }
    grouped.set(row.categoryId, group);
  }

  function topTags(tagCounts: Map<string, number>): string[] {
    return [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_TAGS_PER_CATEGORY)
      .map(([tag]) => tag);
  }

  function countFor(categoryId: number | null): number {
    return resolvedRows.filter((r) => r.categoryId === categoryId).length;
  }

  const samples: CategorySample[] = categoryRows.map((c) => {
    const group: Group = grouped.get(c.id) ?? { titles: [], tagCounts: new Map() };
    return {
      name: c.name,
      description: c.description,
      count: countFor(c.id),
      sampleTitles: group.titles,
      topTags: topTags(group.tagCounts),
    };
  });

  const uncategorized = grouped.get(null);
  if (uncategorized) {
    samples.push({
      name: UNCATEGORIZED,
      description: null,
      count: countFor(null),
      sampleTitles: uncategorized.titles,
      topTags: topTags(uncategorized.tagCounts),
    });
  }

  return samples;
}

// Runs in the background after POST /categories/plan already responded with a jobId — same
// job-persistence reasoning as runCategorySuggestionJob in bookmarks.ts. Recommends changes to
// the taxonomy itself (add/rename/remove/describe); it never applies them — the caller reviews
// and applies via the existing create/rename/delete/describe endpoints, one call per accepted
// item.
async function runCategoryPlanJob(jobId: number) {
  try {
    const samples = await buildCategorySamples();

    if (samples.length === 0) {
      await db.update(categoryPlanJobs).set({ status: "completed", plan: { add: [], rename: [], remove: [], describe: [] } }).where(eq(categoryPlanJobs.id, jobId));
      return;
    }

    const plan = await planCategoryList(samples);
    await db.update(categoryPlanJobs).set({ status: "completed", plan }).where(eq(categoryPlanJobs.id, jobId));
  } catch (err) {
    await db
      .update(categoryPlanJobs)
      .set({ status: "failed", error: err instanceof Error ? err.message : "Unknown error" })
      .where(eq(categoryPlanJobs.id, jobId));
  }
}

export async function categoryRoutes(app: FastifyInstance) {
  app.get("/categories", async () => {
    const rows = await db.select({ name: categories.name }).from(categories).orderBy(asc(categories.name));
    return { names: rows.map((r) => r.name) };
  });

  // Full info (with descriptions) — for the category management UI and the classify step's
  // own context, distinct from the plain name list above that every "Move to"/datalist consumer
  // already relies on.
  app.get("/categories/full", async () => {
    const rows = await db
      .select({ name: categories.name, description: categories.description })
      .from(categories)
      .orderBy(asc(categories.name));
    return { categories: rows };
  });

  // Explicit create — mirrors POST /projects. A category more commonly comes into being by
  // being set on a bookmark, but manual creation (with a description up front) is still useful.
  // Idempotent on an existing name rather than a plain upsert: a bare "create" (no description)
  // on a category that already has one must not silently wipe it.
  app.post("/categories", async (request, reply) => {
    const parsed = createCategoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const [existing] = await db.select().from(categories).where(eq(categories.name, parsed.data.name));
    if (existing) {
      if (parsed.data.description === undefined) {
        return { name: existing.name, description: existing.description };
      }
      const [updated] = await db
        .update(categories)
        .set({ description: parsed.data.description || null })
        .where(eq(categories.id, existing.id))
        .returning();
      return { name: updated.name, description: updated.description };
    }

    const [row] = await db
      .insert(categories)
      .values({ name: parsed.data.name, description: parsed.data.description ?? null })
      .returning();
    return reply.code(201).send({ name: row.name, description: row.description });
  });

  app.patch("/categories/description", async (request, reply) => {
    const parsed = setCategoryDescriptionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const [row] = await db
      .update(categories)
      .set({ description: parsed.data.description || null })
      .where(eq(categories.name, parsed.data.name))
      .returning();
    if (!row) {
      return reply.code(404).send({ error: "Category not found" });
    }
    return { name: row.name, description: row.description };
  });

  app.patch("/categories", async (request, reply) => {
    const parsed = renameCategoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { from, to } = parsed.data;

    const [fromRow] = await db.select().from(categories).where(eq(categories.name, from));
    if (!fromRow) {
      return reply.code(404).send({ error: "Category not found" });
    }
    if (from === to) {
      return { name: to, merged: false };
    }

    const [toRow] = await db.select().from(categories).where(eq(categories.name, to));
    if (toRow) {
      // Renaming onto an existing category's name — merge every bookmark into it instead of
      // erroring, since that's the natural reading of "rename A to B" when B already exists.
      await db.update(bookmarks).set({ categoryId: toRow.id }).where(eq(bookmarks.categoryId, fromRow.id));
      await db.delete(categories).where(eq(categories.id, fromRow.id));
      return { name: to, merged: true };
    }

    await db.update(categories).set({ name: to }).where(eq(categories.id, fromRow.id));
    return { name: to, merged: false };
  });

  app.delete("/categories", async (request, reply) => {
    const parsed = deleteCategoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const [row] = await db.select().from(categories).where(eq(categories.name, parsed.data.name));
    if (!row) {
      return reply.code(404).send({ error: "Category not found" });
    }

    // Removing a category un-categorizes its bookmarks rather than deleting them — they fall
    // back into "Uncategorized", same as a bookmark that never had one.
    await db.update(bookmarks).set({ categoryId: null }).where(eq(bookmarks.categoryId, row.id));
    await db.delete(categories).where(eq(categories.id, row.id));
    return reply.code(204).send();
  });

  // Recommends a revised category list — as opposed to /bookmarks/suggest-categories, which
  // only assigns bookmarks into categories that already exist. Runs as a background job (the
  // model call can take a minute or two): responds immediately with a jobId, the caller polls
  // GET /categories/plan/:id for the result. Applying an accepted plan is left to the client —
  // it's just a sequence of calls to the create/rename/delete/description endpoints above.
  app.post("/categories/plan", async (_request, reply) => {
    const [job] = await db.insert(categoryPlanJobs).values({ status: "running" }).returning();

    runCategoryPlanJob(job.id).catch((err) => {
      app.log.error(err, `Category plan job ${job.id} failed`);
    });

    return reply.code(201).send({ jobId: job.id });
  });

  app.get("/categories/plan/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const [job] = await db.select().from(categoryPlanJobs).where(eq(categoryPlanJobs.id, id));
    if (!job) {
      return reply.code(404).send({ error: "Plan job not found" });
    }
    return {
      id: job.id,
      status: job.status as CategoryPlanJob["status"],
      plan: job.plan ?? null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
    } satisfies CategoryPlanJob;
  });
}
