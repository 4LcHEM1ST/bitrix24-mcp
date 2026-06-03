// Configuración del servidor: carga y validación de variables de entorno.
//
// Dos transportes (B24_TRANSPORT):
//   - stdio (por defecto) — ejecución local junto a Claude Desktop, sin auth;
//   - http — servidor remoto con OAuth (Google) y lista blanca de emails.

function parseEmails(raw) {
  return (raw || '')
    .replace(/;/g, ',')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function envInt(name, def) {
  const raw = (process.env[name] || '').trim();
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? def : n;
}

export function loadConfig() {
  const transport = (process.env.B24_TRANSPORT || 'stdio').trim().toLowerCase() || 'stdio';

  const config = {
    transport,
    host: (process.env.B24_HOST || '127.0.0.1').trim() || '127.0.0.1',
    port: envInt('B24_PORT', 8001),
    // Sin barra final: el redirect URI se construye como `${publicUrl}/auth/callback`.
    publicUrl: (process.env.B24_PUBLIC_URL || '').trim().replace(/\/+$/, ''),
    googleClientId: (process.env.B24_GOOGLE_CLIENT_ID || '').trim(),
    googleClientSecret: (process.env.B24_GOOGLE_CLIENT_SECRET || '').trim(),
    allowedEmails: parseEmails(process.env.B24_ALLOWED_EMAILS),
    defaultWebhook: (process.env.B24_DEFAULT_WEBHOOK || '').trim(),
  };

  if (config.transport === 'http') {
    const missing = [];
    if (!config.publicUrl) missing.push('B24_PUBLIC_URL');
    if (!config.googleClientId) missing.push('B24_GOOGLE_CLIENT_ID');
    if (!config.googleClientSecret) missing.push('B24_GOOGLE_CLIENT_SECRET');
    if (missing.length) {
      throw new Error(`Para B24_TRANSPORT=http faltan variables: ${missing.join(', ')}`);
    }
    // OAuth garantiza que el usuario entró por Google, pero NO limita quién. La lista
    // blanca es la única barrera de acceso; sin ella el servidor dejaría entrar a
    // cualquier usuario de Google. Por eso en modo http es obligatoria.
    if (config.allowedEmails.length === 0) {
      throw new Error(
        'B24_ALLOWED_EMAILS está vacío: en modo http la lista blanca de emails es ' +
          'obligatoria, de lo contrario el servidor dejaría entrar a cualquier usuario de Google.'
      );
    }
  }

  return config;
}
