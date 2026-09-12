# Deploying to a VPS

This covers a first-time deploy of the self-hosted server + web app to a VPS via Docker
Compose, fronted by an **existing nginx** already running on that machine (for other
sites too) — this doesn't run its own reverse proxy or terminate TLS itself, it assumes
nginx does that and just needs to be pointed at the app container. It does not cover the
extension itself — that's installed per-browser from `packages/extension/dist` (or
signed and distributed however you prefer) and just needs to be pointed at whatever URL
you deploy this to.

Use `docker-compose.prod.yml`, not the root `docker-compose.yml` — that one is for local
dev only (it publishes Postgres's port straight to the host, fine on your own machine,
not on a public server). `docker-compose.prod.yml` is a separate, self-contained file
rather than an override layered on top of the dev one — Compose concatenates list fields
like `ports` across `-f` layers instead of replacing them, so an override trying to
*remove* a port mapping can silently leave the original exposed anyway. For something
security-sensitive like this, one file you can read start to finish is worth more than a
clever layering trick.

## What's in the prod stack

- `db` — Postgres + pgvector. No published port; only `app` can reach it, over the
  compose network.
- `app` — the Fastify server (also serves the built web app as static files at `/`).
  Published to `127.0.0.1` only — reachable from nginx on the same host, not from
  outside this machine. nginx is what actually terminates TLS and faces the internet.

## First-time setup

1. **Docker + Docker Compose** on the VPS (Compose v2, i.e. the `docker compose` plugin
   — the commands below assume that, not the standalone `docker-compose` binary).

2. **Clone the repo and check out the version you want:**

   ```bash
   git clone git@github.com:Jeromexsu/BookmarkManager.git
   cd BookmarkManager
   git checkout main
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
   | `APP_PORT`           | which port on `127.0.0.1` the app listens on for nginx to proxy to — defaults to `3001`; change it if that's already taken by something else on this VPS |
   | `NPM_REGISTRY`       | optional — only needed if the build's `npm install` step is slow or hangs (common on mainland China networks reaching `registry.npmjs.org`). Set to `https://registry.npmmirror.com` (Alibaba's own mirror, fast from an Aliyun VPS) or another mirror. |

   `POSTGRES_PORT` and `PORT` from `.env.example` aren't used by the prod stack — safe to
   leave them or delete them.

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

5. **Check it's up, directly, before involving nginx:**

   ```bash
   curl -I http://127.0.0.1:3001/api/categories
   ```

   (or whatever port you set `APP_PORT` to). A `200` means the server and Postgres are
   both healthy and migrated.

6. **Add an nginx server block** for the domain/subdomain you want this on, proxying to
   the app:

   ```nginx
   server {
       listen 443 ssl;
       server_name bookmarks.your-domain.example;

       # reuse however you already manage certs on this box, e.g.:
       # ssl_certificate     /etc/letsencrypt/live/bookmarks.your-domain.example/fullchain.pem;
       # ssl_certificate_key /etc/letsencrypt/live/bookmarks.your-domain.example/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   If you use certbot for other sites on this box, `certbot --nginx -d
   bookmarks.your-domain.example` will provision the cert and rewrite the `ssl_*` lines
   for you. Then:

   ```bash
   nginx -t && systemctl reload nginx
   ```

7. **Check it end-to-end:**

   ```bash
   curl -I https://bookmarks.your-domain.example/api/categories
   ```

8. **Point the extension at it.** In the extension's Settings page, set the Server URL
   to `https://bookmarks.your-domain.example`. That's the only client-side config there
   is.

## Security — read this before exposing it publicly

**There is no login, session, or API key on any endpoint.** CORS is wide open
(`origin: true`) and every route — read, write, delete — is reachable by anyone who can
reach it. This was built for local/LAN use; putting it behind a public domain means
putting a gate in front of it yourself. Options, roughly in order of effort:

- **Cheapest**: firewall the VPS (cloud security group or `ufw`) to only allow the
  relevant port from IPs you actually use. Works, but breaks the moment your IP changes.
- **Recommended for one user**: add HTTP Basic Auth in the nginx server block:

  ```nginx
  location / {
      auth_basic           "Bookmark Manager";
      auth_basic_user_file /etc/nginx/.htpasswd-bookmarks;
      proxy_pass http://127.0.0.1:3001;
      # ...the proxy_set_header lines from above...
  }
  ```

  Generate the password file with `htpasswd -c /etc/nginx/.htpasswd-bookmarks youruser`
  (from the `apache2-utils`/`httpd-tools` package). Every request — including the
  extension's — will need that username/password; set the extension's Server URL to
  `https://youruser:yourpass@bookmarks.your-domain.example` if your browser passes that
  through, otherwise check how your extension setup sends the auth header.
- **More robust**: put it behind a VPN (WireGuard/Tailscale) instead of a public domain
  at all — only reachable from devices on your VPN.

Pick at least one before you start actually using this from a phone or another machine
over the open internet.

## Upgrading later

```bash
git pull
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
