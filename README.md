# Bookmark Manager

A browser-independent, AI-powered bookmark manager. The core lives in a self-hosted
server + web app, not in any browser's native bookmark store — browser extensions are
thin, dumb senders that hand the current page to your server. Point Firefox, Chrome, or
anything else at the same server and you get the same bookmarks, the same tags, the
same search.

## Why

Native browser bookmarks are dumb (a URL and a title), siloed to one browser, and
un-searchable beyond exact string match. This project fixes that by:

1. Making the bookmark store independent of any single browser.
2. Using an LLM to actually understand what you saved — tags, category, and a summary
   are generated automatically instead of you filing things into folders by hand.
3. Eventually letting you search bookmarks by *meaning* ("that article about rust
   async") rather than by exact keyword.

## Architecture

```
 ┌────────────┐   save page    ┌─────────────┐   tag via DeepSeek   ┌────────────┐
 │  Extension │ ─────────────► │   Server    │ ───────────────────► │  Postgres  │
 │ (Firefox,  │   POST /api/   │  (Fastify)  │                       │ +pgvector  │
 │  Chrome…)  │   bookmarks    │             │ ◄──────────────────  │            │
 └────────────┘                └──────┬──────┘   read/write          └────────────┘
                                       │
                                       │ serves API + static build
                                       ▼
                                 ┌────────────┐
                                 │  Web app   │  (React) — browse, search, manage
                                 └────────────┘
```

- **Extensions are intentionally dumb.** All they do is grab the active tab's URL,
  title, and rendered text (so login-gated pages and SPAs still capture correctly) and
  POST it to your server. No tagging logic, no storage, nothing browser-specific beyond
  that capture step.
- **The server is the only source of truth.** It stores bookmarks, calls the LLM for
  tagging, and serves both the JSON API and the built web app as static files — one
  deployable unit.
- **Everything is dockerized from day one**, so the exact stack you run locally
  (`docker compose up`) is what you deploy to a VPS.

## AI Roadmap

Built in this order, each step layering on the last:

1. ✅ **Auto-tagging & categorization** (in progress) — when a bookmark is saved with
   page content, DeepSeek returns `{ tags, category, summary }`, stored against the
   bookmark. See [`ai/tagging.ts`](packages/server/src/ai/tagging.ts).
2. ⏳ **Semantic search** — search bookmarks by meaning via embeddings + pgvector.
   Deliberately **not implemented yet**: which embedding model to use (local, e.g.
   transformers.js, vs. a hosted API) is still an open decision. The schema already has
   a `bookmark_embeddings` table with a `vector` column, and
   [`ai/embeddings.ts`](packages/server/src/ai/embeddings.ts) defines the
   `EmbeddingProvider` interface so wiring in a real provider later is a one-file
   change — nothing else needs to move.
3. ⏳ **Duplicate / stale detection** — once embeddings exist, use them (plus dead-link
   checks) to surface duplicate or low-value bookmarks for cleanup.

## Project Structure

npm workspaces monorepo:

```
BookmarkManager/
├── docker-compose.yml       # db + app — same file for local dev and VPS deploy
├── docker-compose.dev.yml   # dev override: bind-mounts source, hot-reloads the server
├── .env.example             # docker-compose env (Postgres creds, DEEPSEEK_API_KEY, PORT)
├── package.json             # workspaces root
├── tsconfig.base.json       # shared TS compiler options
└── packages/
    ├── shared/    # types/contracts used by server, web, and extension
    ├── server/    # Fastify API + Postgres/Drizzle + DeepSeek client
    ├── web/       # React + Vite standalone UI
    └── extension/ # WebExtension (Manifest V3), Firefox-first
```

### `packages/shared`

Single source of truth for API shapes, as Zod schemas (validated at runtime, not just
typed at compile time):

- [`src/types.ts`](packages/shared/src/types.ts) — `Bookmark`, `CreateBookmarkRequest`,
  `ListBookmarksResponse`. The server validates incoming requests against these; the web
  app validates responses against the same schemas, so a drift between what the server
  sends and what the client expects fails loudly instead of silently.

### `packages/server`

Fastify API, all routes under `/api`:

- [`src/index.ts`](packages/server/src/index.ts) — app entrypoint. Registers routes,
  and if `packages/web/dist` exists (i.e. in production/Docker), serves the built web
  app as static files with an SPA fallback — one container serves both API and UI.
- [`src/db/schema.ts`](packages/server/src/db/schema.ts) — Drizzle schema:
  - `bookmarks` — url, title, extracted content, summary, category, status
    (`pending` → `tagged`/`failed`)
  - `tags` / `bookmark_tags` — normalized tags with a join table
  - `bookmark_embeddings` — `bookmark_id` → `vector(1536)` (placeholder dimension until
    an embedding provider is picked; will need a migration to resize once it is)
- [`src/db/client.ts`](packages/server/src/db/client.ts) /
  [`migrate.ts`](packages/server/src/db/migrate.ts) — Postgres connection + a migration
  runner that also ensures the `vector` extension exists before any generated migration
  needs it.
- [`src/routes/bookmarks.ts`](packages/server/src/routes/bookmarks.ts) — `POST
  /api/bookmarks` inserts immediately (feels instant to the caller) then kicks off
  tagging asynchronously; `GET /api/bookmarks` lists everything with tags attached.
- [`src/routes/tags.ts`](packages/server/src/routes/tags.ts) — `GET /api/tags`.
- [`src/ai/tagging.ts`](packages/server/src/ai/tagging.ts) — DeepSeek client
  (OpenAI-compatible SDK pointed at `api.deepseek.com`), asks for structured JSON tags/
  category/summary from page content.
- [`src/ai/embeddings.ts`](packages/server/src/ai/embeddings.ts) — the not-yet-wired
  `EmbeddingProvider` interface described in the roadmap above.
- [`Dockerfile`](packages/server/Dockerfile) — multi-stage build; context is the repo
  root because it needs to build `shared` and `web` too, not just `server`.

### `packages/web`

React + Vite UI. Currently a single view
([`src/App.tsx`](packages/web/src/App.tsx)): a form to add a bookmark and a list that
polls every few seconds so tags show up shortly after saving.
[`src/api.ts`](packages/web/src/api.ts) wraps `fetch` calls, validating responses
through `@bookmark-manager/shared`'s schemas.

### `packages/extension`

WebExtension, Manifest V3, built for **Firefox first** (using
`browser_specific_settings.gecko.id`), written against `webextension-polyfill` so the
same source runs in Chrome/Edge with just a second manifest/build target later — no
browser-specific logic to duplicate.

- [`src/content.ts`](packages/extension/src/content.ts) — not a declared content
  script; a plain function injected on demand (via `browser.scripting.executeScript`)
  only when the user clicks "Save," so nothing runs on every page load.
- [`src/background.ts`](packages/extension/src/background.ts) — reads the configured
  server URL from `browser.storage.sync`, injects the extractor into the active tab,
  POSTs the result to `/api/bookmarks`.
- [`src/popup/popup.ts`](packages/extension/src/popup/popup.ts) — the "Save this page"
  button UI.
- [`src/options.ts`](packages/extension/src/options.ts) — lets the user point the
  extension at their own self-hosted server.
- [`scripts/build.mjs`](packages/extension/scripts/build.mjs) — esbuild bundles the
  three entrypoints and copies `public/` (manifest, HTML, icons) into `dist/`.

## Running It

**Environment note**: this repo currently needs a working local Node.js install (for
non-Docker dev workflows and `npm install`) plus Docker installed for Postgres.

```bash
# 1. Install dependencies (root, workspaces)
npm install

# 2. Configure environment
cp .env.example .env                              # docker-compose (Postgres creds, DEEPSEEK_API_KEY)
cp packages/server/.env.example packages/server/.env   # for running the server outside Docker

# 3. Bring up Postgres + pgvector
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db

# 4. Generate and run the first migration
npm run db:generate
npm run db:migrate

# 5. Run the server and web app
npm run dev:server   # http://localhost:3001
npm run dev:web       # http://localhost:5173 (proxies /api to the server)
```

To load the extension in Firefox: `about:debugging#/runtime/this-firefox` → *Load
Temporary Add-on* → `packages/extension/dist/manifest.json` (after `npm run build -w
@bookmark-manager/extension`). Set the server URL in the extension's options page.

**VPS deploy**: `docker compose up -d --build` on the server, using the same
`docker-compose.yml` and a production `.env`.
