import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { startImportRequestSchema, type ImportResultItem } from "@bookmark-manager/shared";
import { db } from "../db/client.js";
import { bookmarks, importJobs } from "../db/schema.js";
import { generateTags } from "../ai/tagging.js";
import { extractTextFromHtml } from "../extraction/html.js";
import { linkTags } from "./bookmarks.js";

const FETCH_TIMEOUT_MS = 8000;
const MIN_CONTENT_LENGTH = 200;
const CONCURRENCY = 4;

async function importOne(item: { url: string; title: string }): Promise<ImportResultItem> {
  let html: string;
  try {
    const res = await fetch(item.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BookmarkManagerBot/1.0)" },
    });
    if (!res.ok) {
      return { url: item.url, title: item.title, outcome: "invalid", reason: `HTTP ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    return {
      url: item.url,
      title: item.title,
      outcome: "invalid",
      reason: err instanceof Error ? err.message : "Unreachable",
    };
  }

  const content = extractTextFromHtml(html);

  if (content.length < MIN_CONTENT_LENGTH) {
    await db.insert(bookmarks).values({ url: item.url, title: item.title, status: "pending" });
    return { url: item.url, title: item.title, outcome: "pending", reason: "Couldn't extract page content" };
  }

  try {
    const tagged = await generateTags(content);
    const [row] = await db
      .insert(bookmarks)
      .values({ url: item.url, title: item.title, content, summary: tagged.summary, status: "tagged" })
      .returning();
    await linkTags(row.id, tagged.tags);
    return { url: item.url, title: item.title, outcome: "tagged", reason: null };
  } catch (err) {
    await db.insert(bookmarks).values({ url: item.url, title: item.title, content, status: "pending" });
    return {
      url: item.url,
      title: item.title,
      outcome: "pending",
      reason: err instanceof Error ? err.message : "Tagging failed",
    };
  }
}

async function runImportJob(jobId: number, items: { url: string; title: string }[]) {
  const existing = await db.select({ url: bookmarks.url }).from(bookmarks);
  const seenUrls = new Set(existing.map((r) => r.url));
  const results: ImportResultItem[] = [];
  let processed = 0;

  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()!;
      let result: ImportResultItem;
      if (seenUrls.has(item.url)) {
        result = { url: item.url, title: item.title, outcome: "duplicate", reason: null };
      } else {
        seenUrls.add(item.url);
        result = await importOne(item);
      }
      results.push(result);
      processed++;
      await db.update(importJobs).set({ processed, results }).where(eq(importJobs.id, jobId));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await db.update(importJobs).set({ status: "completed" }).where(eq(importJobs.id, jobId));
}

export async function importRoutes(app: FastifyInstance) {
  app.post("/import", async (request, reply) => {
    const parsed = startImportRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const items = parsed.data.bookmarks;
    const [job] = await db
      .insert(importJobs)
      .values({ status: "running", total: items.length, processed: 0, results: [] })
      .returning();

    runImportJob(job.id, items).catch((err) => {
      app.log.error(err, `Import job ${job.id} failed`);
    });

    return reply.code(201).send({ jobId: job.id });
  });

  app.get("/import/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, id));
    if (!job) {
      return reply.code(404).send({ error: "Import job not found" });
    }
    return {
      id: job.id,
      status: job.status,
      total: job.total,
      processed: job.processed,
      results: job.results,
    };
  });
}
