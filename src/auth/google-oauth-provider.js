// Proveedor OAuth para el servidor MCP, con Google como identidad de upstream.
//
// El SDK de MCP exige que el servidor actúe como Authorization Server frente al
// cliente (Claude): Dynamic Client Registration, /authorize, /token y metadatos.
// Google NO soporta DCR, así que NO podemos simplemente proxyear a Google. En su
// lugar este proveedor ES el AS para Claude y, por dentro, usa Google para
// autenticar al usuario real (mismo enfoque que el GoogleProvider de FastMCP).
//
// Flujo: authorize() redirige a Google → /auth/callback intercambia el code,
// extrae el email y lo valida contra la lista blanca → recién entonces se emite
// NUESTRO authorization code → /token lo canjea por access + refresh token.
//
// Almacenamiento in-memory: suficiente para un VPS de un solo proceso. Tras
// reiniciar el contenedor los tokens se pierden y el usuario vuelve a entrar
// (Claude redescubre y vuelve a registrarse automáticamente).

import { randomUUID } from 'node:crypto';
import axios from 'axios';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

// TTLs (segundos). Access corto + refresh largo: si roban un access token, su
// ventana de uso es chica; la sesión se mantiene viva vía refresh (rotado).
const PENDING_TTL = 10 * 60; // flujo a Google en curso
const CODE_TTL = 5 * 60; // authorization code (single-use)
const ACCESS_TTL = 60 * 60; // access token
const REFRESH_TTL = 30 * 24 * 60 * 60; // refresh token
const SWEEP_INTERVAL_MS = 60 * 1000;

const now = () => Math.floor(Date.now() / 1000);

