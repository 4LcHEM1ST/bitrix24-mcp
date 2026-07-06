import { z } from 'zod';
import { Bitrix24Client } from '../bitrix24/client.js';
import { fetchAllPages } from '../utils/pagination.js';
import { resolveWebhook } from '../utils/resolve-webhook.js';

// ─── LIST ─────────────────────────────────────────────────────────────────────

export const tasksListSchema = z.object({
  filter: z.record(z.any()).optional().default({}).describe(
    'Фильтры. Пример: { "RESPONSIBLE_ID": 5, "GROUP_ID": 10, "STATUS": "2" } ' +
    'Status: 1=новая, 2=ожидает выполнения, 3=выполняется, 4=почти просрочена, 5=завершена, 6=просрочена'
  ),
  select: z.array(z.string()).optional().describe(
    'Возвращаемые поля. По умолчанию: ID, TITLE, STATUS, RESPONSIBLE_ID, DEADLINE. ' +
    'Прочие: DESCRIPTION, CREATED_BY, GROUP_ID, PRIORITY, TAGS, CHECKLIST'
  ),
  order: z.record(z.string()).optional().default({ DEADLINE: 'ASC' }),
  all_pages: z.boolean().optional().default(false),
  webhook_url: z.string().url().optional(),
});

export async function tasksList({ filter = {}, select, order = { DEADLINE: 'ASC' }, all_pages = false, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const params = {
    filter,
    order,
    select: select ?? ['ID', 'TITLE', 'STATUS', 'RESPONSIBLE_ID', 'DEADLINE', 'GROUP_ID', 'CREATED_BY'],
  };

  let items;
  if (all_pages) {
    items = await fetchAllPages(client, 'tasks.task.list', params);
  } else {
    const res = await client.call('tasks.task.list', params);
    items = res.result?.tasks ?? [];
  }

  return { portal: client.portal, count: items.length, tasks: items };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export const tasksGetSchema = z.object({
  id: z.union([z.string(), z.number()]).describe('ID задачи'),
  select: z.array(z.string()).optional().describe('Возвращаемые поля'),
  webhook_url: z.string().url().optional(),
});

export async function tasksGet({ id, select, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const params = { taskId: id, ...(select ? { select } : {}) };
  const res = await client.call('tasks.task.get', params);
  return { portal: client.portal, task: res.result?.task ?? res.result };
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

export const tasksCreateSchema = z.object({
  fields: z.record(z.any()).describe(
    'Поля задачи. Обязательные: TITLE. ' +
    'Опциональные: DESCRIPTION, RESPONSIBLE_ID, DEADLINE (ISO8601), GROUP_ID, ' +
    'PRIORITY (0=низкий, 1=обычный, 2=высокий), PARENT_ID, TAGS, CHECKLIST'
  ),
  webhook_url: z.string().url().optional(),
});

export async function tasksCreate({ fields, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const res = await client.call('tasks.task.add', { fields });
  return { portal: client.portal, created_id: res.result?.task?.id ?? res.result, success: true };
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────

export const tasksUpdateSchema = z.object({
  id: z.union([z.string(), z.number()]),
  fields: z.record(z.any()).describe('Обновляемые поля'),
  webhook_url: z.string().url().optional(),
});

export async function tasksUpdate({ id, fields, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  await client.call('tasks.task.update', { taskId: id, fields });
  return { portal: client.portal, updated_id: id, success: true };
}

// ─── COMPLETE ─────────────────────────────────────────────────────────────────

export const tasksCompleteSchema = z.object({
  id: z.union([z.string(), z.number()]).describe('ID завершаемой задачи'),
  webhook_url: z.string().url().optional(),
});

export async function tasksComplete({ id, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  await client.call('tasks.task.complete', { taskId: id });
  return { portal: client.portal, completed_id: id, success: true };
}
