// Servidor HTTP (modo remoto): expone el MCP por Streamable HTTP detrás de OAuth.
//
// El endpoint MCP vive en la RAÍZ ("/"): Claude (remote connector) envía tanto el
// flujo OAuth como el protocolo MCP desde la raíz del dominio. Los metadatos OAuth
// y /authorge /token /register los monta mcpAuthRouter en sus rutas propias.

import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

import { GoogleOAuthProvider } from './auth/google-oauth-provider.js';
import { registerTools } from '../index.js';

// Página mínima para el caso "tu cuenta no está autorizada".
function forbiddenPage(email) {
  const who = email ? ` (${email})` : '';
  return `<!doctype html><html lang="es"><meta charset="utf-8">
<title>Acceso denegado</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;line-height:1.5">
<h1>Acceso denegado</h1>
<p>Tu cuenta de Google${who} no está en la lista de usuarios autorizados de este servidor MCP.</p>
<p>Pedí al administrador que agregue tu email a <code>B24_ALLOWED_EMAILS</code>.</p>
</body></html>`;
}

export async function startHttpServer(config) {
  const provider = new GoogleOAuthProvider(config);
  const baseUrl = new URL(config.publicUrl);
  const resourceMetadataUrl = new URL('/.well-known/oauth-protected-resource', baseUrl).href;

  const app = express();
  app.use(
    cors({
      origin: true,
      exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
    })
  );
  // Límite alto: tools como b24_apply_config envían JSON de configuración grandes.
  app.use(express.json({ limit: '10mb' }));

  // Healthcheck público (sin auth): lo usa el healthcheck de Docker.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Endpoints OAuth como Authorization Server frente a Claude:
  // /.well-known/*, /authorize, /token, /register.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: baseUrl,
      baseUrl,
      resourceServerUrl: baseUrl,
      scopesSupported: ['openid', 'email'],
      resourceName: 'Bitrix24 MCP',
    })
  );

  // Vuelta desde Google: validamos el email y reenviamos a Claude (o 403).
  app.get('/auth/callback', async (req, res) => {
    try {
      const result = await provider.handleGoogleCallback(req.query);
      if (result.error === 'forbidden') {
        return res.status(403).type('html').send(forbiddenPage(result.email));
      }
      return res.redirect(result.redirectUrl);
    } catch (err) {
      return res.status(400).type('html').send(`<h1>Error de autenticación</h1><p>${err.message}</p>`);
    }
  });

  // Endpoint MCP en la raíz, protegido por Bearer. Patrón stateless: un McpServer
  // y un transport nuevos por request, que se cierran al terminar la respuesta.
  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl });

  app.post('/', bearer, async (req, res) => {
    const server = new McpServer({ name: 'bitrix24-config', version: '2.0.0' });
    registerTools(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: `Internal server error: ${err.message}` },
          id: null,
        });
      }
    }
  });

  // En modo stateless no hay stream SSE servidor→cliente ni sesión que borrar.
  const methodNotAllowed = (_req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  app.get('/', bearer, methodNotAllowed);
  app.delete('/', bearer, methodNotAllowed);

  await new Promise((resolve) => {
    app.listen(config.port, config.host, resolve);
  });
  process.stderr.write(
    `[bitrix24] HTTP MCP escuchando en ${config.host}:${config.port} | OAuth Google | ` +
      `${provider.allowed.size} email(s) en lista blanca\n`
  );
}
