import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import {
  renameCategoryRequestSchema,
  deleteCategoryRequestSchema,
  createCategoryRequestSchema,
  setCategoryDescriptionRequestSchema,
} from "@bookmark-manager/shared";
import { db } from "../db/client.js";
import { bookmarks, categories } from "../db/schema.js";

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
}
