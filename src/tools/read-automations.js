import { z } from 'zod';
import { Bitrix24Client } from '../bitrix24/client.js';
import { Bitrix24Reader } from '../bitrix24/reader.js';
import { resolveWebhook } from '../utils/resolve-webhook.js';

export const readAutomationsSchema = z.object({
  webhook_url: z.string().url().optional().describe('URL вебхука (опционально, если настроен по умолчанию)'),
  entity_type_id: z.number().int().optional().describe('ID типа сущности (опционально)'),
});

export async function readAutomations({ webhook_url, entity_type_id }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const reader = new Bitrix24Reader(client);
  const automations = await reader.readAutomations(entity_type_id);

  const totalRules = Object.values(automations).reduce((acc, rules) => acc + rules.length, 0);

  return {
    portal: client.portal,
    automations,
    stages_with_automations: Object.keys(automations).length,
    total_rules: totalRules,
    summary: `${totalRules} правил автоматизации в ${Object.keys(automations).length} стадиях`,
    note: 'Автоматизации ссылаются на пользователей по ID. Используйте b24_read_users и b24_save_user_mapping перед применением в другом инстансе.',
  };
}
