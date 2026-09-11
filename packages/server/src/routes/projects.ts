import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects } from "../db/schema.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => {
    const rows = await db.select({ name: projects.name }).from(projects).orderBy(asc(projects.name));
    return { names: rows.map((r) => r.name) };
  });
}
