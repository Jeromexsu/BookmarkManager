# Deploying to a VPS

This covers a first-time deploy of the self-hosted server + web app to a plain VPS via
Docker Compose. It does not cover the extension itself — that's installed per-browser
from `packages/extension/dist` (or signed and distributed however you prefer) and just
needs to be pointed at whatever URL you deploy this to.

Use `docker-compose.prod.yml`, not the root `docker-compose.yml` — that one is for local
dev only (it publishes Postgres's port straight to the host and has no TLS story, both
fine on your own machine, neither fine on a public server). `docker-compose.prod.yml` is
a separate, self-contained file rather than an override layered on top of the dev one —
Compose concatenates list fields like `ports` across `-f` layers instead of replacing
them, so an override trying to *remove* a port mapping can silently leave the original
exposed anyway. For something security-sensitive like this, one file you can read start
to finish is worth more than a clever layering trick.

## What's in the prod stack

- `db` — Postgres + pgvector. No published port; only `app` can reach it, over the
  compose network.
- `app` — the Fastify server (also serves the built web app as static files at `/`).
  Not published to the host either — only reachable from `caddy`.
- `caddy` — reverse proxy on 80/443. With a real domain in `DOMAIN`, it gets you
  automatic Let's Encrypt HTTPS for free. Without one, it falls back to plain HTTP on
  `localhost` — enough to kick the tires by IP, not something to leave running for real
  use (the app has **no authentication of its own** — see Security below).

## First-time setup

1. **Docker + Docker Compose** on the VPS (Compose v2, i.e. the `docker compose` plugin
   — the commands below assume that, not the standalone `docker-compose` binary).

2. **Clone the repo and check out the version you want:**

   ```bash
   git clone git@github.com:Jeromexsu/BookmarkManager.git
   cd BookmarkManager
   git checkout v0.1.0
   ```

3. **Create a `.env`** at the repo root (this is read by Compose itself for variable
   substitution — it's separate from `packages/server/.env`, which is only used when
   running the server outside Docker):

   ```bash
   cp .env.example .env
   ```

   Then edit it:

   | Variable            | Notes                                                                 |
   | -------------------- | --------------------------------------------------------------------- |
   | `POSTGRES_USER`      | anything                                                              |
   | `POSTGRES_PASSWORD`  | pick a real one — this database is not exposed, but don't phone it in |
   | `POSTGRES_DB`        | anything                                                              |
   | `DEEPSEEK_API_KEY`   | required for tagging, auto-fill, auto-categorize, category planning — the app runs without it, but every AI-backed feature will error |
   | `DOMAIN`             | your domain, pointed at this VPS (A/AAAA record) — enables automatic HTTPS. Leave unset only for a quick IP-based smoke test. |

   `POSTGRES_PORT` and `PORT` from `.env.example` aren't used by the prod stack (nothing
   publishes those ports) — safe to leave them or delete them.

4. **Bring up the database first, then migrate, then start the app:**

   ```bash
   docker compose -f docker-compose.prod.yml up -d db
   docker compose -f docker-compose.prod.yml run --rm app node packages/server/dist/db/migrate.js
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   The middle step matters and is easy to get wrong: `npm run db:migrate` shells out to
   `tsx src/db/migrate.ts`, but the runtime image only contains the compiled `dist/`
   output, not `src/` or `tsx` — that command will fail inside the container. Run the
   compiled file directly, as above, instead.

5. **Check it's actually up:**

   ```bash
   curl -I https://your-domain.example/api/categories
   ```

   A `200` means the server and Postgres are both healthy and migrated. If you left
   `DOMAIN` unset, use `http://<vps-ip>/api/categories` instead.

6. **Point the extension at it.** In the extension's Settings page, set the Server URL
   to `https://your-domain.example` (or the IP for a quick test). That's the only
   client-side config there is.

## Security — read this before exposing it publicly

**There is no login, session, or API key on any endpoint.** CORS is wide open
(`origin: true`) and every route — read, write, delete — is reachable by anyone who can
reach the port. This was built for local/LAN use; putting it on a VPS with a public IP
means putting a gate in front of it yourself. Options, roughly in order of effort:

- **Cheapest**: firewall the VPS (cloud security group or `ufw`) to only allow 80/443
  from IPs you actually use. Works, but breaks the moment your IP changes.
- **Recommended for one user**: add HTTP Basic Auth in front, in Caddy. Add this inside
  the site block in `Caddyfile`:

  ```
  basic_auth {
      youruser JDJhJDEwJC4uLi5oYXNoLi4u
  }
  ```

  Generate the hash with `docker run --rm caddy:2-alpine caddy hash-password`. Every
  request — including the extension's — will need that username/password, so you'd add
  it to the extension's Server URL as `https://youruser:yourpass@your-domain.example`
  or otherwise configure it to send the header; check what your browser/extension setup
  actually supports before relying on this.
- **More robust**: put it behind a VPN (WireGuard/Tailscale) and don't expose 80/443 to
  the public internet at all — only reachable from devices on your VPN.

Pick at least one before you start actually using this from a phone or another machine
over the open internet.

## Upgrading later

```bash
git pull
git checkout <new-tag>
docker compose -f docker-compose.prod.yml run --rm app node packages/server/dist/db/migrate.js
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations are additive (Drizzle tracks what's already applied), so running the migrate
step on every upgrade is always safe even if nothing changed.

## Backups

Postgres data lives in the `db-data` named volume. A quick logical backup:

```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

Run that on a cron schedule and copy `backup.sql` off the VPS — a volume backup alone
doesn't help if the VPS itself is what's lost.
