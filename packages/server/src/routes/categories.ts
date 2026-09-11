import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { categories } from "../db/schema.js";

export async function categoryRoutes(app: FastifyInstance) {
  app.get("/categories", async () => {
    const rows = await db.select({ name: categories.name }).from(categories).orderBy(asc(categories.name));
    return { names: rows.map((r) => r.name) };
  });
}
