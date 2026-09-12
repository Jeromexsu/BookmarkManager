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
2026-09-12, twice — once mid-session, then again after a second long session the same
day that centralized category management, shipped the AI taxonomy assistant, rebuilt
Projects/Pending/the card UI, added one-way sync into the browser's native bookmarks,
and did a full first production deploy. Treat this version, not memory of an older one,
as current.

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
  category too. Categories are a real, addressable entity (`categories` table: `id`,
  `name` unique, `description` nullable) with full manual CRUD — create
  (`POST /categories`), rename with merge-on-collision (`PATCH /categories`),
  soft-delete (`DELETE /categories` — un-categorizes affected bookmarks, never deletes
  them), plus a short **description** (disambiguates near-synonyms for the user, and
  gives every AI call that touches categories real grounding beyond a bare name).
  **All of that CRUD lives in exactly one place now: the Settings tab**
  (`SettingsView.tsx`) — it used to be scattered across each category-group header in
  References/Shortcuts (rename/remove/describe inline) plus a separate "+ New category"
  form in each view's toolbar; that was a real usability complaint mid-session and got
  consolidated. References/Shortcuts group headers are now read-only display (name,
  description, bookmark-count pill). The AI has two distinct, deliberately separate
  roles here:
  1. **Classification** (assistive, not authoritative) — assigns bookmarks into
     whatever categories already exist (`POST /bookmarks/suggest-categories`,
     review-then-apply). Branded "Auto-categorize" in the UI, and **scoped by bookmark
     type** — the button lives in both References and Shortcuts now, and a run started
     from one never touches the other (`type` is a required field on the request/job
     row, not inferred). Never invents, renames, or deletes a category as a side effect.
  2. **Taxonomy planning** (also assistive) — a single LLM call
     (`ai/planCategories.ts`) that looks at samples from every current category (name,
     description, a handful of titles, top tags) plus the "Uncategorized" bucket the
     same way, and proposes **add / rename / remove / describe** changes to the list
     itself — this is the "AI recommends taxonomy changes, human approves" assistant
     that used to be an open item; it's built now (`CategoryPlanReview.tsx` in
     Settings). Applying an accepted plan is just replaying it through the same
     create/rename/delete/describe mutations Settings already has — rename before
     remove before add before describe, so a merge target exists before anything
     references it, and a rename's cross-validated against the real category list so a
     hallucinated name gets dropped rather than silently accepted.
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
  are not the same question. (The Pending *view* no longer exposes a manual
  "Mark resolved" control, though — see `PendingView` below; the field/semantics are
  unchanged, just the UI surface for it.)
