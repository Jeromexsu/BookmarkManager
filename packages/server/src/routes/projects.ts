import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { createProjectRequestSchema, renameProjectRequestSchema, deleteProjectRequestSchema } from "@bookmark-manager/shared";
import { db } from "../db/client.js";
import { bookmarks, projects } from "../db/schema.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => {
    const rows = await db.select({ name: projects.name }).from(projects).orderBy(asc(projects.name));
    return { names: rows.map((r) => r.name) };
  });

  // Unlike a category (which only ever comes into being by being set on a bookmark), a project
  // can be created empty and filled in afterward — this is that explicit creation.
  app.post("/projects", async (request, reply) => {
    const parsed = createProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const [row] = await db
      .insert(projects)
      .values({ name: parsed.data.name })
      .onConflictDoUpdate({ target: projects.name, set: { name: parsed.data.name } })
      .returning();
    return reply.code(201).send({ name: row.name });
  });

  app.patch("/projects", async (request, reply) => {
    const parsed = renameProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { from, to } = parsed.data;

    const [fromRow] = await db.select().from(projects).where(eq(projects.name, from));
    if (!fromRow) {
      return reply.code(404).send({ error: "Project not found" });
    }
    if (from === to) {
      return { name: to, merged: false };
    }

    const [toRow] = await db.select().from(projects).where(eq(projects.name, to));
    if (toRow) {
      // Renaming onto an existing project's name — merge every bookmark into it instead of
      // erroring, same convention as categories.
      await db.update(bookmarks).set({ projectId: toRow.id }).where(eq(bookmarks.projectId, fromRow.id));
      await db.delete(projects).where(eq(projects.id, fromRow.id));
      return { name: to, merged: true };
    }

    await db.update(projects).set({ name: to }).where(eq(projects.id, fromRow.id));
    return { name: to, merged: false };
  });

  app.delete("/projects", async (request, reply) => {
    const parsed = deleteProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const [row] = await db.select().from(projects).where(eq(projects.name, parsed.data.name));
    if (!row) {
      return reply.code(404).send({ error: "Project not found" });
    }

    // Soft delete: only the link between bookmarks and this project goes away. The bookmarks
    // themselves are untouched — this removes a container, not what was in it.
    await db.update(bookmarks).set({ projectId: null }).where(eq(bookmarks.projectId, row.id));
    await db.delete(projects).where(eq(projects.id, row.id));
    return reply.code(204).send();
  });
}
