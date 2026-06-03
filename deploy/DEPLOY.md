# VPS deployment (Docker Compose + existing nginx)

Layout: each MCP server runs in Docker on its own local port (`127.0.0.1:800X`),
and the existing nginx proxies a **subdomain** to it over HTTPS. No Caddy needed —
nginx does the TLS (certbot).

This server: subdomain `btrx-mcp.texpertiza.ru`, port `8001`.
(The neighbor `kontur-mcp.texpertiza.ru` already uses `8000`.)

## 0. DNS

A record `btrx-mcp.texpertiza.ru` → VPS IP.

## 1. Code on the server

```bash
git clone <repo> /opt/bitrix24-mcp   # or copy the project folder
cd /opt/bitrix24-mcp
```

## 2. .env on the server

Create `/opt/bitrix24-mcp/.env`:

```
# Bitrix24 incoming webhook (credential SHARED by all authorized users).
B24_DEFAULT_WEBHOOK=https://your-portal.bitrix24.com/rest/1/your-token/

B24_TRANSPORT=http
B24_HOST=0.0.0.0
B24_PORT=8001
B24_PUBLIC_URL=https://btrx-mcp.texpertiza.ru
B24_GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com
B24_GOOGLE_CLIENT_SECRET=GOCSPX-<...>
B24_ALLOWED_EMAILS=manager.ges.07@gmail.com
```

> `B24_PUBLIC_URL` with no trailing slash. The redirect URI in Google must be
> exactly `https://btrx-mcp.texpertiza.ru/auth/callback`.
>
> ⚠️ Every email in `B24_ALLOWED_EMAILS` shares the SAME Bitrix24 webhook and can
> run any REST method (including `b24_call`). The allowlist is the only barrier of
> who may use that webhook — keep it short.

## 3. Build and run

```bash
docker compose up -d --build
docker compose logs -f bitrix24-mcp    # wait for "HTTP MCP listening on 0.0.0.0:8001"
docker compose ps                      # STATUS should become (healthy) in ~10-40s
curl -s http://127.0.0.1:8001/health   # {"status":"ok"}
```

`/health` is public (no OAuth) to check the server is alive; the healthcheck in
`docker-compose.yml` uses it too. The MCP protocol is served at the ROOT (`/`),
so the connector URL has **no `/mcp`** (see step 6).

The port is bound to `127.0.0.1` — not published outward, only nginx reaches it.

## 4. nginx + TLS

```bash
sudo cp deploy/nginx-mcp.conf /etc/nginx/sites-available/bitrix24-mcp
sudo ln -s /etc/nginx/sites-available/bitrix24-mcp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d btrx-mcp.texpertiza.ru
```

## 5. Google OAuth

The SAME Google OAuth project/client as `kontur-mcp` is reused — no need to create
a new app. In Google Cloud Console, on that OAuth client:

- Authorized redirect URIs: **add** `https://btrx-mcp.texpertiza.ru/auth/callback`
  (alongside the kontur one, without removing it).
- Consent screen: External, Testing mode, with the emails in Test users.

## 6. Connect in Claude

Claude → **Settings → Connectors** → Add custom connector →
URL `https://btrx-mcp.texpertiza.ru` (domain root, **no `/mcp`**).
Complete the Google login. An email outside `B24_ALLOWED_EMAILS` gets a 403.

---

## Several MCP servers on one VPS

Model: **subdomain + local port per server** (not paths on a single domain —
otherwise the OAuth `/.well-known/*` and `/auth/callback` would collide at the root).

To add another MCP server:
1. **Port:** give it its own (`127.0.0.1:8002`, …).
2. **DNS:** A record for the new subdomain → VPS IP.
3. **nginx:** copy `nginx-mcp.conf`, change `server_name` and `proxy_pass` (port),
   then `certbot --nginx -d <new-subdomain>`.
4. **OAuth:** in the same Google app add another redirect URI
   `https://<new-subdomain>/auth/callback` — no separate app needed.
5. **Claude:** add the connector `https://<new-subdomain>`.

## Security

**`.env` permissions** (it holds the Bitrix webhook and the Google secret):
```bash
chmod 600 /opt/bitrix24-mcp/.env
```
`.env` is not committed (it's in `.gitignore`) and not baked into the image — it's
passed at runtime via `env_file`. The process runs as the non-privileged `appuser`.

**Firewall (ufw):** outward only SSH and web; the container ports (8000+) stay
closed — and they only listen on `127.0.0.1` anyway.

## Updating a version

```bash
cd /opt/bitrix24-mcp && git pull
docker compose up -d --build
```

## Troubleshooting

- `docker compose logs -f bitrix24-mcp` — server logs.
- nginx 502 → the container didn't start / crashed (`docker compose ps`).
- OAuth doesn't pass → exact redirect URI match and email in `B24_ALLOWED_EMAILS`.
- After a container restart the (in-memory) tokens are invalidated: you must
  reconnect / re-login in Claude. This is expected.
