# CLAUDE.md

Ориентир для Claude Code при работе с этим репозиторием.

## О проекте

MCP-сервер (Model Context Protocol) для **Bitrix24**. Подключает Claude к порталу Bitrix24
через входящий вебхук и предоставляет 44 инструмента: CRM, задачи, диск, календарь,
телефония, каталог товаров, чтение почты, экспорт/сравнение/перенос конфигурации и
универсальный вызов любого REST-метода.

- Node.js ≥ 18, ESM (`"type": "module"` в package.json).
- Зависимости: `@modelcontextprotocol/sdk`, `axios`, `zod`, а для http-режима — `express`, `cors`.

## Команды

- Запуск: `npm start` (то же, что `node index.js`).
- Сборки нет. Тестов нет. Линтера нет.
- Проверка синтаксиса файла: `node --check <файл>` (быстрый гейт перед коммитом).

## Транспорты (переменная `B24_TRANSPORT`)

- `stdio` (по умолчанию) — локальный запуск рядом с Claude Desktop, без авторизации.
- `http` — удалённый сервер: Streamable HTTP + Google OAuth + allowlist email
  (`B24_ALLOWED_EMAILS`). Все параметры окружения — в `.env.example`, деплой — в
  [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

## Архитектура

```
index.js                     точка входа: registerTools() + выбор транспорта
├─ src/config.js             loadConfig() из переменных окружения
├─ src/tools/*.js            по одному файлу на функциональную область
├─ src/bitrix24/
│  ├─ client.js              HTTP-клиент к Bitrix24 (rate limit + retry)
│  ├─ reader.js              чтение структурной конфигурации (для миграции)
│  └─ writer.js              применение конфигурации на целевой портал
├─ src/utils/                pagination, rate-limiter, resolve-webhook, user-mapping
├─ src/auth/                 GoogleOAuthProvider (только http-режим)
└─ src/http-server.js        express-сервер для http-режима
```

### Регистрация инструментов

`registerTools(server)` в [index.js](index.js) регистрирует все инструменты и
переиспользуется обоими транспортами. Каждый инструмент:

```js
server.tool('b24_xxx', 'Описание для модели', xxxSchema.shape, wrap(xxxHandler));
```

`wrap()` сериализует результат в JSON-текст и превращает ошибки в `isError`.

### Файл инструмента (`src/tools/*.js`)

Экспортирует пару: zod-схему `xxxSchema` и async-обработчик `xxx({...})`. Обработчик
получает вебхук через `resolveWebhook(webhook_url)`, создаёт `Bitrix24Client`, вызывает
метод и возвращает объект (обычно с полем `portal`). Схемы почти всегда имеют
опциональный `webhook_url`.

### Клиент Bitrix24 (`src/bitrix24/client.js`)

- `client.call(method, params)` — классический **REST v1**:
  `/rest/{user}/{token}/{method}.json`. Ошибки приходят как `error` + `error_description`.
- `client.callV3(method, params)` — **REST v3**: базовый путь `/rest/api/...`, без `.json`.
  Ошибки — объект `{ code, message }`. Используется семейством `mail.*`.
- Общий rate limiter (мин. интервал 500 мс) и ретраи на 429 / таймаут.

### Пагинация

- v1: `fetchAllPages(client, method, params)` в [src/utils/pagination.js](src/utils/pagination.js) — по `start`/`total`.
- v3: объект `{ pagination: { page, limit, offset } }`, данные в `result.items`.

## Как добавить инструмент

1. В подходящем `src/tools/*.js` добавить `export const fooSchema = z.object({... webhook_url: z.string().url().optional()})`
   и `export async function foo({...}) {...}`.
2. Импортировать и зарегистрировать в [index.js](index.js) в нужной секции через `server.tool(...)`.
3. При необходимости обновить счётчик инструментов и список в [README.md](README.md).

## Почта (REST v3) — важные нюансы

- Методы `mail.mailbox.*` и `mail.message.*` — это **REST v3**; вызывать только через
  `client.callV3`, классический `client.call` вернёт `ERROR_METHOD_NOT_FOUND`.
- Требуется scope **`mail`** у вебхука (это НЕ `mailservice`) и коммерческий тариф Bitrix24.
- Официальная документация методов проверяется через MCP-сервер `b24-dev-mcp`
  (инструменты `bitrix-search`, `bitrix-method-details`).

## Конвенции

- Описания инструментов и параметров (`.describe(...)`) — **на русском**.
- Идентификаторы кода, имена REST-методов и коды полей API (`STAGE_ID`, `WON`, `UF_...`)
  оставлять как есть, не переводить.
- Возвращаемые из обработчиков объекты — единый стиль: поле `portal` + осмысленные ключи.

## Подводные камни

- В http-режиме `registerTools` **передаётся аргументом** в `startHttpServer`, а не
  импортируется из index.js — иначе статический импорт обратно в модуль с top-level await
  создаёт дедлок графа модулей (см. коммит про «http mode startup deadlock»).
- В `http`-режиме allowlist email обязателен — без него в конфиге бросается ошибка.
