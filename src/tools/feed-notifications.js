import { z } from 'zod';
import { Bitrix24Client } from '../bitrix24/client.js';
import { fetchAllPages } from '../utils/pagination.js';
import { resolveWebhook } from '../utils/resolve-webhook.js';

// ─── FEED POST ────────────────────────────────────────────────────────────────

export const feedPostSchema = z.object({
  message: z.string().describe('Текст сообщения. Поддерживает BB-code: [B]жирный[/B], [I]курсив[/I], [URL=http://...]текст[/URL]'),
  title: z.string().optional().describe('Заголовок публикации (опционально)'),
  destination: z.array(z.union([z.string(), z.number()])).optional().describe(
    'ID пользователей или рабочих групп назначения. Если пусто, публикуется для всех. ' +
    'Формат: ["U5", "U10"] для пользователей, ["SG12"] для рабочих групп'
  ),
  files: z.array(z.string()).optional().describe('Вложения в формате Base64'),
  important: z.boolean().optional().default(false).describe('Если true, помечает публикацию как важную'),
  webhook_url: z.string().url().optional(),
});

export async function feedPost({ message, title, destination, files, important = false, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const res = await client.call('log.blogpost.add', {
    POST_MESSAGE: message,
    ...(title ? { POST_TITLE: title } : {}),
    ...(destination ? { DESTINATION: destination } : {}),
    ...(files ? { FILES: files } : {}),
    IMPORTANT: important ? 'Y' : 'N',
  });
  return { portal: client.portal, post_id: res.result, success: true };
}

// ─── NOTIFY SEND ──────────────────────────────────────────────────────────────

export const notifySendSchema = z.object({
  to: z.union([z.string(), z.number()]).describe('ID пользователя-получателя'),
  message: z.string().describe('Текст уведомления'),
  type: z.enum(['SYSTEM', 'CONFIRM', 'LINES']).optional().default('SYSTEM').describe(
    'Тип: SYSTEM (простое уведомление), CONFIRM (с кнопками подтвердить/отклонить), LINES (Open Lines)'
  ),
  tag: z.string().optional().describe('Тег для группировки или замены предыдущих уведомлений с тем же тегом'),
  webhook_url: z.string().url().optional(),
});

export async function notifySend({ to, message, type = 'SYSTEM', tag, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const res = await client.call('im.notify.personal.add', {
    USER_ID: to,
    MESSAGE: message,
    TYPE: type,
    ...(tag ? { TAG: tag } : {}),
  });
  return { portal: client.portal, notify_id: res.result, success: true };
}

// ─── WORKGROUPS ───────────────────────────────────────────────────────────────

export const groupsListSchema = z.object({
  filter: z.record(z.any()).optional().default({}).describe(
    'Фильтры. Пример: { "ACTIVE": "Y", "VISIBLE": "Y" }. ' +
    'Поля: NAME, ACTIVE, VISIBLE, OPENED, PROJECT'
  ),
  select: z.array(z.string()).optional(),
  webhook_url: z.string().url().optional(),
});

export async function groupsList({ filter = {}, select, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const groups = await fetchAllPages(client, 'sonet_group.get', {
    filter,
    ...(select ? { select } : {}),
  });
  return { portal: client.portal, total: groups.length, groups };
}

// ─── CHAT MESSAGES ────────────────────────────────────────────────────────────

export const chatSendSchema = z.object({
  dialog_id: z.union([z.string(), z.number()]).describe(
    'ID чата. Для личного сообщения: "userId_НОМЕР" или числовой ID пользователя. ' +
    'Для группового чата: ID чата'
  ),
  message: z.string().describe('Текст сообщения'),
  webhook_url: z.string().url().optional(),
});

export async function chatSend({ dialog_id, message, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const res = await client.call('im.message.add', {
    DIALOG_ID: dialog_id,
    MESSAGE: message,
  });
  return { portal: client.portal, message_id: res.result, success: true };
}

// ─── BIZPROC ──────────────────────────────────────────────────────────────────

export const bizprocListSchema = z.object({
  entity: z.string().optional().describe('Сущность CRM: CRM_DEAL, CRM_CONTACT, CRM_COMPANY, CRM_LEAD'),
  entity_id: z.union([z.string(), z.number()]).optional().describe('ID записи CRM'),
  webhook_url: z.string().url().optional(),
});

export async function bizprocList({ entity, entity_id, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const params = {};
  if (entity) params.ENTITY = entity;
  if (entity_id) params.DOCUMENT_ID = entity_id;
  const res = await client.call('bizproc.workflow.instances', params);
  return { portal: client.portal, workflows: res.result ?? [] };
}

export const bizprocStartSchema = z.object({
  template_id: z.union([z.string(), z.number()]).describe('ID шаблона бизнес-процесса'),
  document_id: z.array(z.string()).describe(
    'Массив из 3 элементов, идентифицирующий документ: ' +
    '["crm", "CCrmDocumentDeal", "DEAL_123"] для сделки с ID 123'
  ),
  parameters: z.record(z.any()).optional().default({}).describe('Параметры бизнес-процесса'),
  webhook_url: z.string().url().optional(),
});

export async function bizprocStart({ template_id, document_id, parameters = {}, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const res = await client.call('bizproc.workflow.start', {
    TEMPLATE_ID: template_id,
    DOCUMENT_ID: document_id,
    PARAMETERS: parameters,
  });
  return { portal: client.portal, workflow_id: res.result, success: true };
}

// ─── TELEPHONY ────────────────────────────────────────────────────────────────

export const telephonyCallsSchema = z.object({
  filter: z.record(z.any()).optional().default({}).describe(
    'Фильтры. Пример: { "CRM_ENTITY_TYPE": "DEAL", "CRM_ENTITY_ID": 123 } ' +
    'или { "CALL_DURATION": ">60" } для звонков длительностью более 60 секунд'
  ),
  select: z.array(z.string()).optional(),
  webhook_url: z.string().url().optional(),
});

export async function telephonyCalls({ filter = {}, select, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const res = await client.call('voximplant.statistic.get', {
    filter,
    ...(select ? { select } : {}),
  });
  return { portal: client.portal, calls: res.result ?? [] };
}