// Decodifica el payload de un JWT (id_token de Google) SIN verificar la firma.
// Es seguro en este flujo: el id_token llega por el canal servidor↔Google (TLS)
// como respuesta directa a NUESTRO intercambio de code (OIDC code flow, §3.1.3.7),
// no desde el cliente. Aun así validamos los claims (iss/aud/exp) abajo.
function decodeJwtPayload(jwt) {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('id_token mal formado');
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

class InMemoryClientsStore {
  constructor() {
    this.clients = new Map();
  }

  getClient(clientId) {
    return this.clients.get(clientId);
  }

  // DCR (RFC 7591): Claude se registra al inicio del flujo. Generamos el
  // client_id; al ser cliente público con PKCE no emitimos client_secret.
  registerClient(client) {
    const clientId = randomUUID();
    const full = {
      ...client,
      client_id: clientId,
      client_id_issued_at: now(),
    };
    this.clients.set(clientId, full);
    return full;
  }
}

export class GoogleOAuthProvider {
  /** @param {{publicUrl:string, googleClientId:string, googleClientSecret:string, allowedEmails:string[]}} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.allowed = new Set(cfg.allowedEmails.map((e) => e.trim().toLowerCase()));
    this.redirectUri = `${cfg.publicUrl}/auth/callback`;

    this.clientsStore = new InMemoryClientsStore();
    this._pending = new Map(); // state(Google) -> { client, params, expiresAt }
    this._codes = new Map(); // nuestro code -> { client, params, email, expiresAt }
    this._tokens = new Map(); // access_token  -> { clientId, scopes, email, expiresAt }
    this._refresh = new Map(); // refresh_token -> { clientId, scopes, email, expiresAt }

    // Barrido periódico: evita que los Map crezcan sin límite con flujos
    // abandonados o tokens vencidos. unref() para no mantener vivo el proceso.
    this._sweepTimer = setInterval(() => this._sweep(), SWEEP_INTERVAL_MS);
    if (this._sweepTimer.unref) this._sweepTimer.unref();
  }

  _sweep() {
    const t = now();
    for (const map of [this._pending, this._codes, this._tokens, this._refresh]) {
      for (const [key, val] of map) {
        if (val.expiresAt <= t) map.delete(key);
      }
    }
  }

  // Valida los claims del id_token de Google y devuelve el email verificado.
  _emailFromIdToken(idToken) {
    const claims = decodeJwtPayload(idToken);
    if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error('id_token: issuer inesperado');
    if (claims.aud !== this.cfg.googleClientId) throw new Error('id_token: aud no coincide');
    if (typeof claims.exp !== 'number' || claims.exp <= now()) throw new Error('id_token expirado');
    // email_verified puede venir como booleano o string "true".
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
      throw new Error('id_token: email no verificado');
    }
    return (claims.email || '').trim().toLowerCase();
  }

  // Emite access + refresh para un usuario ya autenticado y autorizado.
  _issueTokens(clientId, scopes, email) {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    this._tokens.set(accessToken, { clientId, scopes, email, expiresAt: now() + ACCESS_TTL });
    this._refresh.set(refreshToken, { clientId, scopes, email, expiresAt: now() + REFRESH_TTL });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TTL,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  // Paso /authorize: en vez de mostrar login propio, redirigimos a Google.
  // `params` ya viene parseado por el SDK: { redirectUri, codeChallenge, scopes?, state?, resource? }.
  async authorize(client, params, res) {
    const googleState = randomUUID();
    this._pending.set(googleState, { client, params, expiresAt: now() + PENDING_TTL });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', this.cfg.googleClientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', googleState);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
    res.redirect(url.toString());
  }

  // Lo llama el route GET /auth/callback. Devuelve { redirectUrl } para reenviar
  // a Claude, o { error, email } si el email no está autorizado.
  async handleGoogleCallback(query) {
    const { code, state, error: googleError } = query;
    if (googleError) throw new Error(`Google devolvió un error: ${googleError}`);
    if (!code || !state) throw new Error('Faltan parámetros code/state en el callback');

    const pending = this._pending.get(state);
    if (!pending || pending.expiresAt <= now()) throw new Error('state desconocido o expirado');
    this._pending.delete(state);

    // Intercambio code → tokens de Google (incluye id_token con el email).
    const body = new URLSearchParams({
      code,
      client_id: this.cfg.googleClientId,
      client_secret: this.cfg.googleClientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });
    const resp = await axios.post(GOOGLE_TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const idToken = resp.data?.id_token;
    if (!idToken) throw new Error('Google no devolvió id_token');

    const email = this._emailFromIdToken(idToken);

    // Lista blanca: única barrera de quién puede usar el webhook compartido.
    if (!email || !this.allowed.has(email)) {
      return { error: 'forbidden', email };
    }

    // Email autorizado → emitimos NUESTRO authorization code, ligado al PKCE
    // challenge original y al cliente que inició el flujo.
    const { client, params } = pending;
    const ourCode = randomUUID();
    this._codes.set(ourCode, { client, params, email, expiresAt: now() + CODE_TTL });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set('code', ourCode);
    if (params.state !== undefined) redirectUrl.searchParams.set('state', params.state);
    return { redirectUrl: redirectUrl.toString() };
  }

  // El SDK usa esto para validar el PKCE verifier contra el challenge guardado.
  async challengeForAuthorizationCode(client, authorizationCode) {
    const data = this._codes.get(authorizationCode);
    if (!data || data.expiresAt <= now() || data.client.client_id !== client.client_id) {
      throw new Error('authorization code inválido');
    }
    return data.params.codeChallenge;
  }

  // Paso /token (grant authorization_code): canjeamos nuestro code (single-use).
  async exchangeAuthorizationCode(client, authorizationCode /*, codeVerifier, redirectUri, resource */) {
    const data = this._codes.get(authorizationCode);
    if (!data || data.expiresAt <= now() || data.client.client_id !== client.client_id) {
      throw new Error('authorization code inválido');
    }
    this._codes.delete(authorizationCode); // single-use
    return this._issueTokens(client.client_id, data.params.scopes || [], data.email);
  }

  // Paso /token (grant refresh_token): renueva la sesión sin re-login. Rotamos el
  // refresh token (invalidamos el anterior) como buena práctica.
  async exchangeRefreshToken(client, refreshToken /*, scopes, resource */) {
    const data = this._refresh.get(refreshToken);
    if (!data || data.expiresAt <= now() || data.clientId !== client.client_id) {
      throw new Error('refresh token inválido');
    }
    // Si el email salió de la lista blanca, cortamos la sesión aquí.
    if (!this.allowed.has(data.email)) {
      this._refresh.delete(refreshToken);
      throw new Error('cuenta ya no autorizada');
    }
    this._refresh.delete(refreshToken); // rotación
    return this._issueTokens(client.client_id, data.scopes, data.email);
  }

  // Lo invoca requireBearerAuth en cada request MCP. Devuelve AuthInfo o lanza (→401).
  async verifyAccessToken(token) {
    const data = this._tokens.get(token);
    if (!data) throw new Error('token inválido');
    if (data.expiresAt <= now()) {
      this._tokens.delete(token);
      throw new Error('token expirado');
    }
    // Defensa en profundidad: si el email se quitó de la lista blanca, el token
    // deja de servir de inmediato (no hay que esperar a que expire).
    if (!this.allowed.has(data.email)) {
      this._tokens.delete(token);
      throw new Error('cuenta ya no autorizada');
    }
    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: data.expiresAt,
      extra: { email: data.email },
    };
  }
}
