# Bookmark Manager

A browser-independent, AI-powered bookmark manager. The core lives in a self-hosted
server + web app, not in any browser's native bookmark store. A Firefox extension
handles collection (saving, bulk import) and now has a one-click **Manage** button
that opens the web app; the web app is the real management surface (browse, search,
edit, organize). Point the extension at your own server and you get the same
bookmarks, the same tags, the same search, regardless of which browser you're in that
day.

**This file is a handover doc as much as a README** — it captures not just what exists
but *why*, so a fresh session (or a fresh you) can pick this up without re-deriving
decisions that were already made deliberately. It was substantially rewritten
2026-09-12 after a long session that touched nearly every part of the system —
treat this version, not memory of an older one, as current.

## Why

Native browser bookmarks are dumb (a URL and a title), siloed to one browser, and
un-searchable beyond exact string match. This project fixes that by:

1. Making the bookmark store independent of any single browser.
2. Using an LLM to actually understand what you saved — tags and a summary are
   generated automatically instead of you filing things into folders by hand.
3. Recognizing that not everything you bookmark *is* content — a browser-independent
   manager needs to handle "shortcuts" (google.com, github.com's homepage) differently
   from "references" (an article, docs, a specific post) — **but not so differently
   that they can't share categories, tags, and projects**, see Data model below.
4. Eventually letting you search bookmarks by *meaning* ("that article about rust
   async") rather than by exact keyword.

## Architecture

```
 ┌────────────┐  save / import  ┌─────────────┐   tag via DeepSeek   ┌────────────┐
 │  Extension │ ──────────────► │   Server    │ ───────────────────► │  Postgres  │
 │ (Firefox)  │  POST /api/...  │  (Fastify)  │                       │ +pgvector  │
 │            │ ◄────────────── │             │ ◄──────────────────  │            │
 └────────────┘  preview/confirm└──────┬──────┘   read/write          └────────────┘
        │                               │
        │ "Manage" button opens         │ serves API + static build
        ▼                               ▼
   the web app  ──────────────►  ┌────────────┐
                                  │  Web app   │  (React) — the real management UI
                                  └────────────┘
```

- **The extension is the collection tool, not just a dumb sender.** It captures a
  page (title/URL/rendered text, so login-gated pages and SPAs work), previews
  AI-generated tags/summary, and — critically — **never saves without the user seeing
  the result first**. This preview-then-confirm principle shows up again later
  (shortcut detection, category suggestions all work the same way — propose, review,
  apply). It also has a lightweight read-only Browse tab, a bulk "import from this
  browser's bookmarks" flow, and (new) a **Manage** button in the popup header that
  opens/focuses the web app in a tab — *editing/organizing* bookmarks is still
  deliberately not built into the extension itself, that's the web app's job, but
  getting there is now one click instead of remembering a URL. There was briefly a
  "manual add bookmark" form in the web app too; it was removed — **the extension is
  the only supported way to add a bookmark now**, the web app is purely for managing
  what's already there.
- **The server is the only source of truth.** Stores bookmarks, calls the LLM, serves
  the JSON API and the built web app as static files — one deployable unit. It already
  serves the built web app at its own root in dev too (whenever `packages/web/dist`
  exists), which is what makes the extension's Manage button work without any special
  routing.
- **The web app is where bookmarks actually get managed**: search, categorize, tag,
  delete, review anything the AI pipeline couldn't resolve on its own.
- **Local dev runs natively (nvm + Homebrew Postgres), not Docker.** Dockerized for
  deployment only — see [Environment & infra decisions](#environment--infra-decisions).

## Data model

Every bookmark has several largely-independent classification axes, and getting this
distinction right shaped a lot of the later design:

- **`type`: `"reference"` vs `"shortcut"`.** Reference = has real content worth
  reading/tagging (an article, docs, a post). Shortcut = a pure entrance/portal page
  (a homepage, a search engine, a tool's landing page) — nothing to summarize, just a
  launcher. Detected via a cheap URL heuristic (bare domain root) plus an LLM content
  check for ambiguous cases, always **proposed then confirmed** by the user, never
  auto-applied — see [`ai/classify.ts`](packages/server/src/ai/classify.ts) and the
  `detect-shortcuts`/`confirm-shortcuts` routes. **The conversion is bidirectional and
  always manual, both directions**: any reference card has an "It's a shortcut" button
  (used to be Pending-only; it's unconditional now since `BookmarkRow` only ever
  renders references anyway), and any shortcut tile's expanded editor has a "Not a
  shortcut" button. Neither needs the detect-then-confirm flow — that's for finding
  candidates in bulk, not the only way to reclassify one bookmark.
- **`category`: user-managed, AI-assisted, never AI-owned.** A broad grouping
  (coding/lifestyle/travel/compliance) — **not reference-only**, shortcuts carry a
  category too now. Categories are a real, addressable entity
  (`categories` table: `id`, `name` unique, `description` nullable) with full manual
  CRUD — create (`POST /categories`), rename with merge-on-collision (`PATCH
  /categories`), soft-delete (`DELETE /categories` — un-categorizes affected bookmarks,
  never deletes them), plus an inline-editable short **description** shown under the
  name in the Category view (disambiguates near-synonyms for the user, and gives the
  AI classify step real grounding beyond a bare name). The AI's role is **assistive,
  not authoritative**: it classifies bookmarks into whatever categories already exist
  (`POST /bookmarks/suggest-categories`, review-then-apply, same as shortcut
  detection) — it does not invent, rename, or delete categories as a side effect of
  that. See [Open items](#open-items) for the "AI recommends taxonomy changes,
  human approves" assistant that's designed but not yet built.
- **`project`: a container, not an attribute — collects references *and* shortcuts
  together.** This was a real mid-session reframing: `project` used to be buried
  inside the References view as if it only applied to references. It's its own
  top-level view now (`ProjectsView.tsx`), with the same manual CRUD as categories
  (create/rename/soft-delete — `POST`/`PATCH`/`DELETE /projects`), plus an inline
  "+ Add" search panel to pull existing bookmarks (either type) into a project by
  title, and an explicit empty state (a project can exist with zero bookmarks — it's
  `GET /projects`' full name list that drives what shows in the Projects view, not
  just names *derived* from bookmarks that happen to have one, which is what makes an
  empty project visible at all). **All removal in a project context is soft**:
  "Remove" on a bookmark shown inside a project only clears its `project_id` (the
  bookmark itself is untouched, and still has its own real Delete button everywhere
  else); "Remove" on the project itself un-links every bookmark that had it and
  deletes the project row, never the bookmarks.
- **`tags`: AI-generated by default, user-editable always.** Via
  [`ai/tagging.ts`](packages/server/src/ai/tagging.ts).
- **`status`: `"pending"` / `"resolved"` / `"failed"` — a *resolution* state, not a
  display label, and explicitly decoupled from tag/summary presence.** Renamed from
  the original `"tagged"` (migration `0003`) specifically because a resolved bookmark
  doesn't necessarily have tags — someone might resolve a pending item by hand with
  just a category and no tags, or mark it a shortcut (which by definition needs
  neither). `PATCH /bookmarks/:id` takes an explicit `resolved: true` field (the
  Pending view's "✓ Mark resolved" button) as the real, general way to resolve
  something; adding tags/a summary/converting to a shortcut still resolves it too, as
  a convenience, but none of those are the *only* path anymore. Watch for this
  distinction if extending resolution logic further — "has tags" and "is resolved"
  are not the same question.
- **`shortcutChecked` (bookmarks): a cache, asymmetric on purpose.** Set `true` only
  when shortcut-detection confidently rules a bookmark *out* as a shortcut — an
  unconfirmed positive candidate stays `false` so it keeps surfacing every run until
  the user actually resolves it, because there's no other UI path to convert a
  resolved reference into a shortcut later if it silently stopped appearing as a
  candidate. Re-running detection only pays for the (shrinking) set of bookmarks it
  doesn't already have a confident "no" for. `POST /bookmarks/clear-shortcut-cache`
  (a "Clear scan cache" button) resets it for a full re-scan.

**The web app has four top-level views, a strict partition on `status`/`type`, plus a
cross-cutting fifth:**
- **References** = `type: "reference"` AND `status: "resolved"`
- **Shortcuts** = `type: "shortcut"` (resolution implies `status: "resolved"` too)
- **Projects** = every resolved bookmark of *either* type that has a `project` set,
  grouped by project instead of by type — this is the one view that deliberately
  crosses the reference/shortcut line, because that's what a project *is*.
- **Pending** = `status != "resolved"`, regardless of type — mostly from bulk import
  failing to scrape a page, meaning the system genuinely doesn't know yet whether it's
  a reference or a shortcut.
- **Omnisearch** (not a tab): one search bar lives in the app header now, not
  duplicated per-view. A non-empty query takes over the content area **regardless of
  which tab is selected** and searches every bookmark of every type/status at once
  (`SearchResultsView.tsx`) — this was a real bug caught mid-session: an earlier
  version lifted the search *box* to the header but each view still only filtered its
  own type-scoped set, so switching tabs while searching showed different results for
  the same query. That's four search boxes sharing one input, not an omnisearch.
  Results render as flat, unlabeled cards for references/shortcuts (a card vs. a tile
  already tells them apart, same reasoning as why the category pill makes a grouping
  tree redundant during search) with a real "Pending" label only where the shape would
  otherwise be ambiguous.

References/Shortcuts should sum with Pending to the total bookmark count, with zero
overlap between References and Shortcuts. If they don't, something upstream isn't
setting `status`/`type` correctly on resolution.

## AI features

1. ✅ **Auto-tagging** — DeepSeek (`deepseek-flash` — not `deepseek-chat`, which was
   deprecated 2026-07-24) returns `{ tags, summary, meaningful }` from page content.
   `meaningful` catches boilerplate that's merely long enough to look substantial
   (cookie walls, bot-check interstitials, paywalls) — same LLM call, no extra cost.
2. ✅ **Shortcut detection** — persisted job (see "the job pattern" below), cached via
   `shortcutChecked` (see Data model). Bidirectional manual override always available.
3. ✅ **Category classification** — persisted job, chunked + concurrent (see below).
   Classifies both references and shortcuts against **whatever categories currently
   exist** — it does not generate or reshape the category list itself (see Data model
   and Open items).
4. ✅ **AI title suggestion** — [`ai/title.ts`](packages/server/src/ai/title.ts), a
   stateless call (like `/bookmarks/preview`) that proposes a cleaned-up title from
   page content, stripping site-name suffixes ("... - Example.com"). Shown as a
   "Suggest" button next to the inline title-rename control on `BookmarkRow`.
5. ✅ **True duplicate detection — solved for the save path.** `POST /bookmarks` on an
   existing URL no longer inserts a duplicate row. Behavior branches on the *existing*
   row's `status`, which was the key design call here:
   - Existing row is **pending/failed** (unresolved, nothing trustworthy to protect):
     the new save simply **takes over** — every field provided overwrites outright, no
     conflict prompt. This is what makes "re-add a pending bookmark with tags via the
     extension" actually resolve it, instead of silently creating an orphaned
     duplicate (the original bug report that led here).
   - Existing row is **resolved** (someone's finished, deliberate data): empty fields
     still fill in silently, but a field both sides already have a differing non-empty
     value for comes back as a `409` with the conflicting fields — the extension popup
     shows a keep-existing/use-new choice per field, then resolves via `PATCH`.
   The ~39 URLs already duplicated in the live dataset from before this fix were
   merged in a one-off script (not kept in the repo). **Still open**: the bulk import
   path (`import.ts`'s `seenUrls` check) still just skips-as-"duplicate" rather than
   merging, so a bulk re-import of an already-pending URL won't resolve it the way a
   single extension save now does.
6. ⏳ **Semantic search — still not implemented; the embedding provider decision is
   still open.** The schema has a `bookmark_embeddings` table with a placeholder
   `vector(1536)` column (will need a migration once a real provider/dimension is
   chosen), and [`ai/embeddings.ts`](packages/server/src/ai/embeddings.ts) defines an
   `EmbeddingProvider` interface so wiring one in is a one-file change. Hasn't moved
   since the very start of the project.
7. ⏳ **Category taxonomy management assistant — designed, not built.** The intended
   shape (confirmed with the user, next thing to pick up): categories stay entirely
   human-managed (create/rename/delete, already built) and the *existing* `categories`
   table stays the single source of truth — no separate "definition" list. The new
   piece is one LLM call that looks at all current categories (with descriptions) and
   all resolved bookmarks (both types) and recommends **add / rename / delete**
   actions on the taxonomy itself — a cleanup/reorganization assistant, reviewed
   before applying like everything else here — as distinct from classification
   (item 3), which only assigns bookmarks into whatever categories already exist and
   never reshapes the list. Building this is the natural next step.

### The persisted-job pattern (use this for anything slow)

Bulk import, shortcut detection, and category classification are all shaped the same
way, and **any future slow AI/batch operation should follow this shape too**:

- `POST` starts the job, writes a row (`status: "running"`), kicks off the work
  **without awaiting it**, and returns a `jobId` immediately.
- `GET /.../:id` polls `{ status, result, error, createdAt }`.
- The web client stores the active `jobId` in `localStorage` (not component state) and
  resumes polling on mount — a tab switch, reload, or closing the tab entirely does
  not lose the work, because the work was never tied to that one HTTP connection.
  `createdAt` comes back specifically so the client's elapsed-time counter anchors to
  the job's real start, not the component's mount time (otherwise reopening the page
  after a while shows a counter that restarted from zero, which looks wrong even
  though the job itself is fine).
- The tables: `import_jobs`, `category_suggestion_jobs`, `detect_shortcut_jobs` — same
  shape each time (`status`, a result column, `error`, `createdAt`).

Two lessons learned building this that generalize to any new AI call site:

- **Give every DeepSeek call an explicit timeout.** The shared client
  (`ai/tagging.ts`'s `getClient()`) had none for a while and silently fell back to the
  SDK's 10-minute default — a real request once sat "running" for 7+ minutes before
  being force-failed, which looks exactly like a hang from a job someone's watching.
  Fixed with a 60s client-level default (covers every single-item call) plus a longer
  per-call override for genuinely bigger batch calls.
- **Generation time scales with a call's *output* size, not input size.** The
  original single-call category-suggestion design made the model echo back every
  bookmark id grouped by category in one response — that's what made it slow (and
  all-or-nothing on failure) at a few hundred bookmarks, not the input prompt.
  `ai/categorize.ts`'s `classifyChunk` is chunked (60 bookmarks per call) and run with
  a worker-pool of 4 concurrent calls at the route level — same shape as
  `import.ts`'s `CONCURRENCY` — so any one call's output stays small and a slow/failed
  chunk only costs that chunk, not the whole run. Apply this shape ("classify N things
  in one shot" → chunk + concurrency) to any future call with a similarly-shaped
  output.

## Project Structure

npm workspaces monorepo:

```
BookmarkManager/
├── docker-compose.yml       # db + app — deploy topology (see infra notes below)
├── docker-compose.dev.yml   # dev override: bind-mounts source, hot-reloads the server
├── .env.example             # docker-compose env (Postgres creds, DEEPSEEK_API_KEY, PORT)
├── .nvmrc                   # Node version — use nvm, not Homebrew (see infra notes)
├── package.json             # workspaces root
├── tsconfig.base.json       # shared TS compiler options
└── packages/
    ├── shared/    # types/contracts (Zod) used by server, web, and extension
    ├── server/    # Fastify API + Postgres/Drizzle + DeepSeek client
    ├── web/       # React + Vite + Tailwind + TanStack Query — the management UI
    └── extension/ # WebExtension (Manifest V3), Firefox-first
```

### `packages/shared`

Zod schemas are the single source of truth for API shapes — the server validates
requests against them, the client validates responses against the same schemas, so a
drift between what the server sends and what the client expects fails loudly instead of
silently. See [`src/types.ts`](packages/shared/src/types.ts).

### `packages/server`

Fastify API, all routes under `/api`:

- [`src/index.ts`](packages/server/src/index.ts) — entrypoint. Serves the built web app
  as static files with an SPA fallback when `packages/web/dist` exists (dev *and*
  prod/Docker — this is what the extension's Manage button relies on). Also wires up
  an `undici` `ProxyAgent` from `HTTPS_PROXY`/`HTTP_PROXY` env vars — Node's built-in
  `fetch` doesn't read these the way `curl` does, and without this, outbound fetches
  (import's page scraping, DeepSeek calls) silently hang/timeout on networks that
  require a proxy.
- [`src/db/schema.ts`](packages/server/src/db/schema.ts) — Drizzle schema: `bookmarks`
  (url, title, content, summary, favicon, `categoryId`/`projectId` FKs, `status`,
  `type`, `shortcutChecked`), `categories` (name, `description`), `projects` (name),
  `tags` (all upsert-by-name), `bookmark_tags` (join table), `bookmark_embeddings`
  (placeholder, see AI features), `import_jobs`, `category_suggestion_jobs`,
  `detect_shortcut_jobs` (the last two: see "the job pattern" above).
- [`src/routes/bookmarks.ts`](packages/server/src/routes/bookmarks.ts) — the big one:
  `GET`/`POST`/`PATCH`/`DELETE /bookmarks` (the dedup-merge logic from AI features #5
  lives in `POST`), `POST /bookmarks/preview` (stateless tag generation), `POST
  /bookmarks/suggest-title` (stateless), `detect-shortcuts`/`confirm-shortcuts`/
  `clear-shortcut-cache`, `suggest-categories`/`apply-categories`. `PATCH` is a true
  partial update (omitted fields untouched, `""` clears category/project, presence of
  `tags` replaces the full set, `resolved: true` is the explicit resolve path).
- [`src/routes/categories.ts`](packages/server/src/routes/categories.ts) /
  [`projects.ts`](packages/server/src/routes/projects.ts) — near-identical CRUD:
  `GET` (plain name list, used by every "Move to"/datalist consumer), `POST` (explicit
  create — categories' is idempotent-on-existing-name so a bare re-create can't wipe
  an existing description; projects' just upserts), `PATCH` (rename, merges into an
  existing name if the target already exists rather than erroring), `DELETE` (soft —
  un-links affected bookmarks, never deletes them). Categories additionally has `GET
  /categories/full` (name+description pairs) and `PATCH /categories/description`.
- [`src/routes/import.ts`](packages/server/src/routes/import.ts) — bulk import job
  runner. Per-URL: fetch (with the proxy dispatcher above) → extract text (deliberately
  crude regex-based, [`extraction/html.ts`](packages/server/src/extraction/html.ts) —
  no headless browser; pages needing JS rendering just fall through to `pending` rather
  than failing the import) → tag. Each item's failure is isolated (one bad page can't
  crash the whole job).
- [`src/ai/tagging.ts`](packages/server/src/ai/tagging.ts) — DeepSeek client (shared,
  lazily-initialized, 60s default timeout) + auto-tagging.
  [`classify.ts`](packages/server/src/ai/classify.ts) — shortcut-detection check,
  reusing already-scraped content. [`categorize.ts`](packages/server/src/ai/categorize.ts)
  — `classifyChunk` (see "the job pattern"). [`title.ts`](packages/server/src/ai/title.ts)
  — title suggestion.

### `packages/web`

React + Vite + Tailwind v4 (`@tailwindcss/vite`, zero-config) + TanStack Query v5.

- [`src/App.tsx`](packages/web/src/App.tsx) — top-level shell: the four-tab switcher,
  the omnisearch bar (see Data model), and the shared `category-options`/
  `project-options` `<datalist>`s every `BookmarkRow`/`ShortcutTile` uses.
- [`src/ReferenceView.tsx`](packages/web/src/ReferenceView.tsx) /
  [`ShortcutView.tsx`](packages/web/src/ShortcutView.tsx) — each has a Category/All
  sub-toggle; Category mode uses `GroupedCardView.tsx` (generic over how a group's
  items render via a `renderItems` prop — a `BookmarkRow` list by default, a
  `ShortcutTile` grid for shortcuts — so the grouping/rename/remove/description-edit
  logic isn't duplicated). Both also host `NewCategoryForm.tsx`, and References hosts
  `CategorySuggestions.tsx` (the classify-job trigger + review panel).
- [`src/ProjectsView.tsx`](packages/web/src/ProjectsView.tsx) — lists every project
  (from the full name list, not just ones with bookmarks — see Data model), each with
  create/rename/remove and an inline "+ Add" search panel; expanding one splits into
  References/Shortcuts sub-sections.
- [`src/SearchResultsView.tsx`](packages/web/src/SearchResultsView.tsx) — the
  omnisearch results view (see Data model); takes over from whatever tab is active.
- [`src/PendingView.tsx`](packages/web/src/PendingView.tsx) — flat list of everything
  unresolved, with "✓ Mark resolved"/"📦 It's a shortcut" actions per row.
- [`src/BookmarkRow.tsx`](packages/web/src/BookmarkRow.tsx) — the shared reference
  card: inline title rename (+ AI "Suggest"), tag pills, category/project fields, a
  "Move to [category]" dropdown when in a grouped context, "It's a shortcut" (always
  available), and an `onRemoveFromProject` prop that — only when provided (i.e., this
  row is being shown inside a project) — swaps "Delete" for "Remove" (unlink from
  project, not delete the bookmark).
- [`src/ShortcutTile.tsx`](packages/web/src/ShortcutTile.tsx) — the shortcut
  equivalent: stays a direct link (a shortcut's whole point is one click to the URL,
  so nothing about editing can hijack that click) with a hover-revealed "…" icon that
  expands an inline editor below the tile (category/project/tags, same fields as
  `BookmarkRow`) and a hover-revealed "×" that deletes (title says so) — same
  `onRemoveFromProject` override as `BookmarkRow` when shown inside a project.
- [`src/Favicon.tsx`](packages/web/src/Favicon.tsx) — falls back to a colored
  initial-circle (hashed from the title, stable across reloads) when there's no
  favicon or it fails to load.

### `packages/extension`

WebExtension, Manifest V3, Firefox-first (`browser_specific_settings.gecko.id`), using
`webextension-polyfill` so the same source works in Chrome/Edge later with just a
second manifest/build target — no Chrome build target exists yet.

- [`src/content.ts`](packages/extension/src/content.ts) — not a declared content
  script; a plain function injected on demand via `browser.scripting.executeScript`
  only when the user acts, so nothing runs on every page load.
- [`src/background.ts`](packages/extension/src/background.ts) — all `fetch`-to-server
  logic and message handling (extraction, preview, save, list, import,
  `OPEN_MANAGE_PAGE`). `SAVE_BOOKMARK` can come back as a `409` conflict now (see AI
  features #5) — the popup shows a keep/use-new choice per field, not just success/fail.
- [`src/popup/popup.ts`](packages/extension/src/popup/popup.ts) — Save tab
  (preview-then-confirm form, conflict resolution UI) and Browse tab (read-only,
  searchable, grouped by category/project). A **Manage** button next to Settings sends
  `OPEN_MANAGE_PAGE`, which opens `serverUrl`'s root in a new tab or focuses one
  already open there — needs the `"tabs"` manifest permission to see tab URLs well
  enough to match against, so a fresh install/reload needs to accept that permission
  before the button works.
- [`src/options.ts`](packages/extension/src/options.ts) — server URL config, and the
  bulk import flow (`browser.bookmarks.getTree()` → flatten → `POST /api/import` →
  poll for progress → CSV report download).
- Both popup and options show a **build timestamp** (regenerated by an esbuild plugin
  on every build, including incremental rebuilds under `--watch`) so you can tell
  whether a `web-ext` reload actually picked up the latest code.
- [`scripts/build.mjs`](packages/extension/scripts/build.mjs) — esbuild bundles the
  entrypoints and copies `public/` into `dist/`. `npm run dev -w @bookmark-manager/extension`
  watches; pair with `npm run start:firefox -w @bookmark-manager/extension` (`web-ext`)
  for a real auto-reloading Firefox instance instead of manual `about:debugging` clicks.

## Environment & infra decisions

These were each the result of real friction — worth knowing before re-deriving them:

- **Use `nvm` for Node, not Homebrew.** Homebrew's `node` formula compiling from source
  (no bottle for this machine's macOS version) took over an hour and once left the
  system with a broken, unlinked Node install after being interrupted. `nvm` downloads
  prebuilt binaries directly from nodejs.org — no Homebrew dependency graph, no
  compiling. Current pin: **Node 24** (check `.nvmrc`, and re-verify "Active LTS"
  rather than trusting this number to stay current forever).
- **Postgres runs natively via Homebrew for local dev, not Docker.** `brew install
  postgresql@18 pgvector`. Docker is reserved for matching the actual deploy target
  (`docker-compose.yml`, VPS) — **local dev never needs Docker running at all**, and
  this has been re-confirmed more than once mid-session; don't reach for
  `docker ps`/`docker compose` to inspect or query the local DB, use `psql` directly.
- **`pgvector/pgvector:pg18`** in the Docker image, matching the native Postgres 18.
- **DeepSeek, not OpenAI**, for cost. Model name is `deepseek-flash` — `deepseek-chat`/
  `deepseek-reasoner` were discontinued 2026-07-24. **Every DeepSeek call site needs an
  explicit timeout** — see "the job pattern" above; the SDK's 10-minute default is not
  an acceptable fallback once a call's result is something a user might be watching for.
- **The dev machine needs an outbound proxy** (`HTTPS_PROXY=http://127.0.0.1:7890` in
  this environment, via ClashX) for most external fetches to succeed — Node's `fetch`
  doesn't read proxy env vars the way `curl` does, hence the `undici` `ProxyAgent` wiring
  in `index.ts`. If bulk import's fetches (or DeepSeek calls) all mysteriously time
  out or hang, check this first.
- **The dev server processes (`tsx watch`, Vite) don't survive a host restart** (e.g.
  the dev machine losing power) — Postgres and all committed/uncommitted file state
  do. After a restart, just `npm run dev:server` / `npm run dev:web` again; nothing
  else needs re-doing.
- **Conventional commits** (`feat(scope): ...`, `fix: ...`) — explicit user preference,
  applies to every commit in this repo.
- **Commit before starting a distinct new feature/direction**, not just at the end of a
  long session — also explicit preference. Prefer several atomic commits over one giant
  one when a session's work touches unrelated concerns.

## Open items

1. **Category taxonomy management assistant** — designed, not built. See AI features
   item 7 above; this is the natural next piece to pick up.
2. **Semantic search / embedding provider** — never decided. See AI features item 6.
3. **Bulk import doesn't merge duplicates**, only skips them — see AI features item 5.
   The single-save path (extension → `POST /bookmarks`) already merges correctly; the
   bulk path's `seenUrls` check in `import.ts` would need the same treatment.

## Running It

```bash
# 0. Node via nvm (see infra notes above — do not use Homebrew's node)
nvm install   # reads .nvmrc

# 1. Install dependencies (root, workspaces)
npm install

# 2. Configure environment
cp .env.example .env                                    # docker-compose env (only needed for deploy/Docker)
cp packages/server/.env.example packages/server/.env    # DATABASE_URL (localhost), DEEPSEEK_API_KEY

# 3. Postgres, natively (not Docker — see infra notes)
brew install postgresql@18 pgvector
brew services start postgresql@18
createuser bookmarks --createdb
createdb bookmarks -O bookmarks
psql -d bookmarks -c "CREATE EXTENSION vector;"
# then set packages/server/.env's DATABASE_URL to match, e.g.
# postgresql://bookmarks@localhost:5432/bookmarks

# 4. Migrate
npm run db:generate
npm run db:migrate

# 5. Run
npm run dev:server   # http://localhost:3001
npm run dev:web       # http://localhost:5173 (proxies /api to the server)
```

Extension, for live-reloading development:
```bash
npm run dev -w @bookmark-manager/extension          # esbuild --watch
npm run start:firefox -w @bookmark-manager/extension # web-ext, separate terminal tab
```
Or manually: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
`packages/extension/dist/manifest.json`. Either way, set the server URL in the
extension's options page, accept the `"tabs"` permission if prompted (needed for the
Manage button), and check the build timestamp shown there/in the popup to confirm
you're looking at the latest build.

**VPS deploy**: `docker compose up -d --build` on the server, using the same
`docker-compose.yml` and a production `.env`. This is the one place Docker is actually
required.