- **`invalid` (bookmarks): a soft-delete flag, not a real `DELETE`.** Added for the
  browser-sync feature (see below) — `DELETE /bookmarks/:id` now sets this instead of
  removing the row, and every normal read (`GET /bookmarks`, both classify jobs, the
  taxonomy planner's sampling) filters it out. Re-saving a URL that's currently
  `invalid` (extension save, or bulk import hitting the same URL) revives it — clears
  the flag as part of the normal resolve/merge path, same PR that added the column.
- **`updatedAt` (bookmarks): DB-trigger-maintained, not application-set.** A Postgres
  trigger (`bookmarks_set_updated_at`, in migration `0009`) bumps it on *any* `UPDATE`
  to the row, regardless of which route/code path did it — deliberately not something
  any handler sets by hand, so no future update path can forget it. This is what makes
  `GET /bookmarks/sync?since=<timestamp>` work as a plain diff (see Browser sync
  below) without a separate change-log table.
- **`shortcutChecked` (bookmarks): a cache, asymmetric on purpose.** Set `true` only
  when shortcut-detection confidently rules a bookmark *out* as a shortcut — an
  unconfirmed positive candidate stays `false` so it keeps surfacing every run until
  the user actually resolves it, because there's no other UI path to convert a
  resolved reference into a shortcut later if it silently stopped appearing as a
  candidate. Re-running detection only pays for the (shrinking) set of bookmarks it
  doesn't already have a confident "no" for. `POST /bookmarks/clear-shortcut-cache`
  (a "Clear scan cache" button) resets it for a full re-scan.

**The web app has five top-level tabs, four of them a strict partition on
`status`/`type`, plus a cross-cutting omnisearch:**
- **References** = `type: "reference"` AND `status: "resolved"`
- **Shortcuts** = `type: "shortcut"` (resolution implies `status: "resolved"` too)
- **Projects** = every resolved bookmark of *either* type that has a `project` set,
  grouped by project instead of by type — this is the one view that deliberately
  crosses the reference/shortcut line, because that's what a project *is*. Redesigned
  from an expandable flat list into a **card grid** (one card per project, a dashed
  "+ New project" card first) that drills into a per-project detail view on click
  (References/Shortcuts sections, same as before, plus rename/remove/+Add) — the grid
  is purely a browsing/navigation layer, all the actual CRUD moved into that detail
  view's header instead of living on every list row.
- **Pending** = `status != "resolved"`, regardless of type — mostly from bulk import
  failing to scrape a page, meaning the system genuinely doesn't know yet whether it's
  a reference or a shortcut. **Deliberately stripped down**: a pending row has no
  scraped content, so there's nothing to tag/categorize/summarize by hand — the row is
  just title (links out to reopen the page) + URL + Delete, two-per-row grid instead of
  a single column. The old per-row "✓ Mark resolved"/"📦 It's a shortcut" controls are
  gone; the only real path forward for a pending item is delete it or reopen-and-re-add
  it so it actually gets scraped.
- **Settings** — the fifth tab, and the one-stop home for category definitions (see
  Data model above): the category list (name, description, bookmark count, inline
  rename/describe/remove), the "+ New category" form, and the AI taxonomy-planning
  panel (`CategoryPlanReview.tsx`).
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
3. ✅ **Category classification ("Auto-categorize")** — persisted job, chunked +
   concurrent (see below). Classifies against **whatever categories currently
   exist** — it does not generate or reshape the category list itself (that's item 7).
   **Scoped by bookmark type**: the button/job is per-tab (References vs. Shortcuts),
   `type` is a required request field, and each tab's job-tracking `localStorage` key
   is namespaced by type too — these used to share one key, so starting a job in one
   tab could show it "resuming" in the other.
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
7. ✅ **Category taxonomy planning assistant** — see Data model above for the full
   shape. One LLM call (`ai/planCategories.ts`) over per-category *samples* (not the
   full corpus — bounded prompt size regardless of how large the library gets) proposes
   add/rename/remove/describe changes to the category list itself, reviewed
   (`CategoryPlanReview.tsx`, checkboxes per suggestion + the model's stated reason)
   before anything is applied. Distinct from classification (item 3), which never
   reshapes the list, only assigns into it.
8. ✅ **"Auto-fill" in the extension's save form** — `POST /bookmarks/preview` (the
   extension's preview-then-confirm step) now returns, alongside tags/summary, a
   suggested **category** (from the existing list, same guarantee as item 3 — never
   invents one) and a **type guess** (reference vs. shortcut, reusing item 2's
   shortcut-classification call). Both are pre-filled but fully overridable before
   saving. **Project is deliberately excluded from auto-fill** — it's a pure
   user-curated grouping, not something to guess. The extension's Category/Project
   fields are also select-only now (populated from the existing lists) — no more
   typing a new one into existence from the extension; that's Settings'/Projects'
   job now, matching the "one place to define things" principle category management
   went through.

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
- The tables: `import_jobs`, `category_suggestion_jobs`, `detect_shortcut_jobs`,
  `category_plan_jobs` — same shape each time (`status`, a result column, `error`,
  `createdAt`).

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

## Browser sync — mirroring bookmarks into the browser's own store

The extension can now push resolved bookmarks **one-way** (app → browser, never back)
into the browser's native Bookmarks Toolbar (shortcuts) and Other Bookmarks
(references), organized into per-category subfolders — a `Sync to browser` button in
the extension's Settings page. This exists specifically because a browser's native
bookmark folder tree is a strict single-parent hierarchy and can't represent this app's
multi-axis model (a bookmark can have a category *and* a project *and* tags
simultaneously) — the deliberate choice was to make **category** the one axis that maps
to folders, and leave project/tags unrepresented in the browser rather than force a
lossy or duplicated mapping.

- **Type → root folder**: shortcuts → Bookmarks Toolbar, references → Other Bookmarks.
  Bookmarks Menu and Mobile Bookmarks are never touched.
- **Sync detection is a plain timestamp diff, on purpose — no separate ledger.**
  `GET /bookmarks/sync?since=<timestamp>` (server's own clock, returned as `syncedAt`,
  used as the client's *next* `since` — avoids client/server clock drift) returns every
  bookmark with `updatedAt` after that time. The extension keeps exactly **one**
  timestamp locally (`storage.local`, deliberately not `storage.sync` — a bookmark id
  from one browser install has no meaning in another, so each install must track its
  own sync state independently). A deliberately minimal choice: this means sync is
  **additive-only** — a bookmark deleted from the app after being synced stays in the
  browser until removed by hand, since there's no list to diff against to notice the
  removal. That trade-off was made explicitly in favor of not maintaining a
  long-lived ledger.
- **Soft-delete is what makes even that timestamp diff catch removals at all.** See
  `invalid`/`updatedAt` in Data model above — flipping `invalid` is an `UPDATE`, so the
  trigger bumps `updatedAt`, so the next sync's diff picks it up and removes the
  matching browser bookmark, without the endpoint needing any special "deleted since"
  query shape.
- **First sync wipes and rebuilds** Toolbar + Other Bookmarks entirely (confirmed with
  a hard warning dialog first) rather than trying to dedupe against whatever's already
  there — most of a fresh install's bookmarks got there via this app's own *import*
  feature in the first place, so leaving old copies in place would just double
  everything up. The extension's Settings page also has a one-click **"Download
  backup"** that dumps the *entire* native bookmark tree (not just the two folders
  about to be wiped) to a Netscape-format HTML file first — re-importable by any
  browser if a sync ever goes wrong.
- **Known gap, not yet built: category *definition* changes aren't synced.** Renaming
  or deleting a category that currently has zero bookmarks produces no signal at all
  (the sync feed is bookmark-keyed), so it can leave a stale, orphaned folder behind in
  the browser with the old name. Fixing this needs categories to carry their own
  `invalid`/`updatedAt` (same trigger pattern) and a second feed the extension
  reconciles folder names against — flagged mid-session as "heavy, needs tricks," not
  started.

## Project Structure

npm workspaces monorepo:

```
BookmarkManager/
├── docker-compose.yml       # db + app — LOCAL DEV topology only, not for a public VPS
├── docker-compose.dev.yml   # dev override: bind-mounts source, hot-reloads the server
├── docker-compose.prod.yml  # standalone prod stack — see Deployment below, and DEPLOY.md
├── DEPLOY.md                # the actual VPS deploy runbook — read this before deploying
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
  `type`, `shortcutChecked`, **`invalid`** and **`updatedAt`** — see Data model and
  Browser sync above), `categories` (name, `description`), `projects` (name), `tags`
  (all upsert-by-name), `bookmark_tags` (join table), `bookmark_embeddings`
  (placeholder, see AI features), `import_jobs`, `category_suggestion_jobs`,
  `detect_shortcut_jobs`, `category_plan_jobs` (the last three: see "the job pattern"
  above). `updatedAt` is maintained by a raw-SQL trigger in migration `0009`
  (`bookmarks_set_updated_at`), not by Drizzle/application code — deliberately, so no
  future update path can forget to bump it.
- [`src/routes/bookmarks.ts`](packages/server/src/routes/bookmarks.ts) — the big one:
  `GET`/`POST`/`PATCH`/`DELETE /bookmarks` (the dedup-merge logic from AI features #5
  lives in `POST`; `DELETE` sets `invalid` rather than removing the row), `POST
  /bookmarks/preview` ("Auto-fill" — tags/summary/category/type guess, see AI features
  #8), `POST /bookmarks/suggest-title` (stateless), `detect-shortcuts`/
  `confirm-shortcuts`/`clear-shortcut-cache`, `suggest-categories`/`apply-categories`
  (now `type`-scoped, see AI features #3), and **`GET /bookmarks/sync`** (see Browser
  sync above — a narrow feed of `{id, url, title, category, type, invalid, updatedAt}`
  for whatever changed since a given time, including invalidated rows). `PATCH` is a
  true partial update (omitted fields untouched, `""` clears category/project,
  presence of `tags` replaces the full set, `resolved: true` is the explicit resolve
  path).
- [`src/routes/categories.ts`](packages/server/src/routes/categories.ts) /
  [`projects.ts`](packages/server/src/routes/projects.ts) — near-identical CRUD:
  `GET` (plain name list, used by every "Move to"/datalist consumer), `POST` (explicit
  create — categories' is idempotent-on-existing-name so a bare re-create can't wipe
  an existing description; projects' just upserts), `PATCH` (rename, merges into an
  existing name if the target already exists rather than erroring), `DELETE` (soft —
  un-links affected bookmarks, never deletes them). Categories additionally has `GET
  /categories/full` (name+description pairs), `PATCH /categories/description`, and
  **`POST`/`GET /categories/plan`** (the taxonomy-planning job — see AI features #7 —
  built from per-category *samples* via `buildCategorySamples()`, not the full corpus).
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
  — title suggestion. [`planCategories.ts`](packages/server/src/ai/planCategories.ts)
  — the taxonomy-planning call (AI features #7); cross-validates every name the model
  returns against the real category list, so a hallucinated add/rename/describe target
  gets silently dropped rather than accepted.

### `packages/web`

React + Vite + Tailwind v4 (`@tailwindcss/vite`, zero-config) + TanStack Query v5.

- [`src/App.tsx`](packages/web/src/App.tsx) — top-level shell: the five-tab switcher
  (References/Shortcuts/Projects/Pending/Settings), the omnisearch bar (see Data
  model), and the shared `category-options`/`project-options` `<datalist>`s every
  `BookmarkRow`/`ShortcutTile` uses.
- [`src/SettingsView.tsx`](packages/web/src/SettingsView.tsx) — the category
  management home (see Data model): the list (name, description, bookmark-count),
  `NewCategoryForm.tsx`, and `CategoryPlanReview.tsx` (the taxonomy-planning job
  trigger + review panel — same job-persistence shape as `CategorySuggestions.tsx`).
- [`src/ReferenceView.tsx`](packages/web/src/ReferenceView.tsx) /
  [`ShortcutView.tsx`](packages/web/src/ShortcutView.tsx) — each has a Category/All
  sub-toggle and an "Auto-categorize" trigger (`CategorySuggestions.tsx`, now used by
  both, each passing its own `type`). Category mode uses `GroupedCardView.tsx`
  (generic over how a group's items render via a `renderItems` prop — a `BookmarkRow`
  list by default, a `ShortcutTile` grid for shortcuts) — **now read-only display
  only** (name, description, count pill, one line); the rename/remove/describe
  controls that used to live in each group header moved to Settings.
- [`src/ProjectsView.tsx`](packages/web/src/ProjectsView.tsx) — **redesigned into a
  card grid** (browsing layer only) that drills into a per-project detail view on
  click (References/Shortcuts sections + create/rename/remove/+Add, formerly on every
  list row, now only in the detail view's header). Renaming the currently-open
  project follows the rename instead of bouncing back to the grid because its key
  stopped matching anything.
- [`src/SearchResultsView.tsx`](packages/web/src/SearchResultsView.tsx) — the
  omnisearch results view (see Data model); takes over from whatever tab is active.
  Its pending-results section uses `PendingRow.tsx` now, same as the Pending tab.
- [`src/PendingView.tsx`](packages/web/src/PendingView.tsx) /
  [`PendingRow.tsx`](packages/web/src/PendingRow.tsx) — deliberately minimal now (see
  Data model): title (links out) + URL + Delete, two-column grid. No
  tag/category/summary editing and no "Mark resolved"/"It's a shortcut" — a pending
  bookmark has no scraped content, so there's nothing to hand-edit; the only real move
  is delete or reopen-and-re-add.
- [`src/BookmarkRow.tsx`](packages/web/src/BookmarkRow.tsx) — the shared reference
  card. Reworked into an actual **card**: raised surface + shadow (distinct from the
  page background, not just an outlined row), and reordered into title/URL/summary,
  then a divider, then category+move-to on one line, tags, project last (was
  category → move-to → project → tags before — project now comes after tags, matching
  the divider-separated "content vs. metadata" split). Still: inline title rename
  (+ AI "Suggest"), tag pills, "It's a shortcut" (always available), and
  `onRemoveFromProject` swapping "Delete" for "Remove" when shown inside a project.
- [`src/ShortcutTile.tsx`](packages/web/src/ShortcutTile.tsx) — stays a direct link
  (a shortcut's whole point is one click to the URL) with a hover-revealed "…" that
  expands an inline editor (same field order as `BookmarkRow` now: category+move-to,
  tags, project) and a hover-revealed "×" that deletes. The expanded editor is now:
  - **Absolutely positioned**, not in normal document flow — a wide panel can't push
    neighboring tiles around, and its opaque background + `z-20` guarantee it (not
    whatever tile happens to sit underneath its footprint) catches every click inside
    its bounds.
  - **Mutually exclusive across every tile on the page** — a tiny module-level
    external store (`useSyncExternalStore`, keyed by bookmark id) means opening one
    tile's editor always closes whichever other one was open, regardless of which view
    rendered them (References/Shortcuts/a project's list/search results all share it).
  - **Closes on outside click**, and **edge-aware** — right-aligns instead of
    left-aligning when there isn't room to the right (tiles near the window edge),
    measured against the tile's own bounding rect at open time.
- [`src/Favicon.tsx`](packages/web/src/Favicon.tsx) — falls back to a colored
  initial-circle (hashed from the title, stable across reloads) when there's no
  favicon or it fails to load.

### `packages/extension`

WebExtension, Manifest V3, Firefox-first (`browser_specific_settings.gecko.id`), using
`webextension-polyfill` so the same source works in Chrome/Edge later with just a
second manifest/build target — no Chrome build target exists yet. The manifest also
declares `data_collection_permissions` (`bookmarksInfo` + `websiteContent`, both
`required`) — a Mozilla requirement for new AMO submissions since Nov 2025; missing it
fails validation outright with no other explanation than "the property is missing."

- [`src/content.ts`](packages/extension/src/content.ts) — not a declared content
  script; a plain function injected on demand via `browser.scripting.executeScript`
  only when the user acts, so nothing runs on every page load.
- [`src/background.ts`](packages/extension/src/background.ts) — all `fetch`-to-server
  logic and message handling (extraction, save, list, import, sync, `OPEN_MANAGE_PAGE`).
  The old `PREVIEW_TAGS` message is `AUTO_FILL` now (see AI features #8) and returns
  `{tags, summary, category, isShortcut}`, not just tags/summary. `SAVE_BOOKMARK` can
  come back as a `409` conflict (see AI features #5) — the popup shows a keep/use-new
  choice per field, not just success/fail.
- [`src/popup/popup.ts`](packages/extension/src/popup/popup.ts) — Save tab
  (preview-then-confirm form, conflict resolution UI) and Browse tab (read-only,
  searchable, grouped by category/project). The save form has a **Type toggle**
  (Reference/Shortcut, defaults to Reference, set by Auto-fill's guess but always
  overridable) and Category/Project are **`<select>`s populated from the existing
  lists** now, not free-text comboboxes with a "+ Add" affordance — creating a new one
  from the extension isn't possible anymore, matching the "one place to define things"
  move category management went through (Settings/Projects own that now). "✨ Auto-tag"
  is "✨ Auto-fill" — same button, extended scope (item 8). A **Manage** button next to
  Settings sends `OPEN_MANAGE_PAGE`, needs the `"tabs"` permission.
- [`src/options.ts`](packages/extension/src/options.ts) — server URL config, the bulk
  import flow (`browser.bookmarks.getTree()` → flatten → `POST /api/import` → poll for
  progress → CSV report download), and now **Sync to browser** (see the dedicated
  section above) — a "Download backup" button (full tree → Netscape-format HTML) and
  the "Sync to browser" trigger itself, both against `browser.bookmarks`.
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
  **Mount the volume at `/var/lib/postgresql`, not `.../postgresql/data`** — Postgres
  18+'s official images changed the expected layout (data now lives under a
  version-specific subdirectory, for `pg_ctlcluster`-style upgrades); the old pre-18
  mount point makes the entrypoint refuse to start outright. Real bug, found and fixed
  during the first actual VPS deploy — see Deployment below.
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

## Deployment

**First production deploy happened 2026-09-12** — a personal Aliyun ECS VPS, already
running several unrelated services (Vaultwarden, Calibre-Web, OpenList, FileCodeBox)
behind an existing nginx. **`DEPLOY.md` is the actual runbook** (step-by-step, written
for that setup: existing nginx fronting it, not a bundled reverse proxy); this section
is the *why*, and the traps worth knowing about before redeploying or deploying
elsewhere.

- **`docker-compose.prod.yml` is deliberately standalone, not an override of
  `docker-compose.yml`.** Compose concatenates list fields like `ports` across `-f`
  layers instead of replacing them — an override trying to *remove* a port mapping
  (Postgres's, published in the dev file) could silently leave the original exposed
  anyway. One self-contained file you can read start to finish beats a layering trick,
  for something security-sensitive.
- **No bundled reverse proxy.** The original plan bundled Caddy for automatic HTTPS;
  dropped once it turned out the target VPS already runs nginx for other sites —
  Caddy would have fought it for ports 80/443. `app` binds to `127.0.0.1` only; the
  *existing* nginx proxies to it. If deploying somewhere with no existing reverse
  proxy, Caddy (or nginx from scratch) would need to come back.
- **TLS**: that box already uses `acme.sh` (ZeroSSL, HTTP-01 webroot validation, daily
  renewal cron) for its other domains — reused the same tool/pattern for the new
  subdomain rather than introducing a second cert-management approach.
  - **ZeroSSL's HTTP-01 validator failed twice in a row reaching the box, then
    succeeded minutes later with an unchanged command** — nginx was serving the
    challenge correctly the whole time (confirmed both by direct probe and by the
    access log never showing the validator's request arrive at all on the failed
    attempts). Read this as "mainland-China-hosted-IP reachability from CA validators
    can be flaky; a plain retry after a short wait is a legitimate first move," not as
    a sign the setup is wrong.
  - **Switching to Let's Encrypt surfaced a real, separate issue**: that domain's
    authoritative nameservers (Alibaba/`hichina` DNS) error (`REFUSED`/`SERVFAIL`) on
    CAA-type queries specifically — affects every subdomain equally, but only breaks
    issuance with CAs that hard-fail on a CAA lookup error (Let's Encrypt does,
    ZeroSSL evidently doesn't). Net effect: **stick with ZeroSSL** on this DNS setup;
    don't "fix" a ZeroSSL hiccup by switching CAs, that trades a transient problem for
    a structural one.
- **Docker Hub and the npm registry can both be unreachable/painfully slow from a
  mainland China VPS** — separate from the TLS/CAA issues above, same underlying
  network-reachability theme:
  - Base images (`pgvector/pgvector:pg18`, `node:24-slim`) were pulled through a
    working public mirror (`docker.m.daocloud.io`) and re-tagged locally to their
    expected names, rather than reconfiguring the Docker daemon (which would have
    needed a `dockerd` restart — and this box has `live-restore` disabled and at least
    one container with restart-policy `no`, meaning a daemon restart would have
    durably broken something unrelated, not just briefly blipped it).
  - `npm install` during the image build hung effectively indefinitely against the
    default registry (individual requests succeeded, just slowly — ~4s each — but the
    full install of ~230 packages never completed). Fixed properly, not just
    papered over on the box: `packages/server/Dockerfile` takes an `NPM_REGISTRY`
    build arg (default unchanged, `registry.npmjs.org`), wired through
    `docker-compose.prod.yml`'s `build.args` from a `.env` var — set it to
    `https://registry.npmmirror.com` (Alibaba's own, fast from an Aliyun VPS) only on
    hosts where it's needed.
  - Even with the mirror, that same `npm install` took ~8 minutes and pushed the box
    (1.7GB RAM, no swap configured beforehand) into heavy swap thrashing severe enough
    that new SSH connections couldn't complete the banner exchange — looked
    indistinguishable from a dead box for several minutes. It recovered on its own
    once the build finished; nothing crashed or got OOM-killed (all four pre-existing
    containers, including Vaultwarden, came through untouched). Added a 2GB swap file
    as a standing precaution — doesn't prevent slowness under this kind of memory
    pressure, but gives the kernel room to degrade gracefully instead of invoking the
    OOM killer. **Don't run a heavy build on a memory-constrained box that also hosts
    other real services without a swap safety net first.**
- **First sync of real data**: local dev's ~900 bookmarks were moved over with
  `pg_dump --data-only --disable-triggers` scoped to just the real data tables
  (`categories`, `projects`, `tags`, `bookmarks`, `bookmark_tags` — deliberately
  excluding the empty `bookmark_embeddings` table and the four job-history tables,
  which are ephemeral run logs tied to the dev session, not data worth carrying over),
  piped into the prod container's `psql`. Row counts and sequence `setval`s were
  verified to match exactly post-restore before trusting it.
- **Extension side**: AMO now requires new submissions to declare
  `browser_specific_settings.gecko.data_collection_permissions` (since Nov 2025) —
  missing it fails validation with no other explanation than "the property is
  missing." See the `packages/extension` section above for what's declared and why.
  **Firefox for Android** doesn't offer arbitrary/unlisted-extension install through
  its normal UI; the extension has to be signed via AMO's free "unlisted"
  self-distribution flow (automated, no human review) before even Nightly's hidden
  debug "install add-on from file" menu will accept it — a locally-built unsigned
  `.xpi` gets rejected outright ("not verified"). Installed successfully this way, but
  **has real compatibility issues on Android that are unresolved** — picking this back
  up is future work, not done.

## Open items

1. **Category-definition changes aren't reflected in browser sync.** See Browser sync
   above — renaming/deleting a zero-bookmark category produces no signal in the
   bookmark-keyed sync feed, so a stale folder can be left behind. Needs categories to
   carry their own `invalid`/`updatedAt` and a second feed the extension reconciles
   folder names against.
2. **Extension has real compatibility issues on Firefox for Android**, not yet
   diagnosed — see Deployment above. Next session's pickup.
3. **Semantic search / embedding provider** — never decided. See AI features item 6.
4. **Bulk import doesn't merge duplicates**, only skips them — see AI features item 5.
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

**VPS deploy**: see [`DEPLOY.md`](DEPLOY.md) — **not** the same `docker-compose.yml` as
local dev; use `docker-compose.prod.yml` (standalone, no published Postgres port,
`app` bound to `127.0.0.1` for an existing reverse proxy to reach). This is the one
place Docker is actually required. See Deployment above for the hard-won lessons from
the first real deploy (Postgres 18's volume-mount convention, CA/DNS/registry
reachability from a mainland China host, memory headroom) before doing it again.
