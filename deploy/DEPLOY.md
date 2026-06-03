# Despliegue en VPS (Docker Compose + nginx existente)

Esquema: cada servidor MCP corre en Docker en su puerto local (`127.0.0.1:800X`),
y el nginx existente proxya hacia él un **subdominio** por HTTPS. No hace falta
Caddy — el TLS lo hace nginx (certbot).

Este servidor: subdominio `btrx-mcp.texpertiza.ru`, puerto `8001`.
(El vecino `kontur-mcp.texpertiza.ru` ya usa el `8000`.)

## 0. DNS

Registro A `btrx-mcp.texpertiza.ru` → IP del VPS.

## 1. Código al servidor

```bash
git clone <repo> /opt/bitrix24-mcp   # o copiá la carpeta del proyecto
cd /opt/bitrix24-mcp
```

## 2. .env en el servidor

Creá `/opt/bitrix24-mcp/.env`:

```
# Webhook entrante de Bitrix24 (credencial COMPARTIDA por todos los usuarios autorizados).
B24_DEFAULT_WEBHOOK=https://tu-portal.bitrix24.com/rest/1/tu-token/

B24_TRANSPORT=http
B24_HOST=0.0.0.0
B24_PORT=8001
B24_PUBLIC_URL=https://btrx-mcp.texpertiza.ru
B24_GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com
B24_GOOGLE_CLIENT_SECRET=GOCSPX-<...>
B24_ALLOWED_EMAILS=manager.ges.07@gmail.com
```

> `B24_PUBLIC_URL` sin barra final. El redirect URI en Google debe ser
> exactamente `https://btrx-mcp.texpertiza.ru/auth/callback`.
>
> ⚠️ Todos los emails de `B24_ALLOWED_EMAILS` comparten el MISMO webhook de
> Bitrix24 y pueden ejecutar cualquier método REST (incluido `b24_call`). La lista
> blanca es la única barrera de quién puede usar ese webhook — mantenela corta.

## 3. Build y arranque

```bash
docker compose up -d --build
docker compose logs -f bitrix24-mcp    # esperá "HTTP MCP escuchando en 0.0.0.0:8001"
docker compose ps                      # STATUS debe pasar a (healthy) en ~10-40s
curl -s http://127.0.0.1:8001/health   # {"status":"ok"}
```

`/health` es público (sin OAuth) para chequear que el server vive; lo usa el
healthcheck de `docker-compose.yml`. El protocolo MCP se sirve en la RAÍZ (`/`),
por eso la URL del conector va **sin `/mcp`** (ver paso 6).

El puerto está atado a `127.0.0.1` — no se publica hacia afuera, solo accede nginx.

## 4. nginx + TLS

```bash
sudo cp deploy/nginx-mcp.conf /etc/nginx/sites-available/bitrix24-mcp
sudo ln -s /etc/nginx/sites-available/bitrix24-mcp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d btrx-mcp.texpertiza.ru
```

## 5. Google OAuth

Se reutiliza el MISMO proyecto/cliente OAuth que `kontur-mcp` — no hace falta
crear una app nueva. En Google Cloud Console, en ese cliente OAuth:

- Authorized redirect URIs: **agregar** `https://btrx-mcp.texpertiza.ru/auth/callback`
  (junto al de kontur, sin borrarlo).
- Consent screen: External, modo Testing, con los emails en Test users.

## 6. Conexión en Claude

Claude → **Settings → Connectors** → Add custom connector →
URL `https://btrx-mcp.texpertiza.ru` (raíz del dominio, **sin `/mcp`**).
Completá el login con Google. Un email fuera de `B24_ALLOWED_EMAILS` recibe 403.

---

## Varios MCP en un mismo VPS

Modelo: **subdominio + puerto local por servidor** (no rutas en un mismo dominio —
si no, los `/.well-known/*` y `/auth/callback` del OAuth chocarían en la raíz).

Para sumar otro servidor MCP:
1. **Puerto:** asignale el suyo (`127.0.0.1:8002`, …).
2. **DNS:** registro A del nuevo subdominio → IP del VPS.
3. **nginx:** copiá `nginx-mcp.conf`, cambiá `server_name` y `proxy_pass` (puerto),
   luego `certbot --nginx -d <nuevo-subdominio>`.
4. **OAuth:** en la misma app de Google agregá otro redirect URI
   `https://<nuevo-subdominio>/auth/callback` — no hace falta app aparte.
5. **Claude:** agregá el conector `https://<nuevo-subdominio>`.

## Seguridad

**Permisos del `.env`** (tiene el webhook de Bitrix y el secret de Google):
```bash
chmod 600 /opt/bitrix24-mcp/.env
```
`.env` no se commitea (está en `.gitignore`) y no se hornea en la imagen — se pasa
en runtime vía `env_file`. El proceso corre como usuario no privilegiado `appuser`.

**Firewall (ufw):** hacia afuera solo SSH y web; los puertos de los contenedores
(8000+) quedan cerrados — además solo escuchan en `127.0.0.1`.

## Actualización de versión

```bash
cd /opt/bitrix24-mcp && git pull
docker compose up -d --build
```

## Diagnóstico

- `docker compose logs -f bitrix24-mcp` — logs del servidor.
- 502 de nginx → el contenedor no arrancó/cayó (`docker compose ps`).
- OAuth no pasa → coincidencia exacta del redirect URI y email en `B24_ALLOWED_EMAILS`.
- Tras reiniciar el contenedor, los tokens (in-memory) se invalidan: hay que
  reconectar/reloguear en Claude. Es esperado.
