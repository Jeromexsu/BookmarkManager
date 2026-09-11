import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { tags } from "../db/schema.js";

export async function tagRoutes(app: FastifyInstance) {
  app.get("/tags", async () => {
    const rows = await db.select({ name: tags.name }).from(tags).orderBy(asc(tags.name));
    return { tags: rows.map((r) => r.name) };
  });
}
