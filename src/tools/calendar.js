import { z } from 'zod';
import { Bitrix24Client } from '../bitrix24/client.js';
import { resolveWebhook } from '../utils/resolve-webhook.js';

// ─── LIST EVENTS ──────────────────────────────────────────────────────────────

export const calendarListSchema = z.object({
  type: z.enum(['user', 'group', 'company_calendar']).optional().default('user').describe(
    'Тип календаря: user (личный), group (рабочая группа), company_calendar (компания)'
  ),
  owner_id: z.union([z.string(), z.number()]).optional().describe('ID пользователя или рабочей группы-владельца. По умолчанию: пользователь вебхука'),
  from: z.string().optional().describe('Дата начала ISO8601. Пример: "2026-01-01"'),
  to: z.string().optional().describe('Дата окончания ISO8601. Пример: "2026-12-31"'),
  webhook_url: z.string().url().optional(),
});

export async function calendarList({ type = 'user', owner_id, from, to, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const params = {
    type,
    ...(owner_id ? { ownerId: owner_id } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const res = await client.call('calendar.event.get', params);
  const events = res.result ?? [];
  return { portal: client.portal, type, count: events.length, events };
}

// ─── CREATE EVENT ─────────────────────────────────────────────────────────────

export const calendarCreateSchema = z.object({
  type: z.enum(['user', 'group', 'company_calendar']).optional().default('user'),
  owner_id: z.union([z.string(), z.number()]).optional(),
  name: z.string().describe('Название/заголовок события'),
  date_from: z.string().describe('Дата/время начала ISO8601. Пример: "2026-06-15 10:00:00"'),
  date_to: z.string().describe('Дата/время окончания ISO8601. Пример: "2026-06-15 11:00:00"'),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.union([z.string(), z.number()])).optional().describe('ID приглашённых пользователей'),
  remind: z.array(z.object({
    type: z.enum(['min', 'hour', 'day']),
    count: z.number(),
  })).optional().describe('Напоминания. Пример: [{ type: "min", count: 15 }]'),
  webhook_url: z.string().url().optional(),
});

export async function calendarCreate({ type = 'user', owner_id, name, date_from, date_to, description, location, attendees, remind, webhook_url }) {
  const client = new Bitrix24Client(resolveWebhook(webhook_url));
  const res = await client.call('calendar.event.add', {
    type,
    ...(owner_id ? { ownerId: owner_id } : {}),
    name,
    date_from,
    date_to,
    skip_time: 'N',
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(attendees ? { attendees } : {}),
    ...(remind ? { remind } : {}),
  });
  return { portal: client.portal, created_id: res.result, success: true };
}
