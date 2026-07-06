import { z } from 'zod';
import { Bitrix24Client } from '../bitrix24/client.js';
import { resolveWebhook } from '../utils/resolve-webhook.js';

export const callSchema = z.object({
  method: z.string().describe(
    'REST-метод Bitrix24. Примеры: crm.deal.list, tasks.task.add, disk.folder.getchildren, im.notify.personal.add'
  ),
  params: z.record(z.any()).optional().default({}).describe(
    'Параметры метода в виде JSON-объекта. Пример: { "filter": { "STAGE_ID": "WON" }, "select": ["ID","TITLE"] }'
  ),
  webhook_url: z.string().url().optional().describe('Опциональный вебхук, используется значение по умолчанию, если не указано'),
});

export async function universalCall({ method, params = {}, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const response = await client.call(method, params);
  return {
    method,
    portal: client.portal,
    result: response.result,
    total: response.total ?? null,
    next: response.next ?? null,
  };
}

// ─── Batch ────────────────────────────────────────────────────────────────────

export const batchSchema = z.object({
  calls: z.record(z.object({
    method: z.string(),
    params: z.record(z.any()).optional().default({}),
  })).describe(
    'Объект, где каждый ключ — это алиас, а значение — { method, params }. ' +
    'Параметры могут ссылаться на предыдущие результаты через $result[alias][поле]. ' +
    'Пример: { "deals": { "method": "crm.deal.list", "params": { "filter": { "STAGE_ID": "NEW" } } } }'
  ),
  webhook_url: z.string().url().optional(),
});

export async function universalBatch({ calls, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));

  // Bitrix24 batch format
  const cmd = {};
  for (const [alias, call] of Object.entries(calls)) {
    const paramStr = Object.entries(call.params || {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`)
      .join('&');
    cmd[alias] = `${call.method}?${paramStr}`;
  }

  const response = await client.call('batch', { cmd, halt: 0 });
  return {
    portal: client.portal,
    result: response.result?.result ?? response.result,
    errors: response.result?.result_error ?? {},
    total: response.result?.result_total ?? {},
  };
}
