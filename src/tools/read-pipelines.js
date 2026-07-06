import { z } from 'zod';
import { Bitrix24Client } from '../bitrix24/client.js';
import { Bitrix24Reader } from '../bitrix24/reader.js';
import { resolveWebhook } from '../utils/resolve-webhook.js';

export const readPipelinesSchema = z.object({
  webhook_url: z.string().url().optional().describe('URL вебхука (опционально, если настроен по умолчанию)'),
  entity_type_id: z.number().int().optional().describe('ID типа сущности (опционально, по умолчанию: все)'),
});

export async function readPipelines({ webhook_url, entity_type_id }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const reader = new Bitrix24Reader(client);
  const pipelines = await reader.readPipelines(entity_type_id);

  const count = Object.keys(pipelines).length;
  const stageCount = Object.values(pipelines).reduce((acc, p) => acc + (p.stages?.length ?? 0), 0);

  return {
    portal: client.portal,
    pipelines,
    summary: `${count} воронок с ${stageCount} стадиями в общей сложности`,
  };
}
