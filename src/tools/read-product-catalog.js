import { z } from 'zod';
import { Bitrix24Client } from '../bitrix24/client.js';
import { Bitrix24Reader } from '../bitrix24/reader.js';
import { resolveWebhook } from '../utils/resolve-webhook.js';

export const readProductCatalogSchema = z.object({
  webhook_url: z.string().url().optional().describe('URL вебхука (опционально, если настроен по умолчанию)'),
});

export async function readProductCatalog({ webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const reader = new Bitrix24Reader(client);
  const catalog = await reader.readProductCatalog();

  if (catalog.error) {
    return { portal: client.portal, error: catalog.error };
  }

  return {
    portal: client.portal,
    product_catalog: catalog,
    summary: [
      `${catalog.catalogs?.length ?? 0} каталогов`,
      `${catalog.sections?.length ?? 0} разделов`,
      `${catalog.properties?.length ?? 0} свойств`,
      `${catalog.measures?.length ?? 0} единиц измерения`,
      `${catalog.price_types?.length ?? 0} типов цен`,
    ].join(', '),
  };
}
