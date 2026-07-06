export function resolveWebhook(webhookParam) {
  const url = webhookParam || process.env.B24_DEFAULT_WEBHOOK;
  if (!url) {
    throw new Error(
      'Не указан webhook_url и не настроен B24_DEFAULT_WEBHOOK. ' +
      'Укажите вебхук в параметре webhook_url или задайте его в настройках MCP-сервера.'
    );
  }
  return url;
}
