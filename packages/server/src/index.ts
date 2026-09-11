import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { healthRoutes } from "./routes/health.js";
import { bookmarkRoutes } from "./routes/bookmarks.js";
import { tagRoutes } from "./routes/tags.js";
import { categoryRoutes } from "./routes/categories.js";
import { projectRoutes } from "./routes/projects.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, "../../web/dist");

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(healthRoutes, { prefix: "/api" });
await app.register(bookmarkRoutes, { prefix: "/api" });
await app.register(tagRoutes, { prefix: "/api" });
await app.register(categoryRoutes, { prefix: "/api" });
await app.register(projectRoutes, { prefix: "/api" });

// In production the web app is built and copied alongside the server (see Dockerfile);
// serve it as a static SPA. In dev, run `npm run dev -w @bookmark-manager/web` separately.
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
