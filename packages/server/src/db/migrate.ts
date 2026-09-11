import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db, sql } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // pgvector must exist before drizzle's generated migrations create a vector() column.
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await migrate(db, { migrationsFolder: join(__dirname, "migrations") });
  await sql.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
